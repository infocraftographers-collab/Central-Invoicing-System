#!/usr/bin/env node
/**
 * Local preview server. No Google account needed.
 *
 * Runs the real apps-script/Code.gs against an in-memory imitation of a
 * Google Sheet (saved to dev/.data.json) and serves the web/ folder.
 *
 *   node dev/server.js          -> http://localhost:8080
 *   DEV_ADMIN_PIN=123456 node dev/server.js   (sets the local admin PIN)
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const DATA_FILE = process.env.DEV_DATA_FILE || path.join(__dirname, '.data.json');
const PORT = Number(process.env.PORT || process.argv[2] || 8080);

// ---------------------------------------------------------------- fake Sheet
const revive = (k, v) => (v && typeof v === 'object' && v.__date ? new Date(v.__date) : v);
const replace = function (k, v) { return this[k] instanceof Date ? { __date: this[k].toISOString() } : v; };

let store = { sheets: {}, formats: {}, props: {} };
if (fs.existsSync(DATA_FILE)) store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'), revive);
const persist = () => fs.writeFileSync(DATA_FILE, JSON.stringify(store, replace));

const signed = (buf) => Array.from(buf).map((b) => (b > 127 ? b - 256 : b));

function makeSheet(name) {
  const rows = () => store.sheets[name];
  const fmts = () => (store.formats[name] = store.formats[name] || {});
  const sheet = {
    getName: () => name,
    getLastRow() {
      const r = rows();
      for (let i = r.length - 1; i >= 0; i--) if (r[i].some((v) => v !== '' && v !== null && v !== undefined)) return i + 1;
      return 0;
    },
    setFrozenRows() {},
    deleteRow(n) { rows().splice(n - 1, 1); persist(); },
    getRange(row, col, numRows = 1, numCols = 1) {
      const range = {
        getValues() {
          const out = [];
          for (let r = 0; r < numRows; r++) {
            const src = rows()[row - 1 + r] || [];
            const line = [];
            for (let c = 0; c < numCols; c++) line.push(src[col - 1 + c] === undefined ? '' : src[col - 1 + c]);
            out.push(line);
          }
          return out;
        },
        setNumberFormats(f) {
          for (let r = 0; r < numRows; r++) for (let c = 0; c < numCols; c++) fmts()[(row + r) + ':' + (col + c)] = f[r][c];
          return range;
        },
        setValues(values) {
          if (values.length !== numRows || values[0].length !== numCols) throw new Error('setValues: size mismatch');
          for (let r = 0; r < numRows; r++) {
            while (rows().length < row + r) rows().push([]);
            const line = rows()[row - 1 + r];
            for (let c = 0; c < numCols; c++) {
              let v = values[r][c];
              const isText = fmts()[(row + r) + ':' + (col + c)] === '@';
              if (typeof v === 'string') {
                // Imitate Sheets: a leading apostrophe marks text; otherwise
                // number-looking text in a non-text cell becomes a number.
                if (v.startsWith("'")) v = v.slice(1);
                else if (!isText && v !== '' && !isNaN(Number(v))) v = Number(v);
                else if (!isText && /^[=+]/.test(v)) throw new Error('fake Sheet: formula written to ' + name);
              }
              line[col - 1 + c] = v;
            }
          }
          persist();
          return range;
        },
        setFontWeight: () => range,
        setBackground: () => range
      };
      return range;
    }
  };
  return sheet;
}

const book = {
  getSheetByName: (n) => (store.sheets[n] ? makeSheet(n) : null),
  insertSheet(n) { store.sheets[n] = []; persist(); return makeSheet(n); },
  getUrl: () => 'https://docs.google.com/spreadsheets/ (local preview has no real Sheet)'
};

const cache = new Map();
const sandbox = {
  console,
  SpreadsheetApp: {
    getActiveSpreadsheet: () => book,
    getUi() { throw new Error('no UI in local preview'); }
  },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput(text) { const o = { getContent: () => text, setMimeType: () => o }; return o; }
  },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => (k in store.props ? store.props[k] : null),
      setProperty(k, v) { store.props[k] = v; persist(); }
    })
  },
  CacheService: {
    getScriptCache: () => ({
      get(k) { const e = cache.get(k); return e && e.until > Date.now() ? e.value : null; },
      put(k, v, seconds) { cache.set(k, { value: v, until: Date.now() + seconds * 1000 }); },
      remove(k) { cache.delete(k); }
    })
  },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    getUuid: () => crypto.randomUUID(),
    computeDigest: (alg, text) => signed(crypto.createHash('sha256').update(text, 'utf8').digest()),
    computeHmacSha256Signature: (text, key) => signed(crypto.createHmac('sha256', key).update(text, 'utf8').digest())
  },
  Logger: { log: (m) => console.log('[setup]\n' + m) }
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script', 'Code.gs'), 'utf8'), sandbox, { filename: 'Code.gs' });

const firstRun = !store.sheets.Users;
if (firstRun) vm.runInContext('setup()', sandbox);
if (process.env.DEV_ADMIN_PIN) {
  sandbox.__pin = process.env.DEV_ADMIN_PIN;
  vm.runInContext("(function(){var u=findUser_('admin');u.pin_salt='dev';u.pin_hash=hashPin_(__pin,'dev');writeRow_('Users',u._row,u);})()", sandbox);
  console.log('Local admin PIN set from DEV_ADMIN_PIN.');
}

// ---------------------------------------------------------------- web server
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const out = sandbox.doPost({ postData: { contents: body } }).getContent();
      // A real Apps Script call takes about a second; imitate that so loading states are visible.
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(out);
      }, Number(process.env.DEV_DELAY_MS || 350));
    });
    return;
  }
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const base = rel === 'dev/print-test.html' ? ROOT : WEB;
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('Not found'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log('Central Invoicing System preview: http://localhost:' + PORT));
