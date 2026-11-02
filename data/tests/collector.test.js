// Runs the real Code.gs against in-memory Google services.  Usage:  node data/tests/collector.test.js
const assert = require('assert');
const { loadCollector } = require('./fake-gas');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + (e && e.stack || e)); process.exitCode = 1; }
}

const NEEDS = ['certainty', 'variety', 'significance', 'connection', 'growth', 'contribution'];
function complete(over = {}) {
  const pct = { certainty: 26.4, variety: 9.1, significance: 12.5, connection: 22.7, growth: 15.3, contribution: 14 };
  const base = {
    type: 'complete', session_id: 'sess-1234-abcd', assessment_id: 'a-' + Math.random().toString(16).slice(2, 14),
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

console.log('collector');

test('setup creates both spreadsheets with the right tabs and a daily trigger', () => {
  const c = loadCollector(); c.setup();
  const contacts = c.store[c.props.CONTACTS_ID], results = c.store[c.props.RESULTS_ID];
  assert.deepStrictEqual(contacts.getSheets().map(s => s.getName()), ['Contacts', 'Quarantine', 'Erasure log']);
  assert.deepStrictEqual(results.getSheets().map(s => s.getName()), ['Assessments', 'Events']);
  assert.strictEqual(c.triggers.length, 1);
  c.setup(); // re-running is safe
  assert.strictEqual(c.triggers.length, 1);
  assert.strictEqual(Object.keys(c.store).length, 2);
});

test('complete: saves contact separately from results, emails a revisit link, returns a token', () => {
  const c = loadCollector(); c.setup();
  const res = c.post(complete());
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.match(res.token, /^[A-Za-z0-9_-]{32}$/);
  const contacts = c.table('CONTACTS_ID', 'Contacts'), a = c.table('RESULTS_ID', 'Assessments');
  assert.strictEqual(contacts.length, 1); assert.strictEqual(a.length, 1);
  assert.strictEqual(contacts[0].email, 'sam@example.com');
  assert.strictEqual(contacts[0].first_name, 'Sam');
  assert.strictEqual(a[0].participant_id, contacts[0].participant_id);
  assert.strictEqual(a[0].archetype, 'The Anchor');
  assert.strictEqual(a[0].age_range, '25-34');
  assert.strictEqual(a[0].email_status, 'sent');
  // no personal details in the results spreadsheet
  const resultsText = JSON.stringify(c.rows('RESULTS_ID', 'Assessments')) + JSON.stringify(c.rows('RESULTS_ID', 'Events'));
  assert.ok(!/sam@example\.com/i.test(resultsText) && !/"Sam"/.test(resultsText) && !resultsText.includes(res.token));
  // email
  assert.strictEqual(c.mails.length, 1);
  const m = c.mails[0];
  assert.strictEqual(m.to, 'sam@example.com'); assert.strictEqual(m.name, 'Scott Free');
  assert.ok(m.subject.includes('The Anchor'));
  assert.ok(m.htmlBody.includes('https://scottfree.live/human-needs-quiz/?r=' + res.token));
  assert.ok(m.htmlBody.includes('?r=' + res.token + '&amp;print=1'));
  assert.ok(m.body.includes('Revisit your full report: https://scottfree.live/human-needs-quiz/?r=' + res.token));
  assert.ok(!/Stay connected|personal space/.test(m.htmlBody), 'opt-in/account sections must be off');
});

test('returning participant keeps the same ID, attempt number goes up', () => {
  const c = loadCollector(); c.setup();
  const r1 = c.post(complete()), r2 = c.post(complete({ contact: { email: 'sam@example.com' } }));
  assert.strictEqual(r1.participant_id, r2.participant_id);
  const a = c.table('RESULTS_ID', 'Assessments');
  assert.deepStrictEqual(a.map(x => x.attempt), [1, 2]);
  assert.deepStrictEqual(a.map(x => x.returning), ['no', 'yes']);
  assert.strictEqual(c.table('CONTACTS_ID', 'Contacts').length, 1);
});

test('same assessment sent twice (network retry) is stored once', () => {
  const c = loadCollector(); c.setup();
  const body = complete();
  c.post(body); const again = c.post(body);
  assert.strictEqual(again.dup, true);
  assert.strictEqual(c.table('RESULTS_ID', 'Assessments').length, 1);
  assert.strictEqual(c.mails.length, 1);
});

test('report link returns the results and first name, counts views', () => {
  const c = loadCollector(); c.setup();
  const { token } = c.post(complete());
  const rep = c.get({ action: 'report', token });
  assert.strictEqual(rep.ok, true);
  assert.strictEqual(rep.result.first_name, 'Sam');
  assert.strictEqual(rep.result.archetype_key, 'certainty|connection');
  assert.strictEqual(rep.result.percentages.certainty, 26.4);
  assert.strictEqual(rep.result.age_band, 3);
  assert.ok(!('email' in rep.result));
  c.get({ action: 'report', token });
  assert.strictEqual(c.table('RESULTS_ID', 'Assessments')[0].report_views, 2);
  assert.strictEqual(c.get({ action: 'report', token: 'x'.repeat(32) }).ok, false);
  assert.strictEqual(c.get({ action: 'report', token: '../etc' }).error, 'invalid');
});

test('feedback updates the assessment and logs an event', () => {
  const c = loadCollector(); c.setup();
  const body = complete(); c.post(body);
  assert.strictEqual(c.post({ type: 'feedback', assessment_id: body.assessment_id, session_id: 'sess-1234-abcd', accuracy: 'Very' }).ok, true);
  const a = c.table('RESULTS_ID', 'Assessments')[0];
  assert.strictEqual(a.accuracy, 'Very'); assert.strictEqual(a.accuracy_score, 4);
  assert.ok(c.table('RESULTS_ID', 'Events').some(e => e.event === 'feedback' && e.detail === 'Very'));
  assert.strictEqual(c.post({ type: 'feedback', assessment_id: body.assessment_id, accuracy: 'Kinda' }).ok, false);
});

test('visit, start, age_gate and share events carry no personal details', () => {
  const c = loadCollector(); c.setup();
  c.post({ type: 'visit', session_id: 'sess-aaaa-1111', source: 'qr', medium: 'qr', device: 'mobile', quiz_version: '1.0.0' });
  c.post({ type: 'visit', session_id: 'sess-aaaa-1111', source: 'qr' }); // same session: counted once
  c.post({ type: 'start', session_id: 'sess-aaaa-1111', assessment_id: 'aid-0000-1111', age_range: '25-34', email: 'leak@example.com' });
  c.post({ type: 'age_gate', session_id: 'sess-aaaa-1111' });
  c.post({ type: 'share', session_id: 'sess-aaaa-1111', channel: 'WhatsApp', format: 'card' });
  const ev = c.table('RESULTS_ID', 'Events');
  assert.deepStrictEqual(ev.map(e => e.event), ['visit', 'start', 'age_gate', 'share']);
  assert.strictEqual(ev[1].detail, '25-34');
  assert.strictEqual(ev[3].detail, 'whatsapp');
  assert.ok(!JSON.stringify(c.rows('RESULTS_ID', 'Events')).includes('leak@'));
});

test('rejects bad submissions into Quarantine and never emails them', () => {
  const c = loadCollector(); c.setup();
  const bad = [
    complete({ hp: 'http://spam' }),
    complete({ contact: { age: 16 } }),
    complete({ contact: { email: 'not-an-email' } }),
    complete({ result: { archetype_key: 'variety|growth' } }),
    complete({ result: { duration_sec: 12 } }),
    complete({ result: { confidence: 'Huge' } }),
    complete({ result: { percentages: { certainty: 80 } } }),
    complete({ result: { age_band: 1 } }),
    complete({ result: { quiz_version: '9.9.9' } }),
    complete({ result: { primary: 'connection', secondary: 'certainty' } }), // primary lower than secondary
    { type: 'drop_table' },
  ];
  bad.forEach(b => assert.strictEqual(c.post(b).ok, false, JSON.stringify(b).slice(0, 120)));
  assert.strictEqual(c.post('{not json').error, 'bad_json');
  assert.strictEqual(c.post('x'.repeat(20000)).error, 'too_large');
  assert.strictEqual(c.table('RESULTS_ID', 'Assessments').length, 0);
  assert.strictEqual(c.mails.length, 0);
  assert.strictEqual(c.table('CONTACTS_ID', 'Quarantine').length, bad.length);
});

test('limits completions per email per hour', () => {
  const c = loadCollector(); c.setup();
  const out = [1, 2, 3, 4].map(() => c.post(complete()).ok);
  assert.deepStrictEqual(out, [true, true, true, false]);
  assert.strictEqual(c.mails.length, 3);
});

test('spreadsheet formula injection is neutralised', () => {
  const c = loadCollector(); c.setup();
  c.post(complete({ contact: { first_name: '=HYPERLINK("http://x","y")' } }));
  assert.ok(!String(c.table('CONTACTS_ID', 'Contacts')[0].first_name).startsWith('='));
});

test('a failed email is recorded but the results are still saved', () => {
  const c = loadCollector({ mailFails: true }); c.setup();
  const res = c.post(complete());
  assert.strictEqual(res.ok, true); assert.strictEqual(res.emailed, false);
  assert.strictEqual(c.table('RESULTS_ID', 'Assessments')[0].email_status, 'failed');
});

test('opt-in and account interest are off until switched on, then need the report token', () => {
  const c = loadCollector(); c.setup();
  const { token } = c.post(complete());
  assert.strictEqual(c.post({ type: 'opt_in', token, value: true }).error, 'not_enabled');
  c.ctx.SETTINGS.FEATURES.stayConnected = true; c.ctx.SETTINGS.FEATURES.accounts = true;
  assert.strictEqual(c.post({ type: 'opt_in', token: 'y'.repeat(32), value: true }).ok, false);
  assert.strictEqual(c.post({ type: 'opt_in', token, value: true }).ok, true);
  assert.strictEqual(c.post({ type: 'account_interest', token }).ok, true);
  const p = c.table('CONTACTS_ID', 'Contacts')[0];
  assert.strictEqual(p.marketing_opt_in, 'yes'); assert.ok(p.marketing_opt_in_at instanceof Date);
  assert.strictEqual(p.marketing_opt_in_wording, 'opt-in-v1'); assert.strictEqual(p.account_interest, 'yes');
  // and the email now mentions both
  c.post(complete({ contact: { email: 'other@example.com' } }));
  assert.ok(/Stay connected/.test(c.mails[1].htmlBody) && /personal space/.test(c.mails[1].htmlBody));
});

test('retention clean-up and erasure', () => {
  let t = Date.now();
  const c = loadCollector({ clock: () => t }); c.setup();
  const keep = c.post(complete({ contact: { email: 'keep@example.com' } }));
  const old = c.post(complete({ contact: { email: 'old@example.com' } }));
  const rows = c.rows('CONTACTS_ID', 'Contacts');
  const seenCol = rows[0].indexOf('last_seen');
  const longAgo = new Date(); longAgo.setMonth(longAgo.getMonth() - 13);
  rows.find(r => r.includes('old@example.com'))[seenCol] = longAgo;
  assert.strictEqual(c.ctx.dailyCleanup(), 1);
  assert.deepStrictEqual(c.table('CONTACTS_ID', 'Contacts').map(x => x.email), ['keep@example.com']);
  // old person's revisit link still works, without a name
  const rep = c.get({ action: 'report', token: old.token });
  assert.strictEqual(rep.ok, true); assert.strictEqual(rep.result.first_name, '');
  // erasure request removes the contact and switches off their links
  assert.strictEqual(c.ctx.eraseByEmail('KEEP@example.com'), 2);
  assert.strictEqual(c.table('CONTACTS_ID', 'Contacts').length, 0);
  assert.strictEqual(c.get({ action: 'report', token: keep.token }).ok, false);
  assert.strictEqual(c.table('CONTACTS_ID', 'Erasure log').length, 2);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
