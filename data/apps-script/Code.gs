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
 *   "HNQ Contacts (private)"  Contacts — name, email, age, consent. Report names — the first name shown on
 *                             each report. Quarantine — rejected submissions (no names or emails). Erasure log.
 *                             Never connected to the dashboard.
 *   "HNQ Results"             Assessments — scores and archetype, keyed by participant ID only.
 *                             Events — visits, starts, completions, shares, feedback, sources.
 *                             The Looker Studio dashboard reads this spreadsheet only.
 *
 * Protection
 *   - The only read is one report by a 192-bit secret token, stored here only as a peppered SHA-256 hash.
 *   - Every field is checked against what the quiz can produce; text that could act as a spreadsheet
 *     formula is neutralised; first names are letters only and never appear in the email subject.
 *   - Results emails need a matching "start" seen by this server at least MIN_COMPLETE_SECONDS earlier,
 *     and are limited per (normalised) email address and per day across the whole site.
 *   - Honeypot field, size limit, hourly/minute caps on writes, script lock on every write.
 */

// ─── Settings ───────────────────────────────────────────────────────────────
// Change these here, then Deploy → Manage deployments → Edit → New version.
var SETTINGS = {
  QUIZ_URL: 'https://scottfree.live/human-needs-quiz/',
  SENDER_NAME: 'Scott Free',          // display name on the results email (sent from the account running the script)
  REPLY_TO: '',                       // optional reply-to address, e.g. a Scott Free inbox; blank = replies go to the sending account
  SEND_RESULTS_EMAIL: true,
  RETENTION_MONTHS: 12,               // PLACEHOLDER — not yet agreed. Contacts not seen for this long are deleted daily (0 = never)
  QUARANTINE_DAYS: 30,                // rejected submissions are cleared after this many days
  MIN_COMPLETE_SECONDS: 30,           // a full quiz faster than this (timed by the server) gets no email
  MAX_EMAILS_PER_ADDRESS_PER_HOUR: 3,
  MAX_EMAILS_PER_DAY: 800,            // whole-site cap (Workspace allows about 1,500 a day)
  // Whole-site caps so the spreadsheets can't be flooded. Starts and completions have their own,
  // larger budget so a burst of junk can't stop real people finishing (e.g. a room scanning the QR code).
  MAX_WRITES_PER_MINUTE: 300,         // visits, shares, feedback, under-18 counts
  MAX_WRITES_PER_HOUR: 6000,
  MAX_QUIZ_WRITES_PER_MINUTE: 600,    // starts and completions
  MAX_QUIZ_WRITES_PER_HOUR: 20000,
  MAX_REPORT_READS_PER_MINUTE: 300,
  MAX_QUARANTINE_PER_HOUR: 50,
  MAX_BODY_BYTES: 12000,
  QUIZ_VERSIONS: ['1.0.0'],           // accepted quiz versions (add new ones when the quiz copy changes)
  SCORING_VERSIONS: ['1.0.0'],
  // Later, when the new site is live — switch on here AND in the quiz's HNQ_CONFIG.features
  FEATURES: { stayConnected: false, accounts: false },
  OPT_IN_TEXT_VERSION: 'opt-in-v1',   // recorded with every opt-in so we know which wording people agreed to
};

var NEEDS = ['certainty', 'variety', 'significance', 'connection', 'growth', 'contribution'];
var EVENT_TYPES = ['visit', 'start', 'age_gate', 'complete', 'share', 'feedback', 'opt_in', 'account_interest'];
var CONFIDENCE = ['Blended', 'Balanced', 'Strong'];
var FULFILMENT = ['Positive', 'Neutral', 'Negative'];
var ACCURACY = ['Not at all', 'Slightly', 'Moderately', 'Very', 'Extremely'];
var SHARE_CHANNELS = ['instagram', 'facebook', 'linkedin', 'x', 'whatsapp', 'download', 'copy', 'native', 'other'];
var SHARE_FORMATS = ['card', 'story'];
var DEVICES = ['mobile', 'tablet', 'desktop'];
var AGE_RANGES = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
// Letters (any language), spaces, apostrophes and hyphens; must start with a letter. No digits, dots or links.
var NAME_RE = /^[\p{L}][\p{L}\p{M} '’-]{0,39}$/u;
var EMAIL_RE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
var ID_RE = /^[A-Za-z0-9-]{8,64}$/;
var TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

var HEADERS = {
  Contacts: ['participant_id', 'first_name', 'email', 'email_hash', 'age', 'first_seen', 'last_seen', 'assessments',
    'marketing_opt_in', 'marketing_opt_in_at', 'marketing_opt_in_wording', 'account_interest', 'account_interest_at'],
  'Report names': ['assessment_id', 'participant_id', 'first_name', 'created'],
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
// Columns kept as plain text so Sheets never turns a name like "True" or "1/2" into something else.
var TEXT_COLUMNS = { Contacts: ['first_name', 'email'], 'Report names': ['first_name'] };

// ─── One-time setup (run from the editor as creative@) ──────────────────────
function setup() {
  var props = PropertiesService.getScriptProperties();
  var contacts = props.getProperty('CONTACTS_ID') ? SpreadsheetApp.openById(props.getProperty('CONTACTS_ID'))
    : SpreadsheetApp.create('HNQ Contacts (private) — Six Human Needs Quiz');
  var results = props.getProperty('RESULTS_ID') ? SpreadsheetApp.openById(props.getProperty('RESULTS_ID'))
    : SpreadsheetApp.create('HNQ Results — Six Human Needs Quiz');
  ['Contacts', 'Report names', 'Quarantine', 'Erasure log'].forEach(function (n) { ensureSheet_(contacts, n); });
  ['Assessments', 'Events'].forEach(function (n) { ensureSheet_(results, n); });
  dropDefaultSheet_(contacts); dropDefaultSheet_(results);
  props.setProperty('CONTACTS_ID', contacts.getId());
  props.setProperty('RESULTS_ID', results.getId());
  if (!props.getProperty('TOKEN_PEPPER')) props.setProperty('TOKEN_PEPPER', Utilities.getUuid() + Utilities.getUuid());
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
  (TEXT_COLUMNS[name] || []).forEach(function (col) {
    sh.getRange(1, h.indexOf(col) + 1, sh.getMaxRows(), 1).setNumberFormat('@');
  });
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
  if (raw.length > SETTINGS.MAX_BODY_BYTES) return json_({ ok: false, error: 'too_large' });
  try { body = JSON.parse(raw); } catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  if (!body || typeof body !== 'object') return json_({ ok: false, error: 'bad_json' });
  try {
    var type = String(body.type || '');
    if (EVENT_TYPES.indexOf(type) < 0) return json_(quarantine_('unknown_type', body));
    if (!writeBudgetOk_(type === 'start' || type === 'complete' ? 'quiz' : 'other')) return json_({ ok: false, error: 'busy' });
    if (body.hp) return json_(quarantine_('honeypot', body));          // hidden field only bots fill in
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
  try {
    if (p.action === 'report') {
      if (!rateOk_('rg:' + Math.floor(Date.now() / 60000), SETTINGS.MAX_REPORT_READS_PER_MINUTE, 120)) return json_({ ok: false, error: 'busy' });
      return json_(handleReport_(String(p.token || '')));
    }
  } catch (err) { console.error(err); return json_({ ok: false, error: 'server' }); }
  return json_({ ok: true, service: 'hnq-collector' });
}

// ─── Handlers ───────────────────────────────────────────────────────────────
function handleEvent_(type, b) {
  var ctx = cleanContext_(b);
  var detail = '', value = '';
  if (type === 'share') {
    detail = pick_(b.channel, SHARE_CHANNELS, 'other');
    value = pick_(b.format, SHARE_FORMATS, '');
  } else if (type === 'start') {
    detail = pick_(b.age_range, AGE_RANGES, '');
    // The server's own clock for this attempt: completes are timed from here, not from the browser.
    if (ctx.assessment_id) CacheService.getScriptCache().put('s:' + ctx.assessment_id, String(Date.now()), 21600);
  }
  if (type === 'visit' && !onceInWindow_('v:' + ctx.session_id, 21600)) return { ok: true, dup: true };
  return withLock_(function () {
    appendRow_('RESULTS_ID', 'Events', eventRow_(type, ctx, detail, value));
    return { ok: true };
  });
}

function handleComplete_(b) {
  var ctx = cleanContext_(b);
  var v = validateComplete_(b, ctx);
  if (!v.ok) return quarantine_(v.reason, b);
  var c = v.contact, r = v.result;
  var emailHash = hash_(c.email);
  var token = randomToken_();
  var now = new Date();
  var saved = withLock_(function () {
    // Already saved? (the quiz retries if the network drops)
    var existing = findRow_('RESULTS_ID', 'Assessments', 'assessment_id', ctx.assessment_id);
    if (existing) {
      var st = sheet_('RESULTS_ID', 'Assessments').getRange(existing, HEADERS.Assessments.indexOf('email_status') + 1).getValue();
      return { dup: true, emailed: st === 'sent' };
    }
    var person = upsertContact_(c, emailHash, now);
    appendRow_('CONTACTS_ID', 'Report names', [ctx.assessment_id, person.id, safe_(c.first_name), now]);
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
    appendRow_('RESULTS_ID', 'Events', eventRow_('complete', ctx, ARCHETYPES[r.archetype_key].name, r.duration_sec));
    return { dup: false, rowNum: sh.getLastRow() };
  });
  if (saved.error) return saved;
  if (saved.dup) return { ok: true, dup: true, emailed: saved.emailed };

  var status = emailDecision_(ctx, c);
  if (status === 'send') {
    try { sendResultsEmail_(c, r, reportUrl_(token)); status = 'sent'; }
    catch (err) { console.error('email failed', err); status = 'failed'; }
  }
  withLock_(function () {
    // Re-find the row: the daily clean-up or another write may have moved it.
    var rowNum = findRow_('RESULTS_ID', 'Assessments', 'assessment_id', ctx.assessment_id);
    if (rowNum) sheet_('RESULTS_ID', 'Assessments').getRange(rowNum, HEADERS.Assessments.indexOf('email_status') + 1).setValue(status);
    return {};
  });
  return { ok: true, token: token, emailed: status === 'sent' };
}

// When did the server see this attempt start? Quick cache first; the Events sheet if the cache has
// dropped it (the cache can forget early, and keeps nothing beyond 6 hours).
function startedAt_(aid) {
  var cached = Number(CacheService.getScriptCache().get('s:' + aid) || 0);
  if (cached) return cached;
  var row = findRow_('RESULTS_ID', 'Events', 'assessment_id', aid);       // first row for this attempt = its start
  if (!row) return 0;
  var vals = sheet_('RESULTS_ID', 'Events').getRange(row, 1, 1, 3).getValues()[0];
  return vals[2] === 'start' && vals[0] instanceof Date ? vals[0].getTime() : 0;
}

// Should this completion get a results email? Returns 'send' or the reason it won't.
// (A repeat of the same attempt never gets here: duplicates are caught before this runs.)
function emailDecision_(ctx, c) {
  if (!SETTINGS.SEND_RESULTS_EMAIL) return 'off';
  var started = startedAt_(ctx.assessment_id);
  if (!started) return 'no_start';                                        // never saw this attempt begin
  if ((Date.now() - started) / 1000 < SETTINGS.MIN_COMPLETE_SECONDS) return 'too_fast';
  if (!rateOk_('e:' + hash_(normaliseEmail_(c.email)).slice(0, 40), SETTINGS.MAX_EMAILS_PER_ADDRESS_PER_HOUR, 3600)) return 'address_limit';
  if (!dailyEmailOk_()) return 'daily_limit';
  return 'send';
}

function handleFeedback_(b) {
  var ctx = cleanContext_(b);
  var label = pick_(b.accuracy, ACCURACY, '');
  if (!label || !ctx.assessment_id) return quarantine_('bad_feedback', b);
  if (!rateOk_('f:' + ctx.assessment_id, 5, 3600)) return { ok: false, error: 'rate_limited' };
  return withLock_(function () {
    var hit = findRow_('RESULTS_ID', 'Assessments', 'assessment_id', ctx.assessment_id);
    if (!hit) return { ok: false, error: 'not_found' };
    var sh = sheet_('RESULTS_ID', 'Assessments');
    var col = function (k) { return HEADERS.Assessments.indexOf(k) + 1; };
    sh.getRange(hit, col('accuracy')).setValue(label);
    sh.getRange(hit, col('accuracy_score')).setValue(ACCURACY.indexOf(label) + 1);
    sh.getRange(hit, col('accuracy_at')).setValue(new Date());
    appendRow_('RESULTS_ID', 'Events', eventRow_('feedback', ctx, label, ACCURACY.indexOf(label) + 1));
    return { ok: true };
  });
}

// Switched off until the new site is live (SETTINGS.FEATURES). Needs the person's report token,
// so it can only be done by someone holding their own results link.
function handleConnect_(type, b) {
  var feature = type === 'opt_in' ? 'stayConnected' : 'accounts';
  if (!SETTINGS.FEATURES[feature]) return { ok: false, error: 'not_enabled' };
  var token = String(b.token || '');
  if (!TOKEN_RE.test(token)) return { ok: false, error: 'invalid' };
  return withLock_(function () {
    var aRow = findRow_('RESULTS_ID', 'Assessments', 'token_hash', hash_(token));
    if (!aRow) return { ok: false, error: 'not_found' };
    var pid = sheet_('RESULTS_ID', 'Assessments').getRange(aRow, HEADERS.Assessments.indexOf('participant_id') + 1).getValue();
    var cRow = pid && findRow_('CONTACTS_ID', 'Contacts', 'participant_id', pid);
    if (!cRow) return { ok: false, error: 'not_found' };
    var sh = sheet_('CONTACTS_ID', 'Contacts');
    var col = function (k) { return HEADERS.Contacts.indexOf(k) + 1; };
    var now = new Date(), yes = b.value !== false;
    if (type === 'opt_in') {
      sh.getRange(cRow, col('marketing_opt_in')).setValue(yes ? 'yes' : 'no');
      sh.getRange(cRow, col('marketing_opt_in_at')).setValue(now);
      sh.getRange(cRow, col('marketing_opt_in_wording')).setValue(SETTINGS.OPT_IN_TEXT_VERSION);
    } else {
      sh.getRange(cRow, col('account_interest')).setValue('yes');
      sh.getRange(cRow, col('account_interest_at')).setValue(now);
    }
    appendRow_('RESULTS_ID', 'Events', eventRow_(type, cleanContext_(b), yes ? 'yes' : 'no', ''));
    return { ok: true };
  });
}

function handleReport_(token) {
  if (!TOKEN_RE.test(token)) return { ok: false, error: 'invalid' };
  if (!rateOk_('r:' + token.slice(0, 16), 60, 3600)) return { ok: false, error: 'rate_limited' };
  // Reading doesn't need the lock (it would hold up people finishing the quiz); only the view count does.
  var rowNum = findRow_('RESULTS_ID', 'Assessments', 'token_hash', hash_(token));
  if (!rowNum) return { ok: false, error: 'not_found' };
  var sh = sheet_('RESULTS_ID', 'Assessments');
  var vals = sh.getRange(rowNum, 1, 1, HEADERS.Assessments.length).getValues()[0];
  var g = function (k) { return vals[HEADERS.Assessments.indexOf(k)]; };
  if (g('token_hash') !== hash_(token)) return { ok: false, error: 'not_found' };   // row moved while reading
  var d = g('date');
  var out = { primary: g('primary_need'), secondary: g('secondary_need'), confidence: g('confidence'),
    fulfilment_state: g('fulfilment_state'), archetype_key: g('archetype_key'), age_band: g('age_band'),
    percentages: {}, raw_scores: {}, fulfilment: {}, assessment_id: g('assessment_id'),
    date: d instanceof Date ? Utilities.formatDate(d, 'Europe/London', 'yyyy-MM-dd') : String(d || ''),
    accuracy: g('accuracy') || '' };
  NEEDS.forEach(function (n) { out.percentages[n] = g('pct_' + n); out.raw_scores[n] = g('score_' + n); out.fulfilment[n] = g('fulfil_' + n); });
  // The first name given for this particular attempt, while it is still held.
  var nRow = findRow_('CONTACTS_ID', 'Report names', 'assessment_id', g('assessment_id'));
  out.first_name = nRow ? unsafe_(sheet_('CONTACTS_ID', 'Report names').getRange(nRow, HEADERS['Report names'].indexOf('first_name') + 1).getValue()) : '';
  withLock_(function () {
    var r = findRow_('RESULTS_ID', 'Assessments', 'token_hash', hash_(token));
    if (r) {
      var cur = Number(sh.getRange(r, HEADERS.Assessments.indexOf('report_views') + 1).getValue()) || 0;
      sh.getRange(r, HEADERS.Assessments.indexOf('report_views') + 1).setValue(cur + 1);
      sh.getRange(r, HEADERS.Assessments.indexOf('last_report_view') + 1).setValue(new Date());
    }
    return {};
  });
  return { ok: true, result: out };
}

// ─── Validation ─────────────────────────────────────────────────────────────
function validateComplete_(b, ctx) {
  var c = b.contact || {}, r = b.result || {};
  if (!ctx.assessment_id) return { ok: false, reason: 'no_assessment_id' };
  var age = Number(c.age);
  if (!(age >= 18 && age <= 120) || Math.floor(age) !== age) return { ok: false, reason: 'bad_age' };
  var name = String(c.first_name || '').trim().replace(/\s+/g, ' ');
  if (!NAME_RE.test(name)) return { ok: false, reason: 'bad_name' };
  var email = String(c.email || '').trim().toLowerCase();
  if (email.length > 200 || !EMAIL_RE.test(email)) return { ok: false, reason: 'bad_email' };
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
  if (!(dur >= 0) || dur > 86400) return { ok: false, reason: 'bad_duration' };
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
  var id = function (x) { var s = String(x || ''); return ID_RE.test(s) ? s : ''; };
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
// A returning email keeps its participant ID. The stored name and age are NOT overwritten by a later
// submission (anyone can type anyone's email); each attempt's own name lives in "Report names".
function upsertContact_(c, emailHash, now) {
  var sh = sheet_('CONTACTS_ID', 'Contacts');
  var col = function (k) { return HEADERS.Contacts.indexOf(k) + 1; };
  var rowNum = findRow_('CONTACTS_ID', 'Contacts', 'email_hash', emailHash);
  if (rowNum) {
    var vals = sh.getRange(rowNum, 1, 1, HEADERS.Contacts.length).getValues()[0];
    var n = (Number(vals[col('assessments') - 1]) || 0) + 1;
    sh.getRange(rowNum, col('last_seen')).setValue(now);
    sh.getRange(rowNum, col('assessments')).setValue(n);
    return { id: vals[col('participant_id') - 1], assessments: n };
  }
  var id = 'P-' + Utilities.getUuid();
  var row = HEADERS.Contacts.map(function () { return ''; });
  row[col('participant_id') - 1] = id; row[col('first_name') - 1] = safe_(c.first_name);
  row[col('email') - 1] = safe_(c.email); row[col('email_hash') - 1] = emailHash; row[col('age') - 1] = c.age;
  row[col('first_seen') - 1] = now; row[col('last_seen') - 1] = now; row[col('assessments') - 1] = 1;
  row[col('marketing_opt_in') - 1] = 'no'; row[col('account_interest') - 1] = 'no';
  sh.appendRow(row);
  return { id: id, assessments: 1 };
}

// Daily: delete contacts not seen for RETENTION_MONTHS (unless they opted in or registered interest),
// with their report names, and clear old Quarantine rows. Anonymous results stay in the Results
// spreadsheet, and the revisit links keep working without a name.
function dailyCleanup() {
  return withLock_(function () {
    var removed = 0;
    if (SETTINGS.RETENTION_MONTHS) {
      var cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - SETTINGS.RETENTION_MONTHS);
      var col = function (k) { return HEADERS.Contacts.indexOf(k); };
      var gone = {};
      removed = rewriteKeeping_('CONTACTS_ID', 'Contacts', function (r) {
        var keep = r[col('marketing_opt_in')] === 'yes' || r[col('account_interest')] === 'yes';
        var seen = r[col('last_seen')];
        if (!keep && seen instanceof Date && seen < cutoff) { gone[r[col('participant_id')]] = 1; return false; }
        return true;
      });
      var pCol = HEADERS['Report names'].indexOf('participant_id');
      rewriteKeeping_('CONTACTS_ID', 'Report names', function (r) { return !gone[r[pCol]]; });
      if (removed) appendRow_('CONTACTS_ID', 'Erasure log', [new Date(), '', 'retention (' + SETTINGS.RETENTION_MONTHS + ' months)', removed]);
    }
    var qCut = new Date(Date.now() - SETTINGS.QUARANTINE_DAYS * 86400000);
    rewriteKeeping_('CONTACTS_ID', 'Quarantine', function (r) { return !(r[0] instanceof Date && r[0] < qCut); });
    return removed;
  });
}

// For a "delete my data" request: run from the editor, e.g. eraseByEmail('someone@example.com').
// Removes their contact record and report names, unlinks their results and switches off their revisit links.
function eraseByEmail(email) {
  var h = hash_(String(email || '').trim().toLowerCase());
  return withLock_(function () {
    var cRow = findRow_('CONTACTS_ID', 'Contacts', 'email_hash', h);
    if (!cRow) { Logger.log('No contact found for that email.'); return 0; }
    var pid = sheet_('CONTACTS_ID', 'Contacts').getRange(cRow, HEADERS.Contacts.indexOf('participant_id') + 1).getValue();
    sheet_('CONTACTS_ID', 'Contacts').deleteRow(cRow);
    var pCol = HEADERS['Report names'].indexOf('participant_id');
    var names = rewriteKeeping_('CONTACTS_ID', 'Report names', function (r) { return r[pCol] !== pid; });
    var aSh = sheet_('RESULTS_ID', 'Assessments');
    var data = aSh.getDataRange().getValues(), n = 0;
    var aP = HEADERS.Assessments.indexOf('participant_id'), aT = HEADERS.Assessments.indexOf('token_hash');
    for (var i = 1; i < data.length; i++) {
      if (data[i][aP] === pid) { aSh.getRange(i + 1, aP + 1).setValue('erased'); aSh.getRange(i + 1, aT + 1).setValue(''); n++; }
    }
    appendRow_('CONTACTS_ID', 'Erasure log', [new Date(), h, 'request', 1 + names + n]);
    Logger.log('Erased contact, ' + names + ' report name(s), and unlinked ' + n + ' result(s).');
    return 1 + names + n;
  });
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
// Keep only the rows where keep(row) is true, rewriting the sheet in one go. Returns how many were removed.
function rewriteKeeping_(propKey, name, keep) {
  var sh = sheet_(propKey, name);
  var last = sh.getLastRow(), width = HEADERS[name].length;
  if (last < 2) return 0;
  var rows = sh.getRange(2, 1, last - 1, width).getValues();
  var kept = rows.filter(keep);
  if (kept.length === rows.length) return 0;
  sh.getRange(2, 1, last - 1, width).clearContent();
  // Sheets drops the protective apostrophe when values are read back, so protect text again before writing.
  kept = kept.map(function (row) { return row.map(function (v) { return typeof v === 'string' ? safe_(v) : v; }); });
  if (kept.length) sh.getRange(2, 1, kept.length, width).setValues(kept);
  return rows.length - kept.length;
}
// Waits up to 10 seconds for other writes to finish; if it can't, the quiz is told to try again.
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'busy' };
  try { return fn(); } finally { lock.releaseLock(); }
}
function quarantine_(reason, body) {
  try {
    if (!rateOk_('q:' + Math.floor(Date.now() / 3600000), SETTINGS.MAX_QUARANTINE_PER_HOUR, 3700)) return { ok: false, error: 'rejected' };
    var copy = JSON.parse(JSON.stringify(body || {}));
    // Enough to spot abuse patterns, never a name or email address. Nothing at all about under-18s.
    if (copy.contact) {
      var age = Number(copy.contact.age);
      copy.contact = age >= 18 ? { email_hash: hash_(String(copy.contact.email || '').trim().toLowerCase()).slice(0, 12), age: age } : null;
    }
    if (copy.token) copy.token = '[removed]';
    var s = safe_(JSON.stringify(copy).slice(0, 4000));
    withLock_(function () { appendRow_('CONTACTS_ID', 'Quarantine', [new Date(), reason, cleanText_(copy.type, 30), s]); return {}; });
  } catch (e) { console.error(e); }
  return { ok: false, error: 'rejected' };
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
// For counting sends per inbox: ignore +tags everywhere, and dots in Gmail addresses.
function normaliseEmail_(email) {
  var parts = String(email).toLowerCase().split('@');
  var local = parts[0].split('+')[0], domain = parts[1] || '';
  if (domain === 'gmail.com' || domain === 'googlemail.com') { local = local.replace(/\./g, ''); domain = 'gmail.com'; }
  return local + '@' + domain;
}
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
function writeBudgetOk_(kind) {
  var minute = Math.floor(Date.now() / 60000), hour = Math.floor(Date.now() / 3600000);
  var quiz = kind === 'quiz';
  return rateOk_((quiz ? 'qm:' : 'm:') + minute, quiz ? SETTINGS.MAX_QUIZ_WRITES_PER_MINUTE : SETTINGS.MAX_WRITES_PER_MINUTE, 120) &&
         rateOk_((quiz ? 'qh:' : 'h:') + hour, quiz ? SETTINGS.MAX_QUIZ_WRITES_PER_HOUR : SETTINGS.MAX_WRITES_PER_HOUR, 3700);
}
// Whole-site daily email cap, counted in script properties (the cache can't hold a value for a full day).
// No lock here on purpose: a rare miscount under heavy load is harmless; a lost email is not.
function dailyEmailOk_() {
  var props = PropertiesService.getScriptProperties();
  var key = 'mail:' + Utilities.formatDate(new Date(), 'Europe/London', 'yyyy-MM-dd');
  var n = Number(props.getProperty(key) || 0);
  if (n >= SETTINGS.MAX_EMAILS_PER_DAY) return false;
  props.setProperty(key, String(n + 1));
  return true;
}
function archetypeKey_(a, b) { return [a, b].sort(function (x, y) { return NEEDS.indexOf(x) - NEEDS.indexOf(y); }).join('|'); }
function pick_(v, list, dflt) { v = String(v || '').toLowerCase(); for (var i = 0; i < list.length; i++) if (list[i].toLowerCase() === v) return list[i]; return dflt; }
// Text going into a spreadsheet cell: strip control characters and angle brackets, trim, cap the length,
// and if it could be read as a formula, store it as plain text instead.
function cleanText_(v, max) { return safe_(String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max)); }
function safe_(s) { s = String(s == null ? '' : s); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; }
function unsafe_(s) { return String(s == null ? '' : s).replace(/^'(?=[=+\-@])/, ''); }
function round_(n, d) { var f = Math.pow(10, d); return Math.round(Number(n) * f) / f; }
function ageRange_(age) {
  if (age < 25) return '18-24'; if (age < 35) return '25-34'; if (age < 45) return '35-44';
  if (age < 55) return '45-54'; if (age < 65) return '55-64'; return '65+';
}
