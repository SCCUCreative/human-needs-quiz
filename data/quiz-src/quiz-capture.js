// quiz-capture.js — sends quiz activity to the Google Apps Script collector (data/apps-script/Code.gs)
// and loads a person's report from their private "revisit" link (?r=<token>).
//
// Nothing is sent while HNQ_CONFIG.dataEndpoint is empty.
// What is sent, and when:
//   visit     page opened (once per browser session) — source only, no personal details
//   start     details submitted — age range and source, no name or email
//   age_gate  under-18 stop shown — a count only, nothing about the person
//   complete  results reached — first name, email, age + results (the collector stores the contact
//             details separately from the results, and emails the results with the revisit link)
//   share     a share button used — platform and card shape
//   feedback  "How accurately does this profile reflect you?" answered
//   opt_in / account_interest — only when switched on in HNQ_CONFIG.features (later, with the new site)
// Exposes window.HNQ_CAPTURE. Listens for the quiz's hnq:* window events.
(function () {
  var cfg = window.HNQ_CONFIG || {};
  var endpoint = cfg.dataEndpoint || '';
  var NEED_ORDER = ['certainty', 'variety', 'significance', 'connection', 'growth', 'contribution'];

  function uuid() {
    try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    var b = new Uint8Array(16); crypto.getRandomValues(b); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { return null; } }

  // ── Where people came from (first page of the visit wins) ────────────────
  var ctx = (function () {
    var saved = ss('hnq_ctx');
    if (saved) { try { return JSON.parse(saved); } catch (e) {} }
    var q = new URLSearchParams(location.search);
    var refHost = '';
    try { var r = document.referrer && new URL(document.referrer); if (r && r.host !== location.host) refHost = r.host.replace(/^www\./, ''); } catch (e) {}
    var src = q.get('src') || q.get('utm_source') || '';
    if (!src && refHost) src = /facebook|fb\.|instagram|linkedin|lnkd|t\.co$|twitter|x\.com|whatsapp|wa\.me/.test(refHost) ? refHost.split('.')[0] : 'referral';
    var w = Math.min(screen.width || innerWidth, innerWidth);
    var c = {
      session_id: uuid(),
      source: (src || 'direct').toLowerCase().slice(0, 60),
      medium: (q.get('utm_medium') || (q.get('src') === 'qr' ? 'qr' : '')).slice(0, 60),
      campaign: (q.get('utm_campaign') || '').slice(0, 80),
      referrer: refHost.slice(0, 120),
      device: w < 700 ? 'mobile' : w < 1100 ? 'tablet' : 'desktop',
    };
    ss('hnq_ctx', JSON.stringify(c));
    return c;
  })();

  var state = { assessmentId: ss('hnq_aid') || '', startedAt: Number(ss('hnq_t0')) || 0, token: ss('hnq_token') || '' };

  function base(type, extra) {
    var o = { type: type, session_id: ctx.session_id, assessment_id: state.assessmentId, source: ctx.source, medium: ctx.medium,
      campaign: ctx.campaign, referrer: ctx.referrer, device: ctx.device, quiz_version: cfg.quizVersion || '', hp: window.HNQ_HP || '' };
    for (var k in extra) o[k] = extra[k];
    return o;
  }

  function post(body, attempts) {
    if (!endpoint) return Promise.resolve({ ok: false, error: 'not_configured' });
    attempts = attempts || 1;
    // text/plain keeps this a "simple" request, so the browser doesn't need a pre-flight check.
    return fetch(endpoint, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      keepalive: JSON.stringify(body).length < 60000, credentials: 'omit', redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .catch(function (err) {
        if (attempts >= 3) return { ok: false, error: 'network' };
        return new Promise(function (res) { setTimeout(res, 1500 * attempts); }).then(function () { return post(body, attempts + 1); });
      });
  }

  function ageRange(age) {
    age = Number(age);
    if (!age) return '';
    return age < 25 ? '18-24' : age < 35 ? '25-34' : age < 45 ? '35-44' : age < 55 ? '45-54' : age < 65 ? '55-64' : '65+';
  }

  // ── Quiz events ──────────────────────────────────────────────────────────
  if (!new URLSearchParams(location.search).get('r') && !ss('hnq_visit')) {
    ss('hnq_visit', '1');
    post(base('visit', {}));
  }

  window.addEventListener('hnq:details', function (e) {
    var d = e.detail || {};
    state.assessmentId = uuid(); state.startedAt = Date.now(); state.token = '';
    ss('hnq_aid', state.assessmentId); ss('hnq_t0', String(state.startedAt)); ss('hnq_token', null);
    post(base('start', { age_range: ageRange(d.age) }));
  });

  window.addEventListener('hnq:age_gate', function () { post(base('age_gate', {})); });

  window.addEventListener('hnq:shared', function (e) {
    var x = (e.detail && e.detail.result && e.detail.result.extensions) || {};
    post(base('share', { channel: x['urn:hnq:channel'] || 'other', format: x['urn:hnq:format'] || '' }));
  });

  function round2(n) { return Math.round(Number(n) * 100) / 100; }

  window.addEventListener('hnq:complete', function (e) {
    var d = e.detail || {}, r = d.results || {}, who = d.learner || window.HNQ_LEARNER || {};
    if (!r.primary || !who.email) return;
    var pct = {}, raw = {}, ful = {};
    NEED_ORDER.forEach(function (n) {
      pct[n] = round2(r.percentages[n]); raw[n] = round2((r.rawScores || {})[n] || 0);
      ful[n] = (r.allFulfilment && r.allFulfilment[n] && r.allFulfilment[n].score) || 3;
    });
    var body = base('complete', {
      contact: { first_name: who.name, email: who.email, age: who.age },
      result: {
        primary: r.primary, secondary: r.secondary,
        archetype_key: (typeof archetypeKey === 'function') ? archetypeKey(r.primary, r.secondary) : '',
        confidence: r.confidence, fulfilment_state: r.fulfilmentState,
        percentages: pct, raw_scores: raw, fulfilment: ful,
        quiz_version: cfg.quizVersion || '', scoring_version: cfg.scoringVersion || '',
        duration_sec: state.startedAt ? Math.round((Date.now() - state.startedAt) / 1000) : 0,
        age_band: who.ageBand,
      },
    });
    post(body).then(function (res) {
      if (res && res.ok && res.token) { state.token = res.token; ss('hnq_token', res.token); }
      try { window.dispatchEvent(new CustomEvent('hnq:sent', { detail: { ok: !!(res && res.ok), emailed: !!(res && res.emailed), email: who.email, configured: !!endpoint } })); } catch (err) {}
    });
  });

  // ── Revisit link ─────────────────────────────────────────────────────────
  // Turns the stored row back into the same results object the quiz builds after the last question.
  function rebuild(x) {
    var ranked = NEED_ORDER.slice().sort(function (a, b) { return Number(x.percentages[b]) - Number(x.percentages[a]); });
    // keep the stored primary/secondary first even if two percentages tie
    ranked = [x.primary, x.secondary].concat(ranked.filter(function (n) { return n !== x.primary && n !== x.secondary; }));
    var all = {};
    NEED_ORDER.forEach(function (n) {
      var sc = Number(x.fulfilment[n]) || 3;
      all[n] = { score: sc, state: sc >= 4 ? 'Positive' : sc >= 3 ? 'Neutral' : 'Negative' };
    });
    var pct = {}, raw = {};
    NEED_ORDER.forEach(function (n) { pct[n] = Number(x.percentages[n]); raw[n] = Number(x.raw_scores[n]); });
    return {
      primary: x.primary, secondary: x.secondary, ranked: ranked, percentages: pct, confidence: x.confidence,
      archetype: (window.ARCHETYPE_DATA || (typeof ARCHETYPE_DATA !== 'undefined' ? ARCHETYPE_DATA : {}))[x.archetype_key] || null,
      fulfilmentState: x.fulfilment_state, allFulfilment: all, rawScores: raw,
    };
  }

  function fetchReport(token) {
    if (!endpoint) return Promise.resolve({ ok: false, error: 'not_configured' });
    return fetch(endpoint + (endpoint.indexOf('?') < 0 ? '?' : '&') + 'action=report&token=' + encodeURIComponent(token), { credentials: 'omit', redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok || !res.result) return { ok: false, error: (res && res.error) || 'not_found' };
        var x = res.result;
        state.assessmentId = x.assessment_id || ''; state.token = token;
        return { ok: true, results: rebuild(x), firstName: x.first_name || '', ageBand: Number(x.age_band) || 3, date: x.date || '',
          assessmentId: x.assessment_id || '', accuracy: x.accuracy || '' };
      })
      .catch(function () { return { ok: false, error: 'network' }; });
  }

  // ── Report actions ───────────────────────────────────────────────────────
  function feedback(label) { return post(base('feedback', { accuracy: label })); }
  function optIn(value) { return state.token ? post(base('opt_in', { token: state.token, value: value !== false })) : Promise.resolve({ ok: false, error: 'no_token' }); }
  function accountInterest() { return state.token ? post(base('account_interest', { token: state.token })) : Promise.resolve({ ok: false, error: 'no_token' }); }

  window.HNQ_CAPTURE = {
    configured: !!endpoint, context: ctx, fetchReport: fetchReport, feedback: feedback, optIn: optIn, accountInterest: accountInterest,
    assessmentId: function () { return state.assessmentId; }, hasToken: function () { return !!state.token; },
  };
})();
