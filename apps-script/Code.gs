/**
 * Central Invoicing System — Google Sheet backend
 *
 * This script lives inside the Google Sheet (Extensions > Apps Script).
 * The Sheet is the database: every invoice is one row in the "Invoices" tab
 * and one row per line item in the "Invoice Items" tab.
 *
 * First-time use:  run setup()  once from the Apps Script editor.
 * Forgot admin PIN: run resetAdminPin().
 */

var TOKEN_DAYS = 7;
var MAX_FAILED_LOGINS = 5;
var LOCK_MINUTES = 15;

// Column types: t = text (kept exactly as typed), n = number, d = date/time
var SCHEMA = {
  'Invoices': [
    ['id', 'Invoice ID', 't'], ['created_at', 'Created At', 'd'], ['created_by', 'Created By', 't'],
    ['firm_name', 'Firm', 't'], ['firm_id', 'Firm ID', 't'],
    ['invoice_no', 'Invoice No', 't'], ['invoice_date', 'Invoice Date', 't'],
    ['client_name', 'Client Name', 't'], ['client_address', 'Client Address', 't'],
    ['client_gstin', 'Client GSTIN', 't'], ['client_phone', 'Client Phone', 't'],
    ['client_email', 'Client Email', 't'], ['ship_to', 'Ship To', 't'], ['notes', 'PO / Reference', 't'],
    ['tax_type', 'Tax Type', 't'], ['sub_total_qty', 'Total Qty', 'n'],
    ['sub_total_price', 'Taxable Value', 'n'],
    ['cgst_rate', 'CGST %', 'n'], ['cgst_amount', 'CGST Amount', 'n'],
    ['sgst_rate', 'SGST %', 'n'], ['sgst_amount', 'SGST Amount', 'n'],
    ['igst_rate', 'IGST %', 'n'], ['igst_amount', 'IGST Amount', 'n'],
    ['round_off', 'Round Off', 'n'], ['grand_total', 'Grand Total', 'n'],
    ['total_words', 'Amount in Words', 't'], ['status', 'Status', 't'],
    ['updated_at', 'Updated At', 'd'], ['updated_by', 'Updated By', 't'],
    ['items_json', 'Items (app data - do not edit)', 't']
  ],
  'Invoice Items': [
    ['invoice_id', 'Invoice ID', 't'], ['firm_name', 'Firm', 't'], ['invoice_no', 'Invoice No', 't'],
    ['invoice_date', 'Invoice Date', 't'], ['client_name', 'Client Name', 't'],
    ['sno', 'S.No', 'n'], ['item', 'Description', 't'], ['hsn', 'HSN / SAC', 't'],
    ['qty', 'Qty', 'n'], ['unit_price', 'Unit Price', 'n'], ['total_price', 'Total', 'n']
  ],
  'Firms': [
    ['id', 'Firm ID', 't'], ['name', 'Name', 't'], ['address', 'Address', 't'], ['email', 'Email', 't'],
    ['gstin', 'GSTIN', 't'], ['phone', 'Phone', 't'], ['state', 'State', 't'], ['state_code', 'State Code', 't'],
    ['bank_name', 'Bank Name', 't'], ['account_name', 'Account Name', 't'], ['account_no', 'Account No', 't'],
    ['ifsc_code', 'IFSC', 't'], ['upi_id', 'UPI ID', 't'], ['logo_url', 'Logo', 't'],
    ['theme_color', 'Theme Color', 't'], ['invoice_prefix', 'Invoice Prefix', 't'],
    ['next_invoice_no', 'Next Invoice No', 'n'], ['active', 'Active', 't']
  ],
  'Clients': [
    ['id', 'Client ID', 't'], ['name', 'Name', 't'], ['address', 'Address', 't'], ['gstin', 'GSTIN', 't'],
    ['phone', 'Phone', 't'], ['email', 'Email', 't'], ['created_at', 'Created At', 'd']
  ],
  'Users': [
    ['username', 'Username', 't'], ['name', 'Full Name', 't'], ['role', 'Role (admin/member)', 't'],
    ['active', 'Active', 't'], ['pin_salt', 'PIN salt (do not edit)', 't'],
    ['pin_hash', 'PIN hash (do not edit)', 't'], ['created_at', 'Created At', 'd']
  ]
};

// ============================================================================
// Web entry points
// ============================================================================

function doGet() {
  return json_({ ok: true, message: 'Central Invoicing System API is running.' });
}

function doPost(e) {
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = String(req.action || '');
    var data = req.data || {};

    if (action === 'login') return json_({ ok: true, data: login_(data) });

    var user = authenticate_(req.token);
    var handlers = {
      bootstrap: bootstrap_,
      saveInvoice: saveInvoice_,
      setInvoiceStatus: setInvoiceStatus_,
      saveClient: saveClient_,
      saveFirm: saveFirm_,
      saveUser: saveUser_,
      changeMyPin: changeMyPin_
    };
    if (!handlers[action]) throw new Error('Unknown action: ' + action);
    return json_({ ok: true, data: handlers[action](data, user) });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err), code: err && err.code ? err.code : '' });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(message, code) {
  var e = new Error(message);
  e.code = code || '';
  throw e;
}

// ============================================================================
// Sheet access helpers
// ============================================================================

function book_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  var sh = book_().getSheetByName(name);
  if (!sh) fail_('The "' + name + '" tab is missing. Run setup() from the Apps Script editor.');
  return sh;
}

function formats_(name) {
  return SCHEMA[name].map(function (c) {
    return c[2] === 't' ? '@' : (c[2] === 'd' ? 'dd/mm/yyyy hh:mm' : '0.00');
  });
}

/** Stops Sheets treating typed text (=, +, -, @) as a formula. */
function safeText_(v) {
  var s = String(v === null || v === undefined ? '' : v);
  return /^[=+\-@']/.test(s) ? "'" + s : s;
}

function toCell_(type, v) {
  if (type === 'n') return Number(v) || 0;
  if (type === 'd') return v instanceof Date ? v : (v ? new Date(v) : '');
  return safeText_(v);
}

function fromCell_(type, v) {
  if (type === 'n') return Number(v) || 0;
  if (v instanceof Date) return v.toISOString();
  var s = String(v === null || v === undefined ? '' : v);
  if (type === 't' && /^'[=+\-@']/.test(s)) s = s.slice(1);
  return s;
}

function readAll_(name) {
  var sh = sheet_(name);
  var cols = SCHEMA[name];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, cols.length).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    if (values[r][0] === '' || values[r][0] === null) continue;
    var obj = { _row: r + 2 };
    for (var c = 0; c < cols.length; c++) obj[cols[c][0]] = fromCell_(cols[c][2], values[r][c]);
    out.push(obj);
  }
  return out;
}

function rowValues_(name, obj) {
  return SCHEMA[name].map(function (c) { return toCell_(c[2], obj[c[0]]); });
}

function writeRow_(name, rowNumber, obj) {
  var sh = sheet_(name);
  var range = sh.getRange(rowNumber, 1, 1, SCHEMA[name].length);
  range.setNumberFormats([formats_(name)]);
  range.setValues([rowValues_(name, obj)]);
}

function appendObj_(name, obj) {
  writeRow_(name, sheet_(name).getLastRow() + 1, obj);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ============================================================================
// Login and sessions
// ============================================================================

function hex_(bytes) {
  return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function hashPin_(pin, salt) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin, Utilities.Charset.UTF_8));
}

function secret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('TOKEN_SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('TOKEN_SECRET', s);
  }
  return s;
}

function sign_(text) {
  return hex_(Utilities.computeHmacSha256Signature(text, secret_()));
}

function makeToken_(u) {
  var exp = Date.now() + TOKEN_DAYS * 24 * 3600 * 1000;
  return u.username + '|' + exp + '|' + sign_(u.username + '|' + exp + '|' + u.pin_hash);
}

function findUser_(username) {
  var name = String(username || '').trim().toLowerCase();
  var users = readAll_('Users');
  for (var i = 0; i < users.length; i++) {
    if (users[i].username.toLowerCase() === name) return users[i];
  }
  return null;
}

function publicUser_(u) {
  return { username: u.username, name: u.name || u.username, role: u.role === 'admin' ? 'admin' : 'member', active: u.active !== 'no' };
}

function authenticate_(token) {
  var parts = String(token || '').split('|');
  if (parts.length !== 3) fail_('Please sign in.', 'AUTH');
  var u = findUser_(parts[0]);
  if (!u || u.active === 'no') fail_('Please sign in.', 'AUTH');
  if (Number(parts[1]) < Date.now()) fail_('Your session expired. Please sign in again.', 'AUTH');
  if (sign_(parts[0] + '|' + parts[1] + '|' + u.pin_hash) !== parts[2]) fail_('Please sign in.', 'AUTH');
  return publicUser_(u);
}

function login_(data) {
  var username = String(data.username || '').trim().toLowerCase();
  var pin = String(data.pin || '');
  if (!username || !pin) fail_('Enter your username and PIN.');

  var cache = CacheService.getScriptCache();
  var key = 'fail_' + username;
  var fails = Number(cache.get(key) || 0);
  if (fails >= MAX_FAILED_LOGINS) fail_('Too many wrong attempts. Try again in ' + LOCK_MINUTES + ' minutes.');

  var u = findUser_(username);
  if (!u || u.active === 'no' || hashPin_(pin, u.pin_salt) !== u.pin_hash) {
    cache.put(key, String(fails + 1), LOCK_MINUTES * 60);
    fail_('Wrong username or PIN.');
  }
  cache.remove(key);
  return { token: makeToken_(u), user: publicUser_(u) };
}

function requireAdmin_(user) {
  if (user.role !== 'admin') fail_('Only an admin can do this.');
}

function checkPin_(pin) {
  pin = String(pin || '');
  if (pin.length < 6) fail_('PIN must be at least 6 characters.');
  return pin;
}

// ============================================================================
// Reading everything the app needs in one call
// ============================================================================

function invoiceOut_(row) {
  var inv = {};
  SCHEMA['Invoices'].forEach(function (c) { inv[c[0]] = row[c[0]]; });
  try { inv.items = JSON.parse(row.items_json || '[]'); } catch (e) { inv.items = []; }
  delete inv.items_json;
  return inv;
}

function strip_(row) {
  var o = {};
  Object.keys(row).forEach(function (k) { if (k !== '_row') o[k] = row[k]; });
  return o;
}

function bootstrap_(data, user) {
  var out = {
    user: user,
    firms: readAll_('Firms').map(strip_),
    clients: readAll_('Clients').map(strip_),
    invoices: readAll_('Invoices').map(invoiceOut_).reverse()
  };
  if (user.role === 'admin') {
    out.users = readAll_('Users').map(publicUser_);
    out.sheet_url = book_().getUrl();
  }
  return out;
}

// ============================================================================
// Money helpers
// ============================================================================

function r2_(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

function amountInWords_(num) {
  num = Math.abs(Number(num) || 0);
  var rupees = Math.floor(num);
  var paise = Math.round((num - rupees) * 100);
  if (paise === 100) { rupees += 1; paise = 0; }
  var ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven',
    'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  var tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function two(n) { return n < 20 ? ones[n] : (tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '')); }
  function three(n) {
    var h = Math.floor(n / 100), r = n % 100, p = [];
    if (h) p.push(ones[h] + ' Hundred');
    if (r) p.push(two(r));
    return p.join(' ');
  }
  function whole(n) {
    var p = [];
    var crore = Math.floor(n / 10000000); n %= 10000000;
    var lakh = Math.floor(n / 100000); n %= 100000;
    var thousand = Math.floor(n / 1000); n %= 1000;
    if (crore) p.push(whole(crore) + ' Crore');
    if (lakh) p.push(two(lakh) + ' Lakh');
    if (thousand) p.push(two(thousand) + ' Thousand');
    if (n) p.push(three(n));
    return p.join(' ');
  }
  var text = (rupees ? whole(rupees) : 'Zero') + ' Rupees';
  if (paise) text += ' and ' + two(paise) + ' Paise';
  return text + ' Only';
}

// ============================================================================
// Invoices
// ============================================================================

function clip_(v, max) { return String(v === null || v === undefined ? '' : v).trim().slice(0, max); }

function rate_(v) {
  var n = Number(v);
  if (!(n >= 0 && n <= 100)) fail_('Tax rate must be between 0 and 100.');
  return n;
}

function saveInvoice_(data, user) {
  return withLock_(function () {
    var firms = readAll_('Firms');
    var firm = firms.filter(function (f) { return f.id === data.firm_id && f.active !== 'no'; })[0];
    if (!firm) fail_('Choose a firm.');

    var invoiceNo = clip_(data.invoice_no, 40);
    var invoiceDate = clip_(data.invoice_date, 10);
    var clientName = clip_(data.client_name, 200);
    if (!invoiceNo) fail_('Enter an invoice number.');
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(invoiceDate)) fail_('Enter the invoice date as DD/MM/YYYY.');
    if (!clientName) fail_('Enter the client name.');

    var items = [];
    (data.items || []).forEach(function (it) {
      var name = clip_(it.item, 500);
      if (!name) return;
      var qty = Number(it.qty) || 0;
      var price = Number(it.unit_price) || 0;
      if (qty < 0 || price < 0) fail_('Quantity and price cannot be negative.');
      items.push({ sno: items.length + 1, item: name, hsn: clip_(it.hsn, 20), qty: qty, unit_price: price, total_price: r2_(qty * price) });
    });
    if (!items.length) fail_('Add at least one item with a description.');
    if (items.length > 200) fail_('An invoice can have at most 200 items.');

    var all = readAll_('Invoices');
    var existing = null;
    if (data.id) {
      existing = all.filter(function (i) { return i.id === data.id; })[0];
      if (!existing) fail_('This invoice no longer exists. Reload the page.');
      if (existing.status === 'Cancelled') fail_('A cancelled invoice cannot be edited.');
      if (user.role !== 'admin' && existing.created_by !== user.username) {
        fail_('You can only edit invoices you created. Ask an admin to change this one.');
      }
    }

    var clash = all.filter(function (i) {
      return i.firm_id === firm.id && i.invoice_no.toLowerCase() === invoiceNo.toLowerCase() && (!existing || i.id !== existing.id);
    })[0];
    if (clash) {
      fail_('Invoice number ' + invoiceNo + ' is already used for ' + firm.name + '. The next free number is ' +
        firm.invoice_prefix + firm.next_invoice_no + '.', 'DUPLICATE');
    }

    var taxType = data.tax_type === 'inter' ? 'inter' : 'intra';
    var subQty = 0, subPrice = 0;
    items.forEach(function (it) { subQty += it.qty; subPrice += it.total_price; });
    subPrice = r2_(subPrice);
    var cgstRate = taxType === 'intra' ? rate_(data.cgst_rate) : 0;
    var sgstRate = taxType === 'intra' ? rate_(data.sgst_rate) : 0;
    var igstRate = taxType === 'inter' ? rate_(data.igst_rate) : 0;
    var cgst = r2_(subPrice * cgstRate / 100);
    var sgst = r2_(subPrice * sgstRate / 100);
    var igst = r2_(subPrice * igstRate / 100);
    var raw = r2_(subPrice + cgst + sgst + igst);
    var grand = Math.round(raw);

    var now = new Date();
    var row = {
      id: existing ? existing.id : 'INV-' + Utilities.getUuid().slice(0, 8).toUpperCase(),
      created_at: existing ? existing.created_at : now,
      created_by: existing ? existing.created_by : user.username,
      firm_name: firm.name, firm_id: firm.id,
      invoice_no: invoiceNo, invoice_date: invoiceDate,
      client_name: clientName,
      client_address: clip_(data.client_address, 500),
      client_gstin: clip_(data.client_gstin, 20).toUpperCase(),
      client_phone: clip_(data.client_phone, 30),
      client_email: clip_(data.client_email, 120),
      ship_to: clip_(data.ship_to, 500),
      notes: clip_(data.notes, 300),
      tax_type: taxType,
      sub_total_qty: subQty, sub_total_price: subPrice,
      cgst_rate: cgstRate, cgst_amount: cgst, sgst_rate: sgstRate, sgst_amount: sgst,
      igst_rate: igstRate, igst_amount: igst,
      round_off: r2_(grand - raw), grand_total: grand,
      total_words: amountInWords_(grand),
      status: existing ? existing.status : 'Issued',
      updated_at: existing ? now : '',
      updated_by: existing ? user.username : '',
      items_json: JSON.stringify(items)
    };

    if (existing) writeRow_('Invoices', existing._row, row);
    else appendObj_('Invoices', row);
    writeItemRows_(row, items, !!existing);

    // Move the firm's counter past this number when it follows the firm's prefix.
    var prefix = firm.invoice_prefix || '';
    var tail = invoiceNo.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase() ? invoiceNo.slice(prefix.length) : '';
    if (/^\d+$/.test(tail) && Number(tail) + 1 > firm.next_invoice_no) {
      firm.next_invoice_no = Number(tail) + 1;
      writeRow_('Firms', firm._row, firm);
    }

    // Remember the client for next time.
    var clients = readAll_('Clients');
    var known = clients.filter(function (c) { return c.name.toLowerCase() === clientName.toLowerCase(); })[0];
    var clientRow = {
      id: known ? known.id : 'CL-' + Utilities.getUuid().slice(0, 8).toUpperCase(),
      name: clientName,
      address: row.client_address || (known ? known.address : ''),
      gstin: row.client_gstin || (known ? known.gstin : ''),
      phone: row.client_phone || (known ? known.phone : ''),
      email: row.client_email || (known ? known.email : ''),
      created_at: known ? known.created_at : now
    };
    if (known) writeRow_('Clients', known._row, clientRow);
    else appendObj_('Clients', clientRow);

    return { invoice: invoiceOut_(row), firm: strip_(firm), client: clientRow };
  });
}

function writeItemRows_(inv, items, replace) {
  var name = 'Invoice Items';
  var sh = sheet_(name);
  if (replace) {
    var last = sh.getLastRow();
    if (last >= 2) {
      var ids = sh.getRange(2, 1, last - 1, 1).getValues();
      for (var r = ids.length - 1; r >= 0; r--) {
        if (String(ids[r][0]) === inv.id) sh.deleteRow(r + 2);
      }
    }
  }
  var rows = items.map(function (it) {
    return rowValues_(name, {
      invoice_id: inv.id, firm_name: inv.firm_name, invoice_no: inv.invoice_no, invoice_date: inv.invoice_date,
      client_name: inv.client_name, sno: it.sno, item: it.item, hsn: it.hsn, qty: it.qty,
      unit_price: it.unit_price, total_price: it.total_price
    });
  });
  if (!rows.length) return;
  var fmts = rows.map(function () { return formats_(name); });
  var range = sh.getRange(sh.getLastRow() + 1, 1, rows.length, SCHEMA[name].length);
  range.setNumberFormats(fmts);
  range.setValues(rows);
}

function setInvoiceStatus_(data, user) {
  return withLock_(function () {
    var status = String(data.status || '');
    if (['Issued', 'Paid', 'Cancelled'].indexOf(status) < 0) fail_('Unknown status.');
    var inv = readAll_('Invoices').filter(function (i) { return i.id === data.id; })[0];
    if (!inv) fail_('This invoice no longer exists. Reload the page.');
    if (status === 'Cancelled' || inv.status === 'Cancelled') requireAdmin_(user);
    inv.status = status;
    inv.updated_at = new Date();
    inv.updated_by = user.username;
    writeRow_('Invoices', inv._row, inv);
    return { invoice: invoiceOut_(inv) };
  });
}

// ============================================================================
// Clients, firms, team
// ============================================================================

function saveClient_(data) {
  return withLock_(function () {
    var name = clip_(data.name, 200);
    if (!name) fail_('Enter the client name.');
    var clients = readAll_('Clients');
    var existing = data.id ? clients.filter(function (c) { return c.id === data.id; })[0] : null;
    var sameName = clients.filter(function (c) {
      return c.name.toLowerCase() === name.toLowerCase() && (!existing || c.id !== existing.id);
    })[0];
    if (sameName) fail_('A client named "' + name + '" already exists.');
    var row = {
      id: existing ? existing.id : 'CL-' + Utilities.getUuid().slice(0, 8).toUpperCase(),
      name: name, address: clip_(data.address, 500), gstin: clip_(data.gstin, 20).toUpperCase(),
      phone: clip_(data.phone, 30), email: clip_(data.email, 120),
      created_at: existing ? existing.created_at : new Date()
    };
    if (existing) writeRow_('Clients', existing._row, row);
    else appendObj_('Clients', row);
    return { client: row };
  });
}

function saveFirm_(data, user) {
  requireAdmin_(user);
  return withLock_(function () {
    var name = clip_(data.name, 120);
    if (!name) fail_('Enter the firm name.');
    var logo = String(data.logo_url || '');
    if (logo.length > 48000) fail_('The logo image is too large. Use a smaller image.');
    if (logo && !/^(data:image\/(png|jpeg|webp);base64,|https:\/\/|assets\/)/.test(logo)) fail_('The logo must be an uploaded image.');
    var color = /^#[0-9a-fA-F]{6}$/.test(String(data.theme_color || '')) ? data.theme_color : '#1e3a8a';
    var nextNo = Math.floor(Number(data.next_invoice_no));
    if (!(nextNo >= 1)) nextNo = 1;

    var firms = readAll_('Firms');
    var existing = data.id ? firms.filter(function (f) { return f.id === data.id; })[0] : null;
    var id = existing ? existing.id : name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (!existing) {
      if (!id) id = 'firm';
      var base = id, n = 2;
      while (firms.some(function (f) { return f.id === id; })) id = base + '_' + (n++);
    }
    var row = {
      id: id, name: name, address: clip_(data.address, 300), email: clip_(data.email, 120),
      gstin: clip_(data.gstin, 20).toUpperCase(), phone: clip_(data.phone, 30),
      state: clip_(data.state, 60) || 'Rajasthan', state_code: clip_(data.state_code, 4) || '08',
      bank_name: clip_(data.bank_name, 80), account_name: clip_(data.account_name, 120) || name,
      account_no: clip_(data.account_no, 40), ifsc_code: clip_(data.ifsc_code, 20).toUpperCase(),
      upi_id: clip_(data.upi_id, 80), logo_url: logo, theme_color: color,
      invoice_prefix: clip_(data.invoice_prefix, 20), next_invoice_no: nextNo,
      active: data.active === 'no' ? 'no' : 'yes'
    };
    if (existing) writeRow_('Firms', existing._row, row);
    else appendObj_('Firms', row);
    return { firm: row };
  });
}

function saveUser_(data, user) {
  requireAdmin_(user);
  return withLock_(function () {
    var username = clip_(data.username, 40).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) fail_('Username needs 3 or more letters or numbers, with no spaces.');
    var users = readAll_('Users');
    var existing = users.filter(function (u) { return u.username.toLowerCase() === username; })[0];
    if (data.is_new && existing) fail_('The username "' + username + '" is already taken.');
    if (!data.is_new && !existing) fail_('This team member no longer exists.');

    var role = data.role === 'admin' ? 'admin' : 'member';
    var active = data.active === false || data.active === 'no' ? 'no' : 'yes';
    if (existing && existing.username.toLowerCase() === user.username.toLowerCase() && (role !== 'admin' || active === 'no')) {
      fail_('You cannot remove your own admin access.');
    }
    var row = existing || { username: username, created_at: new Date() };
    row.name = clip_(data.name, 80) || username;
    row.role = role;
    row.active = active;
    if (data.pin || !existing) {
      row.pin_salt = Utilities.getUuid();
      row.pin_hash = hashPin_(checkPin_(data.pin), row.pin_salt);
    }
    if (existing) writeRow_('Users', existing._row, row);
    else appendObj_('Users', row);
    return { users: readAll_('Users').map(publicUser_) };
  });
}

function changeMyPin_(data, user) {
  return withLock_(function () {
    var u = findUser_(user.username);
    if (hashPin_(String(data.current_pin || ''), u.pin_salt) !== u.pin_hash) fail_('Your current PIN is wrong.');
    u.pin_salt = Utilities.getUuid();
    u.pin_hash = hashPin_(checkPin_(data.new_pin), u.pin_salt);
    writeRow_('Users', u._row, u);
    return { token: makeToken_(u) };
  });
}

// ============================================================================
// One-time setup (run from the Apps Script editor)
// ============================================================================

function setup() {
  var book = book_();
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = book.getSheetByName(name) || book.insertSheet(name);
    var headers = SCHEMA[name].map(function (c) { return c[1]; });
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#e8eef5');
    sh.setFrozenRows(1);
  });

  if (!readAll_('Firms').length) {
    appendObj_('Firms', {
      id: 'craftographers', name: 'Craftographers', address: '66A/67A Adinath Nager, Pal Road, Jodhpur- 342008',
      email: 'info.craftographers@gmail.com', gstin: '08GFFPS1076L1ZV', phone: '', state: 'Rajasthan', state_code: '08',
      bank_name: 'HDFC Bank', account_name: 'Craftographers', account_no: '50200050618222', ifsc_code: 'HDFC0000142',
      upi_id: '', logo_url: 'assets/craftographers_logo.png', theme_color: '#A0522D', invoice_prefix: 'CRF-',
      next_invoice_no: 12, active: 'yes'
    });
    appendObj_('Firms', {
      id: 'as_enterprises', name: 'A S ENTERPRISES', address: '66A/67A Adinath Nager, Pal Road, Jodhpur- 342008',
      email: 'gem.asenterprises94@gmail.com', gstin: '08TFCPS8191N1Z3', phone: '', state: 'Rajasthan', state_code: '08',
      bank_name: 'HDFC Bank', account_name: 'AS Enterprises', account_no: '50200106872092', ifsc_code: 'HDFC0000142',
      upi_id: '', logo_url: 'assets/as_enterprises_logo.jpg', theme_color: '#1E3A8A', invoice_prefix: 'ASE-',
      next_invoice_no: 21, active: 'yes'
    });
  }

  if (!readAll_('Clients').length) {
    appendObj_('Clients', {
      id: 'CL-' + Utilities.getUuid().slice(0, 8).toUpperCase(), name: 'The Commandant 224 ABOD C/O 56 APO',
      address: '224 ABOD C/O 56 APO', gstin: '', phone: '', email: '', created_at: new Date()
    });
  }

  secret_();

  var message;
  if (!readAll_('Users').length) {
    var pin = newPin_();
    var salt = Utilities.getUuid();
    appendObj_('Users', {
      username: 'admin', name: 'Admin', role: 'admin', active: 'yes',
      pin_salt: salt, pin_hash: hashPin_(pin, salt), created_at: new Date()
    });
    message = 'Setup complete.\n\nSign in with\n  Username: admin\n  PIN: ' + pin +
      '\n\nWrite this PIN down now. Change it after signing in (top-right menu > Change PIN).';
  } else {
    message = 'Setup complete. Existing data was kept.';
  }
  Logger.log(message);
  try { SpreadsheetApp.getUi().alert(message); } catch (e) { /* run from editor: see the Execution log */ }
}

function newPin_() {
  var hex = Utilities.getUuid().replace(/-/g, '');
  var digits = '';
  for (var i = 0; i < hex.length && digits.length < 8; i++) digits += String(parseInt(hex.charAt(i), 16) % 10);
  return digits;
}

/** Run this from the editor if the admin PIN is lost. The new PIN appears in the Execution log. */
function resetAdminPin() {
  var u = findUser_('admin');
  if (!u) throw new Error('No "admin" user found. Run setup() first.');
  var pin = newPin_();
  u.pin_salt = Utilities.getUuid();
  u.pin_hash = hashPin_(pin, u.pin_salt);
  u.active = 'yes';
  u.role = 'admin';
  writeRow_('Users', u._row, u);
  Logger.log('New PIN for "admin": ' + pin);
}
