/**
 * Six Human Needs Quiz — data collector (Google Apps Script web app)
 * Runs on the shared creative@sccu.uk.com account. See data/README.md for setup.
 *
 * What it does
 *   POST  (from the quiz)  visit | start | age_gate | complete | share | feedback
 *                          (+ opt_in | account_interest, only when switched on below)
 *   GET   ?action=report&token=…   returns one person's results for the "revisit" link
 *
 * Where data goes (two spreadsheets, made by setup()):
 *   "HNQ Contacts (private)"  Contacts — name, email, age, consent. Never connected to the dashboard.
 *                             Quarantine — rejected submissions. Erasure log.
 *   "HNQ Results"             Assessments — scores and archetype, keyed by participant ID only.
 *                             Events — visits, starts, completions, shares, feedback, sources.
 *                             The Looker Studio dashboard reads this spreadsheet only.
 *
 * Protection: write-mostly endpoint (the only read is one report by a 128-bit secret token,
 * stored here only as a SHA-256 hash), every field checked against what the quiz can produce,
 * honeypot field, minimum completion time, rate limits, size limit, script lock on writes.
 */

// ─── Settings ───────────────────────────────────────────────────────────────
// Change these here, then Deploy → Manage deployments → Edit → New version.
var SETTINGS = {
  QUIZ_URL: 'https://scottfree.live/human-needs-quiz/',
  SENDER_NAME: 'Scott Free',          // display name on the results email (sent from the account running the script)
  REPLY_TO: '',                       // optional reply-to address, e.g. a Scott Free inbox; blank = replies go to the sending account
  SEND_RESULTS_EMAIL: true,
  RETENTION_MONTHS: 12,               // PLACEHOLDER — not yet agreed. Contacts not seen for this long are deleted daily (0 = never)
  MIN_COMPLETE_SECONDS: 45,           // a full quiz faster than this is treated as a bot
  MAX_COMPLETES_PER_EMAIL_PER_HOUR: 3,
  MAX_EVENTS_PER_MINUTE: 600,         // whole-site circuit breaker
  MAX_BODY_BYTES: 12000,
  QUIZ_VERSIONS: ['1.0.0'],           // accepted quiz versions (add new ones when the quiz copy changes)
  SCORING_VERSIONS: ['1.0.0'],
  // Later, when the new site is live — switch on here AND in the quiz's HNQ_CONFIG.features
  FEATURES: { stayConnected: false, accounts: false },
  OPT_IN_TEXT_VERSION: 'opt-in-v1',   // recorded with every opt-in so we know which wording people agreed to
};

var NEEDS = ['certainty', 'variety', 'significance', 'connection', 'growth', 'contribution'];
var EVENT_TYPES = ['visit', 'start', 'age_gate', 'complete', 'share', 'feedback', 'report_view', 'opt_in', 'account_interest'];
var CONFIDENCE = ['Blended', 'Balanced', 'Strong'];
var FULFILMENT = ['Positive', 'Neutral', 'Negative'];
var ACCURACY = ['Not at all', 'Slightly', 'Moderately', 'Very', 'Extremely'];
var SHARE_CHANNELS = ['instagram', 'facebook', 'linkedin', 'x', 'whatsapp', 'download', 'copy', 'native', 'other'];
var DEVICES = ['mobile', 'tablet', 'desktop'];

var HEADERS = {
  Contacts: ['participant_id', 'first_name', 'email', 'email_hash', 'age', 'first_seen', 'last_seen', 'assessments',
    'marketing_opt_in', 'marketing_opt_in_at', 'marketing_opt_in_wording', 'account_interest', 'account_interest_at'],
  Quarantine: ['received_at', 'reason', 'type', 'payload'],
  'Erasure log': ['erased_at', 'email_hash', 'reason', 'rows_removed'],
  Assessments: ['assessment_id', 'participant_id', 'submitted_at', 'date', 'quiz_version', 'scoring_version',
    'archetype', 'archetype_key', 'primary_need', 'secondary_need', 'confidence', 'fulfilment_state',
    'pct_certainty', 'pct_variety', 'pct_significance', 'pct_connection', 'pct_growth', 'pct_contribution',
    'score_certainty', 'score_variety', 'score_significance', 'score_connection', 'score_growth', 'score_contribution',
    'fulfil_certainty', 'fulfil_variety', 'fulfil_significance', 'fulfil_connection', 'fulfil_growth', 'fulfil_contribution',
    'age_range', 'age_band', 'source', 'medium', 'campaign', 'referrer', 'device', 'duration_sec',
    'returning', 'attempt', 'email_status', 'accuracy', 'accuracy_score', 'accuracy_at', 'report_views', 'last_report_view',
    'token_hash'],
  Events: ['timestamp', 'date', 'event', 'session_id', 'assessment_id', 'source', 'medium', 'campaign', 'referrer',
    'device', 'detail', 'value', 'quiz_version'],
};

// ─── One-time setup (run from the editor as creative@) ──────────────────────
function setup() {
  var props = PropertiesService.getScriptProperties();
  var contacts = props.getProperty('CONTACTS_ID') ? SpreadsheetApp.openById(props.getProperty('CONTACTS_ID'))
    : SpreadsheetApp.create('HNQ Contacts (private) — Six Human Needs Quiz');
  var results = props.getProperty('RESULTS_ID') ? SpreadsheetApp.openById(props.getProperty('RESULTS_ID'))
    : SpreadsheetApp.create('HNQ Results — Six Human Needs Quiz');
  ['Contacts', 'Quarantine', 'Erasure log'].forEach(function (n) { ensureSheet_(contacts, n); });
  ['Assessments', 'Events'].forEach(function (n) { ensureSheet_(results, n); });
  dropDefaultSheet_(contacts); dropDefaultSheet_(results);
  props.setProperty('CONTACTS_ID', contacts.getId());
  props.setProperty('RESULTS_ID', results.getId());
  if (!props.getProperty('TOKEN_PEPPER')) props.setProperty('TOKEN_PEPPER', Utilities.getUuid() + Utilities.getUuid());
  // Daily clean-up of old contacts
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'dailyCleanup') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyCleanup').timeBased().everyDays(1).atHour(3).create();
  Logger.log('Contacts (private): ' + contacts.getUrl());
  Logger.log('Results (dashboard): ' + results.getUrl());
  return { contacts: contacts.getUrl(), results: results.getUrl() };
}

function ensureSheet_(ss, name) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var h = HEADERS[name];
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function dropDefaultSheet_(ss) {
  var s = ss.getSheetByName('Sheet1');
  if (s && ss.getSheets().length > 1) ss.deleteSheet(s);
}

// ─── Web endpoints ──────────────────────────────────────────────────────────
function doPost(e) {
  var raw = (e && e.postData && e.postData.contents) || '';
  var body;
  try {
    if (raw.length > SETTINGS.MAX_BODY_BYTES) return json_({ ok: false, error: 'too_large' });
    body = JSON.parse(raw);
  } catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  try {
    if (!circuitOk_()) return json_({ ok: false, error: 'busy' });
    var type = String(body && body.type || '');
    if (EVENT_TYPES.indexOf(type) < 0) return quarantine_('unknown_type', body);
    if (body.hp) return quarantine_('honeypot', body);          // hidden field only bots fill in
    if (type === 'complete') return json_(handleComplete_(body));
    if (type === 'feedback') return json_(handleFeedback_(body));
    if (type === 'opt_in' || type === 'account_interest') return json_(handleConnect_(type, body));
    return json_(handleEvent_(type, body));
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'server' });
  }
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'report') return json_(handleReport_(String(p.token || '')));
  return json_({ ok: true, service: 'hnq-collector' });
}

// ─── Handlers ───────────────────────────────────────────────────────────────
function handleEvent_(type, b) {
  var ctx = cleanContext_(b);
  var detail = '', value = '';
  if (type === 'share') {
    detail = pick_(b.channel, SHARE_CHANNELS, 'other');
    value = cleanText_(b.format, 20);
  } else if (type === 'start') {
    detail = cleanAgeRange_(b.age_range);
  }
  if (type === 'visit' && !onceInWindow_('v:' + ctx.session_id, 21600)) return { ok: true, dup: true };
  appendRow_('RESULTS_ID', 'Events', eventRow_(type, ctx, detail, value));
  return { ok: true };
}

function handleComplete_(b) {
  var ctx = cleanContext_(b);
  var v = validateComplete_(b);
  if (!v.ok) { quarantine_(v.reason, b); return { ok: false, error: 'invalid' }; }
  var c = v.contact, r = v.result;
  var emailHash = hash_(c.email);
  if (!rateOk_('c:' + emailHash, SETTINGS.MAX_COMPLETES_PER_EMAIL_PER_HOUR, 3600)) {
    quarantine_('rate_limited', b);
    return { ok: false, error: 'rate_limited' };
  }
  var token = randomToken_();
  var now = new Date();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var person;
  try {
    // Already saved? (the quiz retries if the network drops)
    var existing = findRow_('RESULTS_ID', 'Assessments', 'assessment_id', ctx.assessment_id);
    if (existing) return { ok: true, dup: true };
    person = upsertContact_(c, emailHash, now);
    var row = HEADERS.Assessments.map(function () { return ''; });
    var set = function (k, val) { row[HEADERS.Assessments.indexOf(k)] = val; };
    set('assessment_id', ctx.assessment_id); set('participant_id', person.id);
    set('submitted_at', now); set('date', Utilities.formatDate(now, 'Europe/London', 'yyyy-MM-dd'));
    set('quiz_version', r.quiz_version); set('scoring_version', r.scoring_version);
    set('archetype', ARCHETYPES[r.archetype_key].name); set('archetype_key', r.archetype_key);
    set('primary_need', r.primary); set('secondary_need', r.secondary);
    set('confidence', r.confidence); set('fulfilment_state', r.fulfilment_state);
    NEEDS.forEach(function (n) {
      set('pct_' + n, round_(r.percentages[n], 2));
      set('score_' + n, round_(r.raw_scores[n], 2));
      set('fulfil_' + n, r.fulfilment[n]);
    });
    set('age_range', ageRange_(c.age)); set('age_band', r.age_band);
    set('source', ctx.source); set('medium', ctx.medium); set('campaign', ctx.campaign);
    set('referrer', ctx.referrer); set('device', ctx.device); set('duration_sec', r.duration_sec);
    set('returning', person.assessments > 1 ? 'yes' : 'no'); set('attempt', person.assessments);
    set('email_status', 'pending'); set('report_views', 0);
    set('token_hash', hash_(token));
    var sh = sheet_('RESULTS_ID', 'Assessments');
    sh.appendRow(row);
    var rowNum = sh.getLastRow();
    appendRow_('RESULTS_ID', 'Events', eventRow_('complete', ctx, ARCHETYPES[r.archetype_key].name, r.duration_sec));
  } finally { lock.releaseLock(); }

  var status = 'not_sent';
  if (SETTINGS.SEND_RESULTS_EMAIL) {
    try {
      sendResultsEmail_(c, r, reportUrl_(token));
      status = 'sent';
    } catch (err) { console.error('email failed', err); status = 'failed'; }
  }
  sh.getRange(rowNum, HEADERS.Assessments.indexOf('email_status') + 1).setValue(status);
  return { ok: true, token: token, participant_id: person.id, emailed: status === 'sent' };
}

function handleFeedback_(b) {
  var ctx = cleanContext_(b);
  var label = pick_(b.accuracy, ACCURACY, '');
  if (!label || !ctx.assessment_id) { quarantine_('bad_feedback', b); return { ok: false, error: 'invalid' }; }
  if (!rateOk_('f:' + ctx.assessment_id, 5, 3600)) return { ok: false, error: 'rate_limited' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var hit = findRow_('RESULTS_ID', 'Assessments', 'assessment_id', ctx.assessment_id);
    if (hit) {
      var sh = sheet_('RESULTS_ID', 'Assessments');
      var col = function (k) { return HEADERS.Assessments.indexOf(k) + 1; };
      sh.getRange(hit, col('accuracy')).setValue(label);
      sh.getRange(hit, col('accuracy_score')).setValue(ACCURACY.indexOf(label) + 1);
      sh.getRange(hit, col('accuracy_at')).setValue(new Date());
    }
    appendRow_('RESULTS_ID', 'Events', eventRow_('feedback', ctx, label, ACCURACY.indexOf(label) + 1));
  } finally { lock.releaseLock(); }
  return { ok: true };
}

// Switched off until the new site is live (SETTINGS.FEATURES). Needs the person's report token,
// so it can only be done by someone holding their results link.
function handleConnect_(type, b) {
  var feature = type === 'opt_in' ? 'stayConnected' : 'accounts';
  if (!SETTINGS.FEATURES[feature]) return { ok: false, error: 'not_enabled' };
  var token = String(b.token || '');
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { ok: false, error: 'invalid' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var aRow = findRow_('RESULTS_ID', 'Assessments', 'token_hash', hash_(token));
    if (!aRow) return { ok: false, error: 'not_found' };
    var pid = sheet_('RESULTS_ID', 'Assessments').getRange(aRow, HEADERS.Assessments.indexOf('participant_id') + 1).getValue();
    var cRow = pid && findRow_('CONTACTS_ID', 'Contacts', 'participant_id', pid);
    if (!cRow) return { ok: false, error: 'not_found' };
    var sh = sheet_('CONTACTS_ID', 'Contacts');
    var col = function (k) { return HEADERS.Contacts.indexOf(k) + 1; };
    var now = new Date();
    if (type === 'opt_in') {
      sh.getRange(cRow, col('marketing_opt_in')).setValue(b.value === false ? 'no' : 'yes');
      sh.getRange(cRow, col('marketing_opt_in_at')).setValue(now);
      sh.getRange(cRow, col('marketing_opt_in_wording')).setValue(SETTINGS.OPT_IN_TEXT_VERSION);
    } else {
      sh.getRange(cRow, col('account_interest')).setValue('yes');
      sh.getRange(cRow, col('account_interest_at')).setValue(now);
    }
    appendRow_('RESULTS_ID', 'Events', eventRow_(type, cleanContext_(b), b.value === false ? 'no' : 'yes', ''));
  } finally { lock.releaseLock(); }
  return { ok: true };
}

function handleReport_(token) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { ok: false, error: 'invalid' };
  if (!rateOk_('r:' + token.slice(0, 12), 60, 3600)) return { ok: false, error: 'rate_limited' };
  var rowNum = findRow_('RESULTS_ID', 'Assessments', 'token_hash', hash_(token));
  if (!rowNum) return { ok: false, error: 'not_found' };
  var sh = sheet_('RESULTS_ID', 'Assessments');
  var vals = sh.getRange(rowNum, 1, 1, HEADERS.Assessments.length).getValues()[0];
  var g = function (k) { return vals[HEADERS.Assessments.indexOf(k)]; };
  var out = { primary: g('primary_need'), secondary: g('secondary_need'), confidence: g('confidence'),
    fulfilment_state: g('fulfilment_state'), archetype_key: g('archetype_key'), age_band: g('age_band'),
    percentages: {}, raw_scores: {}, fulfilment: {}, assessment_id: g('assessment_id'),
    date: g('date') instanceof Date ? Utilities.formatDate(g('date'), 'Europe/London', 'yyyy-MM-dd') : String(g('date') || ''),
    accuracy: g('accuracy') || '' };
  NEEDS.forEach(function (n) { out.percentages[n] = g('pct_' + n); out.raw_scores[n] = g('score_' + n); out.fulfilment[n] = g('fulfil_' + n); });
  // First name only, and only while their contact record still exists.
  var pid = g('participant_id');
  var cRow = pid && findRow_('CONTACTS_ID', 'Contacts', 'participant_id', pid);
  out.first_name = cRow ? String(sheet_('CONTACTS_ID', 'Contacts').getRange(cRow, HEADERS.Contacts.indexOf('first_name') + 1).getValue() || '') : '';
  var views = Number(g('report_views')) || 0;
  sh.getRange(rowNum, HEADERS.Assessments.indexOf('report_views') + 1).setValue(views + 1);
  sh.getRange(rowNum, HEADERS.Assessments.indexOf('last_report_view') + 1).setValue(new Date());
  return { ok: true, result: out };
}

// ─── Validation ─────────────────────────────────────────────────────────────
function validateComplete_(b) {
  var c = b.contact || {}, r = b.result || {};
  var name = cleanText_(c.first_name, 60);
  var email = String(c.email || '').trim().toLowerCase();
  var age = Number(c.age);
  if (!name) return { ok: false, reason: 'no_name' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return { ok: false, reason: 'bad_email' };
  if (!(age >= 18 && age <= 120) || Math.floor(age) !== age) return { ok: false, reason: 'bad_age' };
  if (NEEDS.indexOf(r.primary) < 0 || NEEDS.indexOf(r.secondary) < 0 || r.primary === r.secondary) return { ok: false, reason: 'bad_needs' };
  var key = archetypeKey_(r.primary, r.secondary);
  if (r.archetype_key !== key || !ARCHETYPES[key]) return { ok: false, reason: 'bad_archetype' };
  if (CONFIDENCE.indexOf(r.confidence) < 0 || FULFILMENT.indexOf(r.fulfilment_state) < 0) return { ok: false, reason: 'bad_bands' };
  if (SETTINGS.QUIZ_VERSIONS.indexOf(r.quiz_version) < 0 || SETTINGS.SCORING_VERSIONS.indexOf(r.scoring_version) < 0) return { ok: false, reason: 'bad_version' };
  var total = 0, okNums = true;
  NEEDS.forEach(function (n) {
    var p = Number(r.percentages && r.percentages[n]), s = Number(r.raw_scores && r.raw_scores[n]), f = Number(r.fulfilment && r.fulfilment[n]);
    if (!(p >= 0 && p <= 100) || !isFinite(s) || Math.abs(s) > 60 || [1, 2, 3, 4, 5].indexOf(f) < 0) okNums = false;
    total += p;
  });
  if (!okNums || Math.abs(total - 100) > 0.6) return { ok: false, reason: 'bad_scores' };
  if (Number(r.percentages[r.primary]) + 1e-9 < Number(r.percentages[r.secondary])) return { ok: false, reason: 'bad_ranking' };
  var dur = Number(r.duration_sec);
  if (!(dur >= SETTINGS.MIN_COMPLETE_SECONDS) || dur > 86400) return { ok: false, reason: 'too_fast' };
  var band = Number(r.age_band);
  if ([2, 3, 4, 5].indexOf(band) < 0) return { ok: false, reason: 'bad_band' };
  return { ok: true,
    contact: { first_name: name, email: email, age: age },
    result: { primary: r.primary, secondary: r.secondary, archetype_key: key, confidence: r.confidence,
      fulfilment_state: r.fulfilment_state, percentages: r.percentages, raw_scores: r.raw_scores,
      fulfilment: r.fulfilment, quiz_version: r.quiz_version, scoring_version: r.scoring_version,
      duration_sec: Math.round(dur), age_band: band } };
}

function cleanContext_(b) {
  var id = function (x) { var s = String(x || ''); return /^[A-Za-z0-9-]{8,64}$/.test(s) ? s : ''; };
  return {
    session_id: id(b.session_id), assessment_id: id(b.assessment_id),
    source: cleanText_(b.source, 60) || 'direct', medium: cleanText_(b.medium, 60), campaign: cleanText_(b.campaign, 80),
    referrer: cleanText_(b.referrer, 120), device: pick_(b.device, DEVICES, ''),
    quiz_version: SETTINGS.QUIZ_VERSIONS.indexOf(b.quiz_version) >= 0 ? b.quiz_version : '',
  };
}
function eventRow_(type, ctx, detail, value) {
  var now = new Date();
  return [now, Utilities.formatDate(now, 'Europe/London', 'yyyy-MM-dd'), type, ctx.session_id, ctx.assessment_id,
    ctx.source, ctx.medium, ctx.campaign, ctx.referrer, ctx.device, detail, value, ctx.quiz_version];
}

// ─── Contacts ───────────────────────────────────────────────────────────────
function upsertContact_(c, emailHash, now) {
  var sh = sheet_('CONTACTS_ID', 'Contacts');
  var col = function (k) { return HEADERS.Contacts.indexOf(k) + 1; };
  var rowNum = findRow_('CONTACTS_ID', 'Contacts', 'email_hash', emailHash);
  if (rowNum) {
    var vals = sh.getRange(rowNum, 1, 1, HEADERS.Contacts.length).getValues()[0];
    var n = (Number(vals[col('assessments') - 1]) || 0) + 1;
    sh.getRange(rowNum, col('first_name')).setValue(c.first_name);
    sh.getRange(rowNum, col('age')).setValue(c.age);
    sh.getRange(rowNum, col('last_seen')).setValue(now);
    sh.getRange(rowNum, col('assessments')).setValue(n);
    return { id: vals[col('participant_id') - 1], assessments: n };
  }
  var id = 'P-' + Utilities.getUuid();
  var row = HEADERS.Contacts.map(function () { return ''; });
  row[col('participant_id') - 1] = id; row[col('first_name') - 1] = c.first_name;
  row[col('email') - 1] = c.email; row[col('email_hash') - 1] = emailHash; row[col('age') - 1] = c.age;
  row[col('first_seen') - 1] = now; row[col('last_seen') - 1] = now; row[col('assessments') - 1] = 1;
  row[col('marketing_opt_in') - 1] = 'no'; row[col('account_interest') - 1] = 'no';
  sh.appendRow(row);
  return { id: id, assessments: 1 };
}

// Daily: delete contacts not seen for RETENTION_MONTHS, unless they opted in or registered interest.
// Their anonymous results stay in the Results spreadsheet, and their revisit link keeps working (without their name).
function dailyCleanup() {
  if (!SETTINGS.RETENTION_MONTHS) return 0;
  var cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - SETTINGS.RETENTION_MONTHS);
  var sh = sheet_('CONTACTS_ID', 'Contacts');
  var data = sh.getDataRange().getValues();
  var col = function (k) { return HEADERS.Contacts.indexOf(k); };
  var removed = 0;
  for (var i = data.length - 1; i >= 1; i--) {
    var keep = data[i][col('marketing_opt_in')] === 'yes' || data[i][col('account_interest')] === 'yes';
    var seen = data[i][col('last_seen')];
    if (!keep && seen instanceof Date && seen < cutoff) { sh.deleteRow(i + 1); removed++; }
  }
  if (removed) appendRow_('CONTACTS_ID', 'Erasure log', [new Date(), '', 'retention (' + SETTINGS.RETENTION_MONTHS + ' months)', removed]);
  return removed;
}

// For a "delete my data" request: run from the editor, e.g. eraseByEmail('someone@example.com').
// Removes their contact record, unlinks their results and switches off their revisit links.
function eraseByEmail(email) {
  var h = hash_(String(email || '').trim().toLowerCase());
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var cRow = findRow_('CONTACTS_ID', 'Contacts', 'email_hash', h);
    if (!cRow) { Logger.log('No contact found for that email.'); return 0; }
    var cSh = sheet_('CONTACTS_ID', 'Contacts');
    var pid = cSh.getRange(cRow, HEADERS.Contacts.indexOf('participant_id') + 1).getValue();
    cSh.deleteRow(cRow);
    var aSh = sheet_('RESULTS_ID', 'Assessments');
    var data = aSh.getDataRange().getValues(), n = 0;
    var pCol = HEADERS.Assessments.indexOf('participant_id'), tCol = HEADERS.Assessments.indexOf('token_hash');
    for (var i = 1; i < data.length; i++) {
      if (data[i][pCol] === pid) {
        aSh.getRange(i + 1, pCol + 1).setValue('erased');
        aSh.getRange(i + 1, tCol + 1).setValue('');
        n++;
      }
    }
    appendRow_('CONTACTS_ID', 'Erasure log', [new Date(), h, 'request', 1 + n]);
    Logger.log('Erased contact and unlinked ' + n + ' result(s).');
    return 1 + n;
  } finally { lock.releaseLock(); }
}

// ─── Helpers ────────────────────────────────────────────────────────────────
var CACHE_SHEETS_ = {};
function sheet_(propKey, name) {
  var k = propKey + '/' + name;
  if (!CACHE_SHEETS_[k]) {
    var id = PropertiesService.getScriptProperties().getProperty(propKey);
    if (!id) throw new Error('Run setup() first');
    CACHE_SHEETS_[k] = SpreadsheetApp.openById(id).getSheetByName(name);
  }
  return CACHE_SHEETS_[k];
}
function appendRow_(propKey, name, row) { sheet_(propKey, name).appendRow(row); }
function findRow_(propKey, name, header, value) {
  if (!value) return 0;
  var sh = sheet_(propKey, name);
  var c = HEADERS[name].indexOf(header) + 1;
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var hit = sh.getRange(2, c, last - 1, 1).createTextFinder(String(value)).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}
function quarantine_(reason, body) {
  try {
    var copy = JSON.parse(JSON.stringify(body || {}));
    // Keep enough to spot abuse patterns, but not someone's name or email address.
    if (copy && copy.contact) copy.contact = { email_hash: hash_(String(copy.contact.email || '').trim().toLowerCase()).slice(0, 16), age: copy.contact.age };
    if (copy && copy.token) copy.token = '[removed]';
    var s = JSON.stringify(copy).slice(0, 4000);
    appendRow_('CONTACTS_ID', 'Quarantine', [new Date(), reason, String(copy.type || '').slice(0, 30), s]);
  } catch (e) { console.error(e); }
  return json_({ ok: false, error: 'rejected' });
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function hash_(s) {
  var pepper = PropertiesService.getScriptProperties().getProperty('TOKEN_PEPPER') || '';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pepper + '|' + s, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
function randomToken_() {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    Utilities.getUuid() + Utilities.getUuid() + Date.now())).replace(/=+$/, '').slice(0, 32);
}
function reportUrl_(token) { return SETTINGS.QUIZ_URL + '?r=' + token; }
function rateOk_(key, max, seconds) {
  var cache = CacheService.getScriptCache();
  var n = Number(cache.get(key) || 0);
  if (n >= max) return false;
  cache.put(key, String(n + 1), seconds);
  return true;
}
function onceInWindow_(key, seconds) {
  if (!key || key === 'v:') return true;
  var cache = CacheService.getScriptCache();
  if (cache.get(key)) return false;
  cache.put(key, '1', seconds);
  return true;
}
function circuitOk_() {
  var minute = Math.floor(Date.now() / 60000);
  return rateOk_('m:' + minute, SETTINGS.MAX_EVENTS_PER_MINUTE, 120);
}
function archetypeKey_(a, b) { return [a, b].sort(function (x, y) { return NEEDS.indexOf(x) - NEEDS.indexOf(y); }).join('|'); }
function pick_(v, list, dflt) { v = String(v || '').toLowerCase(); for (var i = 0; i < list.length; i++) if (list[i].toLowerCase() === v) return list[i]; return dflt; }
function cleanText_(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').replace(/^[=+\-@]+/, '').trim().slice(0, max); }
function round_(n, d) { var f = Math.pow(10, d); return Math.round(Number(n) * f) / f; }
function ageRange_(age) {
  if (age < 25) return '18-24'; if (age < 35) return '25-34'; if (age < 45) return '35-44';
  if (age < 55) return '45-54'; if (age < 65) return '55-64'; return '65+';
}
function cleanAgeRange_(v) { var ok = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+']; return ok.indexOf(v) >= 0 ? v : ''; }
