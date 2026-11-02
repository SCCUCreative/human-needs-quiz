/**
 * The Scott Free results email. Sent from the account running the script (creative@sccu.uk.com),
 * shown with SETTINGS.SENDER_NAME ("Scott Free") as the sender name.
 * It is a service email (the results the person asked for), so it carries no marketing.
 * The "stay connected" and "create your account" sections only appear once switched on in SETTINGS.FEATURES.
 */

var NEED_INFO = {
  certainty:    { label: 'Certainty',    desc: 'Stability, predictability and security' },
  variety:      { label: 'Variety',      desc: 'Change, excitement and new experiences' },
  significance: { label: 'Significance', desc: 'Feeling unique, important and valued' },
  connection:   { label: 'Connection',   desc: 'Love, intimacy and belonging' },
  growth:       { label: 'Growth',       desc: 'Learning, evolving and expanding' },
  contribution: { label: 'Contribution', desc: 'Giving, serving and making a difference' },
};

var C = { olive: '#434B30', oliveDeep: '#343B25', sand: '#E3DED2', paper: '#F6F3EC', ink: '#2F2E2C', muted: '#6B6656', clay: '#875F45' };

function sendResultsEmail_(contact, r, url) {
  var a = ARCHETYPES[r.archetype_key];
  var subject = contact.first_name + ', you’re ' + a.name + ' — your Six Human Needs results';
  var opts = { to: contact.email, subject: subject, name: SETTINGS.SENDER_NAME,
    htmlBody: buildEmailHtml_(contact, r, url), body: buildEmailText_(contact, r, url) };
  if (SETTINGS.REPLY_TO) opts.replyTo = SETTINGS.REPLY_TO;
  MailApp.sendEmail(opts);
}

function pdfUrl_(url) { return url + '&print=1'; }
function esc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function pct_(n) { return Math.round(Number(n)) + '%'; }
function heroUrl_(hero) { return String(hero || '').replace('/image/upload/', '/image/upload/f_jpg,q_auto:good,w_1200,c_limit/'); }

function buildEmailHtml_(contact, r, url) {
  var a = ARCHETYPES[r.archetype_key];
  var p = NEED_INFO[r.primary], s = NEED_INFO[r.secondary];
  var site = SETTINGS.QUIZ_URL.replace(/human-needs-quiz\/?$/, '');
  var btn = function (href, label, primary) {
    return '<a href="' + esc_(href) + '" style="display:inline-block;background:' + (primary ? C.clay : 'transparent') + ';color:' + (primary ? '#ffffff' : C.clay) +
      ';border:2px solid ' + C.clay + ';border-radius:999px;padding:13px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;margin:6px 4px">' + esc_(label) + '</a>';
  };
  var needRow = function (label, need, meta) {
    return '<tr><td style="padding:12px 0;border-top:1px solid #E4DFD3;font-family:Arial,Helvetica,sans-serif">' +
      '<div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:' + C.muted + '">' + label + '</div>' +
      '<div style="font-size:18px;font-weight:bold;color:' + C.ink + ';margin-top:3px">' + esc_(meta.label) +
      ' <span style="font-weight:normal;color:' + C.muted + '">&middot; ' + pct_(r.percentages[need]) + '</span></div>' +
      '<div style="font-size:14px;color:' + C.muted + ';margin-top:2px">' + esc_(meta.desc) + '</div></td></tr>';
  };
  var glance = (a.glance || []).map(function (g) {
    return '<li style="margin:0 0 6px">' + esc_(g) + '</li>';
  }).join('');
  var connect = '';
  if (SETTINGS.FEATURES.stayConnected) {
    connect += '<tr><td style="padding:24px 32px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:' + C.ink + '">' +
      '<strong>Stay connected.</strong> Want future Scott Free insights, content and discoveries? You can opt in from the end of your report. It’s entirely your choice.</td></tr>';
  }
  if (SETTINGS.FEATURES.accounts) {
    connect += '<tr><td style="padding:16px 32px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:' + C.ink + '">' +
      '<strong>Your personal space.</strong> Create your account to save your results and continue your self-discovery journey. Find the link at the end of your report.</td></tr>';
  }
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc_(a.name) + '</title></head>' +
  '<body style="margin:0;padding:0;background:' + C.paper + '">' +
  '<div style="display:none;max-height:0;overflow:hidden">Your archetype, your top two needs and your full report, ready whenever you want to come back to it.</div>' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + C.paper + '"><tr><td align="center" style="padding:24px 12px">' +
  '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden">' +
    '<tr><td align="center" style="background:' + C.olive + ';padding:28px 24px 24px">' +
      '<img src="' + esc_(site) + 'sf-logo-white.png" width="170" alt="Scott Free Group" style="display:block;width:170px;height:auto;border:0">' +
      '<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:' + C.sand + ';margin-top:14px;opacity:.8">The Six Human Needs</div></td></tr>' +
    (a.hero ? '<tr><td><img src="' + esc_(heroUrl_(a.hero)) + '" width="600" alt="" style="display:block;width:100%;height:auto;border:0"></td></tr>' : '') +
    '<tr><td style="padding:30px 32px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:' + C.ink + '">' +
      '<p style="margin:0 0 14px">Hi ' + esc_(contact.first_name) + ',</p>' +
      '<p style="margin:0">Thank you for taking the Six Human Needs Quiz. Here’s what your answers revealed about what drives you, and your full report to come back to whenever you like.</p></td></tr>' +
    '<tr><td style="padding:26px 32px 0;font-family:Arial,Helvetica,sans-serif">' +
      '<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:' + C.clay + ';font-weight:bold">Your archetype</div>' +
      '<div style="font-family:Georgia,serif;font-size:32px;line-height:1.2;color:' + C.olive + ';margin-top:6px">' + esc_(a.name) + '</div>' +
      (a.together ? '<div style="font-size:16px;line-height:1.5;color:' + C.muted + ';margin-top:8px;font-style:italic">' + esc_(a.together) + '</div>' : '') +
      (glance ? '<ul style="margin:16px 0 0;padding-left:20px;font-size:15px;line-height:1.5;color:' + C.ink + '">' + glance + '</ul>' : '') + '</td></tr>' +
    '<tr><td style="padding:20px 32px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
      needRow('Primary need', r.primary, p) + needRow('Secondary need', r.secondary, s) + '</table></td></tr>' +
    '<tr><td align="center" style="padding:28px 24px 6px">' + btn(url, 'Revisit your full report', true) + btn(pdfUrl_(url), 'Download your workbook (PDF)', false) + '</td></tr>' +
    '<tr><td style="padding:10px 32px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:' + C.muted + ';text-align:center">' +
      'Keep this email: the link is personal to you and is your way back to your results.</td></tr>' +
    connect +
    '<tr><td style="padding:30px 32px 30px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:' + C.ink + '">' +
      'With warmth,<br><strong>Scott Free</strong></td></tr>' +
  '</table>' +
  '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px"><tr><td style="padding:18px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:' + C.muted + ';text-align:center">' +
    'You’re receiving this because you took the Six Human Needs Quiz at ' + esc_(SETTINGS.QUIZ_URL.replace(/^https?:\/\//, '').replace(/\/$/, '')) + ' and asked for your results. ' +
    (SETTINGS.FEATURES.stayConnected ? 'We won’t send you marketing unless you choose to stay connected.' : 'This is a one-off email with your results; we won’t add you to any mailing list.') +
    '<br>&copy; Scott Free Group</td></tr></table>' +
  '</td></tr></table></body></html>';
}

function buildEmailText_(contact, r, url) {
  var a = ARCHETYPES[r.archetype_key];
  return 'Hi ' + contact.first_name + ',\n\n' +
    'Thank you for taking the Six Human Needs Quiz. Here’s what your answers revealed.\n\n' +
    'YOUR ARCHETYPE: ' + a.name + '\n' + (a.together ? a.together + '\n' : '') + '\n' +
    'Primary need: ' + NEED_INFO[r.primary].label + ' (' + pct_(r.percentages[r.primary]) + ')\n' +
    'Secondary need: ' + NEED_INFO[r.secondary].label + ' (' + pct_(r.percentages[r.secondary]) + ')\n\n' +
    'Revisit your full report: ' + url + '\n' +
    'Download your workbook (PDF): ' + pdfUrl_(url) + '\n\n' +
    'Keep this email: the link is personal to you and is your way back to your results.\n\n' +
    'With warmth,\nScott Free\n\n' +
    'You’re receiving this because you took the Six Human Needs Quiz and asked for your results. ' +
    (SETTINGS.FEATURES.stayConnected ? 'We won’t send you marketing unless you choose to stay connected.' : 'This is a one-off email with your results; we won’t add you to any mailing list.');
}
