// Local stand-in for the deployed Apps Script web app, running the real Code.gs in memory.
// Usage:  node data/tests/dev-server.js [port]     then set HNQ_CONFIG.dataEndpoint to http://localhost:<port>/exec
// Extra test-only routes: GET /_mails (emails "sent"), GET /_tables (spreadsheet contents).
const http = require('http');
const { loadCollector } = require('./fake-gas');

const port = Number(process.argv[2] || 8771);
const c = loadCollector();
c.setup();
// Quick manual runs can't take minutes per quiz: HNQ_MIN_SECONDS=0 node data/tests/dev-server.js
if (process.env.HNQ_MIN_SECONDS) c.ctx.SETTINGS.MIN_COMPLETE_SECONDS = Number(process.env.HNQ_MIN_SECONDS);

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(obj)); };
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
  if (url.pathname === '/_mails') return send(c.mails);
  if (url.pathname === '/_tables') return send({
    contacts: c.table('CONTACTS_ID', 'Contacts'), quarantine: c.table('CONTACTS_ID', 'Quarantine'),
    assessments: c.table('RESULTS_ID', 'Assessments'), events: c.table('RESULTS_ID', 'Events'),
  });
  if (req.method === 'GET') return send(c.get(Object.fromEntries(url.searchParams)));
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => send(c.post(body)));
}).listen(port, () => console.log('collector dev server on http://localhost:' + port + '/exec'));
