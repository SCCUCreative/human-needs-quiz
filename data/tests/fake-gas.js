// In-memory stand-ins for the Google Apps Script services Code.gs uses, so the real collector
// code can run under Node for tests (data/tests/collector.test.js) and for local end-to-end checks
// (data/tests/dev-server.js). Not used in production.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function makeSheet(name) {
  const rows = [];
  const sh = {
    _rows: rows, _name: name,
    getName: () => name,
    getLastRow: () => rows.length,
    appendRow: (r) => { rows.push(r.slice()); return sh; },
    deleteRow: (n) => { rows.splice(n - 1, 1); },
    setFrozenRows: () => sh,
    getDataRange: () => sh.getRange(1, 1, Math.max(rows.length, 1), Math.max(...rows.map(r => r.length), 1)),
    getRange: (r, c, nr = 1, nc = 1) => {
      const range = {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((rows[r - 1 + i] || [])[c - 1 + j] ?? ''))),
        getValue: () => ((rows[r - 1] || [])[c - 1] ?? ''),
        setValues: (vals) => { vals.forEach((row, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; row.forEach((v, j) => { rows[r - 1 + i][c - 1 + j] = v; }); }); return range; },
        setValue: (v) => { rows[r - 1] = rows[r - 1] || []; rows[r - 1][c - 1] = v; return range; },
        setFontWeight: () => range,
        createTextFinder: (text) => {
          let exact = false;
          const f = {
            matchEntireCell: (b) => { exact = b; return f; },
            findNext: () => {
              for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
                const v = String((rows[r - 1 + i] || [])[c - 1 + j] ?? '');
                if (exact ? v === text : v.includes(text)) return { getRow: () => r + i };
              }
              return null;
            },
          };
          return f;
        },
      };
      return range;
    },
  };
  return sh;
}

function makeSpreadsheet(name, id) {
  const sheets = [makeSheet('Sheet1')];
  return {
    _sheets: sheets, getId: () => id, getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id, getName: () => name,
    getSheetByName: (n) => sheets.find(s => s.getName() === n) || null,
    insertSheet: (n) => { const s = makeSheet(n); sheets.push(s); return s; },
    deleteSheet: (s) => { sheets.splice(sheets.indexOf(s), 1); },
    getSheets: () => sheets.slice(),
  };
}

function loadCollector(opts = {}) {
  const dir = path.join(__dirname, '..', 'apps-script');
  const files = ['ArchetypeData.gs', 'Email.gs', 'Code.gs'];
  const store = {}, props = {}, cache = {}, mails = [], triggers = [];
  const now = () => (opts.clock ? opts.clock() : Date.now());
  const ctx = {
    console, Date, Math, JSON, String, Number, Array, Object, RegExp, isFinite, encodeURIComponent,
    Logger: { log: () => {} },
    SpreadsheetApp: {
      create: (name) => { const id = 'ss' + (Object.keys(store).length + 1); store[id] = makeSpreadsheet(name, id); return store[id]; },
      openById: (id) => { if (!store[id]) throw new Error('no spreadsheet ' + id); return store[id]; },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = String(v); } }) },
    CacheService: { getScriptCache: () => ({
      get: (k) => { const e = cache[k]; return e && e.exp > now() ? e.v : null; },
      put: (k, v, s) => { cache[k] = { v, exp: now() + s * 1000 }; },
    }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes.map(b => b & 255)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      formatDate: (d, tz, fmt) => d.toISOString().slice(0, 10),
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ _text: t, setMimeType() { return this; }, getContent() { return this._text; } }) },
    MailApp: { sendEmail: (o) => { if (opts.mailFails) throw new Error('quota'); mails.push(o); } },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(), deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
      newTrigger: (fn) => { const t = { getHandlerFunction: () => fn }; const b = { timeBased: () => b, everyDays: () => b, atHour: () => b, create: () => { triggers.push(t); return t; } }; return b; },
    },
  };
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  const sheetRows = (propKey, name) => store[props[propKey]].getSheetByName(name)._rows;
  return {
    ctx, store, props, mails, triggers,
    setup: () => ctx.setup(),
    post: (body) => JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent()),
    get: (params) => JSON.parse(ctx.doGet({ parameter: params }).getContent()),
    rows: sheetRows,
    table: (propKey, name) => { const [h, ...rs] = sheetRows(propKey, name); return rs.map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); },
  };
}

module.exports = { loadCollector };
