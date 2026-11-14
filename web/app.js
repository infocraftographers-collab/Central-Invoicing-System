// Central Invoicing — browser app. Talks to the Google Sheet through the Apps Script web app.
(function () {
  'use strict';

  var esc = Sheet.esc, money = Sheet.money;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var LOCAL = ['localhost', '127.0.0.1'].indexOf(location.hostname) >= 0;
  var API = String(window.INVOICE_API_URL || '').trim() || (LOCAL ? '/api' : '');

  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  var S = {
    token: store.get('cis_token') || '', user: null,
    firms: [], clients: [], invoices: [], users: [], sheetUrl: '',
    loadedAt: 0, draft: null, filters: { q: '', firm: 'all', status: 'all' }
  };

  // ------------------------------------------------------------------ basics
  function api(action, data) {
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, data: data || {}, token: S.token })
    }).then(function (res) {
      if (!res.ok) throw new Error('The server did not respond (' + res.status + '). Try again.');
      return res.json();
    }, function () {
      throw new Error('No connection. Check your internet and try again.');
    }).then(function (j) {
      if (j.ok) return j.data;
      var err = new Error(j.error || 'Something went wrong.');
      err.code = j.code;
      if (j.code === 'AUTH' && action !== 'login') signOut(j.error);
      throw err;
    });
  }

  var toastTimer;
  function toast(msg, kind) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, kind === 'error' ? 6000 : 3200);
  }

  function busy(btn, on) {
    if (!btn) return;
    btn.disabled = on;
    btn.classList.toggle('busy', on);
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function isoToIN(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; }
  function inToISO(s) { var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || ''); return m ? m[3] + '-' + m[2] + '-' + m[1] : todayISO(); }

  function firmById(id) { return S.firms.filter(function (f) { return f.id === id; })[0]; }
  function activeFirms() { return S.firms.filter(function (f) { return f.active !== 'no'; }); }
  function nextNo(firm) { return (firm.invoice_prefix || '') + firm.next_invoice_no; }
  function isAdmin() { return S.user && S.user.role === 'admin'; }
  function upsert(list, item, key, front) {
    for (var i = 0; i < list.length; i++) if (list[i][key] === item[key]) { list[i] = item; return; }
    if (front) list.unshift(item); else list.push(item);
  }

  // ------------------------------------------------------------------ sign in / out
  function showLogin(message) {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#login-setup').hidden = !!API;
    var err = $('#login-error');
    err.hidden = !message;
    err.textContent = message || '';
    $('#login-form [name=username]').focus();
  }

  function signOut(message) {
    S.token = ''; S.user = null;
    store.del('cis_token');
    $$('dialog').forEach(function (d) { d.close(); });
    showLogin(typeof message === 'string' ? message : '');
  }

  $('#login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, btn = $('button[type=submit]', f);
    if (!API) return;
    busy(btn, true);
    api('login', { username: f.username.value, pin: f.pin.value }).then(function (d) {
      S.token = d.token;
      store.set('cis_token', d.token);
      f.pin.value = '';
      return load();
    }).catch(function (err) {
      $('#login-error').hidden = false;
      $('#login-error').textContent = err.message;
    }).then(function () { busy(btn, false); });
  });

  function load(quiet) {
    $('#login').hidden = true;
    $('#app').hidden = false;
    if (!quiet) { $('#loading').hidden = false; $('#view').hidden = true; }
    return api('bootstrap').then(function (d) {
      S.user = d.user; S.firms = d.firms; S.clients = d.clients; S.invoices = d.invoices;
      S.users = d.users || []; S.sheetUrl = d.sheet_url || ''; S.loadedAt = Date.now();
      $('#loading').hidden = true; $('#view').hidden = false;
      renderChrome();
      if (!quiet) route();
    }).catch(function (err) {
      $('#loading').hidden = true;
      if (err.code !== 'AUTH') {
        $('#view').hidden = false;
        $('#view').innerHTML = '<div class="empty-state"><h2>Could not load your data</h2><p>' + esc(err.message) +
          '</p><button class="btn primary" data-act="reload">Try again</button></div>';
      }
    });
  }

  // ------------------------------------------------------------------ chrome and routing
  var VIEWS = [['new', 'New invoice'], ['invoices', 'Invoices'], ['clients', 'Clients'], ['firms', 'Firms'], ['team', 'Team']];

  function currentView() {
    var v = location.hash.replace('#', '');
    if (v === 'team' && !isAdmin()) v = 'new';
    return VIEWS.some(function (x) { return x[0] === v; }) ? v : 'new';
  }

  function renderChrome() {
    var v = currentView();
    $('#nav').innerHTML = VIEWS.filter(function (x) { return x[0] !== 'team' || isAdmin(); }).map(function (x) {
      return '<a href="#' + x[0] + '"' + (x[0] === v ? ' aria-current="page"' : '') + '>' + x[1] + '</a>';
    }).join('');
    $('#user-btn').innerHTML = '<span class="avatar">' + esc((S.user.name || '?').charAt(0).toUpperCase()) + '</span><span class="user-name">' + esc(S.user.name) + '</span>';
    $('#user-menu').innerHTML =
      '<div class="menu-head">' + esc(S.user.name) + '<small>' + (isAdmin() ? 'Admin' : 'Team member') + ' · ' + esc(S.user.username) + '</small></div>' +
      (S.sheetUrl && /^https:\/\/docs\.google\.com\//.test(S.sheetUrl) ? '<a href="' + esc(S.sheetUrl) + '" target="_blank" rel="noopener">Open the Google Sheet</a>' : '') +
      '<button data-act="change-pin">Change PIN</button><button data-act="sign-out">Sign out</button>';
  }

  function route() {
    var v = currentView();
    renderChrome();
    closeMenu();
    if (v !== 'new' && Date.now() - S.loadedAt > 60000) load(true).then(function () { if (currentView() === v) draw(v); });
    draw(v);
    window.scrollTo(0, 0);
  }

  function draw(v) {
    ({ new: renderEditor, invoices: renderInvoices, clients: renderClients, firms: renderFirms, team: renderTeam })[v]();
  }

  window.addEventListener('hashchange', function () { if (S.user) route(); });

  function closeMenu() { $('#user-menu').hidden = true; $('#user-btn').setAttribute('aria-expanded', 'false'); }
  $('#user-btn').addEventListener('click', function (e) {
    e.stopPropagation();
    var m = $('#user-menu');
    m.hidden = !m.hidden;
    $('#user-btn').setAttribute('aria-expanded', String(!m.hidden));
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.user')) closeMenu(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

  // ------------------------------------------------------------------ sheet mounting
  var holderObserver = 'ResizeObserver' in window ? new ResizeObserver(function (entries) {
    entries.forEach(function (en) { scaleHolder(en.target); });
  }) : null;

  function scaleHolder(holder) {
    var sheet = holder.firstElementChild;
    if (!sheet || !holder.clientWidth) return;
    var k = Math.min(1, holder.clientWidth / sheet.offsetWidth);
    sheet.style.transformOrigin = '0 0';
    sheet.style.transform = 'scale(' + k + ')';
    holder.style.height = Math.ceil(sheet.offsetHeight * k) + 'px';
  }

  function mountSheet(holder, inv) {
    var firm = firmById(inv.firm_id) || { name: inv.firm_name };
    holder.innerHTML = Sheet.html(inv, firm);
    var s = Sheet.fit(holder.firstElementChild);
    scaleHolder(holder);
    if (holderObserver) holderObserver.observe(holder);
    return s;
  }

  function fitNote(s, count) {
    if (s >= 0.999) return { text: 'Fits on one A4 page', cls: 'ok' };
    if (s >= 0.62) return { text: 'Shrunk to ' + Math.round(s * 100) + '% to stay on one A4 page', cls: 'ok' };
    return { text: 'Shrunk to ' + Math.round(s * 100) + '% to fit ' + count + ' items on one page. The print will be hard to read; consider two invoices.', cls: 'warn' };
  }

  function printInvoice(inv) {
    var root = $('#print-root');
    var firm = firmById(inv.firm_id) || { name: inv.firm_name };
    root.innerHTML = Sheet.html(inv, firm);
    var imgs = $$('img', root).map(function (i) { return i.decode ? i.decode().catch(function () {}) : null; });
    var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : null;
    return Promise.all(imgs.concat(fonts)).then(function () {
      Sheet.fit(root.firstElementChild);
      var old = document.title;
      // The browser suggests this as the PDF file name.
      document.title = String(firm.name || 'Invoice').replace(/[^\w-]+/g, '_') + '_Invoice_' + String(inv.invoice_no).replace(/[^\w-]+/g, '_');
      var restore = function () { document.title = old; window.removeEventListener('afterprint', restore); };
      window.addEventListener('afterprint', restore);
      window.print();
    });
  }

  // ------------------------------------------------------------------ dialogs
  function openDialog(html, cls) {
    var d = document.createElement('dialog');
    d.className = 'dlg ' + (cls || '');
    d.innerHTML = html;
    $('#dialogs').appendChild(d);
    d.addEventListener('close', function () { d.remove(); });
    d.addEventListener('click', function (e) { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
    d.showModal();
    return d;
  }

  function fieldHtml(f, v) {
    v = v === undefined || v === null ? '' : v;
    var attrs = ' name="' + f.k + '"' + (f.required ? ' required' : '') + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') +
      (f.readonly ? ' readonly' : '') + (f.minlength ? ' minlength="' + f.minlength + '"' : '') + (f.autocomplete ? ' autocomplete="' + f.autocomplete + '"' : '');
    var control;
    if (f.type === 'textarea') control = '<textarea rows="2"' + attrs + '>' + esc(v) + '</textarea>';
    else if (f.type === 'select') control = '<select' + attrs + '>' + f.options.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select>';
    else if (f.type === 'logo') control = '<div class="logo-pick"><img alt="" src="' + esc(Sheet.safeLogo(v)) + '"' + (Sheet.safeLogo(v) ? '' : ' hidden') + '>' +
      '<input type="file" accept="image/png,image/jpeg,image/webp" data-logo><input type="hidden" name="' + f.k + '" value="' + esc(v) + '"></div>';
    else control = '<input type="' + (f.type || 'text') + '" value="' + esc(v) + '"' + attrs + (f.type === 'number' ? ' min="1" step="1"' : '') + '>';
    return '<label class="field' + (f.half ? ' half' : '') + '"><span>' + esc(f.label) + '</span>' + control +
      (f.hint ? '<small>' + esc(f.hint) + '</small>' : '') + '</label>';
  }

  /** A form in a dialog. onSubmit(values) returns a promise; its error is shown inside the dialog. */
  function formDialog(o) {
    var vals = o.values || {};
    var d = openDialog(
      '<form method="dialog" novalidate>' +
      '<header><h2>' + esc(o.title) + '</h2><button type="button" class="icon-btn" data-close aria-label="Close">&times;</button></header>' +
      '<div class="dlg-body">' + (o.intro ? '<p class="dlg-intro">' + esc(o.intro) + '</p>' : '') +
      '<div class="field-grid">' + (o.fields || []).map(function (f) { return fieldHtml(f, vals[f.k]); }).join('') + '</div>' +
      '<p class="form-error" role="alert" hidden></p></div>' +
      '<footer><button type="button" class="btn" data-close>' + esc(o.cancelLabel || 'Cancel') + '</button>' +
      '<button type="submit" class="btn ' + (o.danger ? 'danger' : 'primary') + '">' + esc(o.submitLabel || 'Save') + '</button></footer></form>', o.cls);
    var form = $('form', d), errBox = $('.form-error', d);
    var logoInput = $('[data-logo]', d);
    if (logoInput) logoInput.addEventListener('change', function () {
      if (!logoInput.files[0]) return;
      readLogo(logoInput.files[0]).then(function (url) {
        $('.logo-pick input[type=hidden]', d).value = url;
        var img = $('.logo-pick img', d); img.src = url; img.hidden = false;
      }).catch(function (e) { errBox.hidden = false; errBox.textContent = e.message; });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var out = {};
      (o.fields || []).forEach(function (f) { out[f.k] = form.elements[f.k].value.trim(); });
      var btn = $('button[type=submit]', form);
      busy(btn, true);
      errBox.hidden = true;
      Promise.resolve().then(function () { return o.onSubmit(out); }).then(function () { d.close(); }, function (err) {
        errBox.hidden = false; errBox.textContent = err.message; busy(btn, false);
      });
    });
    var first = $('input:not([type=hidden]):not([readonly]), textarea, select', form);
    if (first) first.focus();
    return d;
  }

  function readLogo(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var tries = [['image/png', 420], ['image/png', 300], ['image/jpeg', 420], ['image/jpeg', 300], ['image/jpeg', 200]];
        for (var i = 0; i < tries.length; i++) {
          var k = Math.min(1, tries[i][1] / img.naturalWidth);
          var c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
          var ctx = c.getContext('2d');
          if (tries[i][0] === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
          ctx.drawImage(img, 0, 0, c.width, c.height);
          var url = c.toDataURL(tries[i][0], 0.82);
          if (url.length < 46000) { URL.revokeObjectURL(img.src); return resolve(url); }
        }
        reject(new Error('This image is too detailed for a logo. Try a simpler or smaller file.'));
      };
      img.onerror = function () { reject(new Error('That file is not an image the browser can read.')); };
      img.src = URL.createObjectURL(file);
    });
  }

  // ------------------------------------------------------------------ New invoice
  function newDraft(firmId, from) {
    var firm = firmById(firmId) || activeFirms()[0] || {};
    var d = {
      id: '', firm_id: firm.id || '', invoice_no: firm.id ? nextNo(firm) : '', number_touched: false, invoice_date: todayISO(),
      tax_type: 'intra', cgst_rate: 9, sgst_rate: 9, igst_rate: 18,
      client_name: '', client_gstin: '', client_phone: '', client_email: '', client_address: '', ship_diff: false, ship_to: '', notes: '',
      items: [{ item: '', hsn: '', qty: 1, unit_price: '' }]
    };
    if (from) {
      ['tax_type', 'client_name', 'client_gstin', 'client_phone', 'client_email', 'client_address', 'ship_to', 'notes'].forEach(function (k) { if (from[k] !== undefined) d[k] = from[k]; });
      if (from.tax_type === 'inter') d.igst_rate = from.igst_rate; else if (from.tax_type) { d.cgst_rate = from.cgst_rate; d.sgst_rate = from.sgst_rate; }
      d.ship_diff = !!d.ship_to;
      if (from.items && from.items.length) d.items = from.items.map(function (it) { return { item: it.item, hsn: it.hsn, qty: it.qty, unit_price: it.unit_price }; });
    }
    return d;
  }

  function draftFromInvoice(inv) {
    var d = newDraft(inv.firm_id, inv);
    d.id = inv.id; d.invoice_no = inv.invoice_no; d.number_touched = true; d.invoice_date = inToISO(inv.invoice_date);
    return d;
  }

  var draftTimer;
  function rememberDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () { store.set('cis_draft', { user: S.user.username, draft: S.draft }); }, 400);
  }

  function ensureDraft() {
    if (S.draft) return;
    var saved = store.get('cis_draft');
    if (saved && saved.user === S.user.username && saved.draft && firmById(saved.draft.firm_id) && Array.isArray(saved.draft.items)) {
      S.draft = saved.draft;
      var firm = firmById(S.draft.firm_id);
      if (!S.draft.id && !S.draft.number_touched) S.draft.invoice_no = nextNo(firm);
    } else {
      S.draft = newDraft();
    }
  }

  function draftInvoice() {
    var d = S.draft;
    var t = Sheet.compute(d);
    var inv = {};
    Object.keys(d).forEach(function (k) { inv[k] = d[k]; });
    Object.keys(t).forEach(function (k) { inv[k] = t[k]; });
    inv.invoice_date = isoToIN(d.invoice_date);
    inv.ship_to = d.ship_diff ? d.ship_to : '';
    return inv;
  }

  function itemRowHtml(it, i) {
    return '<div class="item-row" data-i="' + i + '">' +
      '<span class="item-no">' + (i + 1) + '</span>' +
      '<input class="i-desc" data-k="item" value="' + esc(it.item) + '" placeholder="Description of goods or service" aria-label="Item ' + (i + 1) + ' description">' +
      '<input class="i-hsn" data-k="hsn" value="' + esc(it.hsn) + '" placeholder="HSN" aria-label="Item ' + (i + 1) + ' HSN or SAC code">' +
      '<input class="i-qty num" data-k="qty" type="number" inputmode="decimal" min="0" step="any" value="' + esc(it.qty) + '" placeholder="Qty" aria-label="Item ' + (i + 1) + ' quantity">' +
      '<input class="i-rate num" data-k="unit_price" type="number" inputmode="decimal" min="0" step="any" value="' + esc(it.unit_price) + '" placeholder="0.00" aria-label="Item ' + (i + 1) + ' unit price">' +
      '<output class="i-amt">0.00</output>' +
      '<button type="button" class="icon-btn" data-act="del-item" aria-label="Remove item ' + (i + 1) + '">&times;</button></div>';
  }

  function renderEditor() {
    ensureDraft();
    var d = S.draft, firms = activeFirms();
    var firm = firmById(d.firm_id) || {};
    document.documentElement.style.setProperty('--firm', Sheet.safeColor(firm.theme_color));
    if (!firms.length) {
      $('#view').innerHTML = '<div class="empty-state"><h2>No firm to bill from yet</h2><p>' +
        (isAdmin() ? 'Add your first firm, then come back to create invoices.' : 'Ask an admin to add a firm.') + '</p>' +
        (isAdmin() ? '<a class="btn primary" href="#firms">Go to Firms</a>' : '') + '</div>';
      return;
    }
    var field = function (k, label, extra, cls) {
      return '<label class="field ' + (cls || '') + '"><span>' + label + '</span><input data-f="' + k + '" value="' + esc(d[k]) + '" ' + (extra || '') + '></label>';
    };
    $('#view').innerHTML =
      '<div class="editor">' +
      '<form class="form-col" id="inv-form" novalidate>' +
        '<div class="page-head"><h1>' + (d.id ? 'Editing ' + esc(d.invoice_no) : 'New invoice') + '</h1>' +
          '<button type="button" class="btn quiet" data-act="reset">' + (d.id ? 'Stop editing' : 'Clear form') + '</button></div>' +

        '<section class="panel"><h2>Billing firm</h2>' +
          '<div class="firm-switch" role="radiogroup" aria-label="Billing firm">' + firms.map(function (f) {
            var logo = Sheet.safeLogo(f.logo_url);
            return '<button type="button" role="radio" aria-checked="' + (f.id === d.firm_id) + '" data-act="firm" data-id="' + esc(f.id) +
              '" style="--fc:' + Sheet.safeColor(f.theme_color) + '">' + (logo ? '<img src="' + esc(logo) + '" alt="">' : '') +
              '<span><b>' + esc(f.name) + '</b><small>GSTIN ' + esc(f.gstin || 'not set') + '</small></span></button>';
          }).join('') + '</div>' +
          '<div class="field-grid three">' +
            field('invoice_no', 'Invoice number', 'required maxlength="40" autocomplete="off"') +
            '<label class="field"><span>Invoice date</span><input type="date" data-f="invoice_date" value="' + esc(d.invoice_date) + '" required></label>' +
            '<label class="field"><span>GST type</span><select data-f="tax_type">' +
              '<option value="intra"' + (d.tax_type !== 'inter' ? ' selected' : '') + '>Same state: CGST + SGST</option>' +
              '<option value="inter"' + (d.tax_type === 'inter' ? ' selected' : '') + '>Other state: IGST</option></select></label>' +
          '</div></section>' +

        '<section class="panel"><h2>Client</h2>' +
          '<div class="field-grid">' +
            field('client_name', 'Client name', 'required list="client-list" autocomplete="off" placeholder="Start typing to pick a saved client"', 'wide') +
            '<datalist id="client-list">' + S.clients.map(function (c) { return '<option value="' + esc(c.name) + '">'; }).join('') + '</datalist>' +
            field('client_gstin', 'Client GSTIN', 'maxlength="15" autocomplete="off" placeholder="Leave empty if unregistered"', 'half') +
            field('notes', 'PO / work order reference', 'autocomplete="off" placeholder="e.g. GEMC-5116877"', 'half') +
            '<label class="field wide"><span>Billing address</span><textarea data-f="client_address" rows="2">' + esc(d.client_address) + '</textarea></label>' +
            field('client_phone', 'Phone / WhatsApp', 'type="tel" autocomplete="off"', 'half') +
            field('client_email', 'Email', 'type="email" autocomplete="off"', 'half') +
            '<label class="check wide"><input type="checkbox" data-f="ship_diff"' + (d.ship_diff ? ' checked' : '') + '> Ship to a different address</label>' +
            '<label class="field wide" id="ship-field"' + (d.ship_diff ? '' : ' hidden') + '><span>Shipping address</span><textarea data-f="ship_to" rows="2">' + esc(d.ship_to) + '</textarea></label>' +
          '</div></section>' +

        '<section class="panel"><h2>Items</h2>' +
          '<div class="items"><div class="item-row item-head" aria-hidden="true"><span></span><span>Description</span><span>HSN / SAC</span><span class="num">Qty</span><span class="num">Unit price</span><span class="num">Amount</span><span></span></div>' +
          '<div id="item-rows">' + d.items.map(itemRowHtml).join('') + '</div></div>' +
          '<button type="button" class="btn" data-act="add-item">Add item</button>' +
        '</section>' +

        '<section class="panel totals">' +
          '<div class="words"><h2>Amount in words</h2><p id="t-words"></p></div>' +
          '<dl>' +
            '<div><dt>Taxable value</dt><dd id="t-sub"></dd></div>' +
            '<div data-tax="intra"><dt>CGST <input class="rate" type="number" min="0" max="100" step="0.25" data-f="cgst_rate" value="' + esc(d.cgst_rate) + '" aria-label="CGST percent"> %</dt><dd id="t-cgst"></dd></div>' +
            '<div data-tax="intra"><dt>SGST <input class="rate" type="number" min="0" max="100" step="0.25" data-f="sgst_rate" value="' + esc(d.sgst_rate) + '" aria-label="SGST percent"> %</dt><dd id="t-sgst"></dd></div>' +
            '<div data-tax="inter"><dt>IGST <input class="rate" type="number" min="0" max="100" step="0.25" data-f="igst_rate" value="' + esc(d.igst_rate) + '" aria-label="IGST percent"> %</dt><dd id="t-igst"></dd></div>' +
            '<div><dt>Round off</dt><dd id="t-round"></dd></div>' +
            '<div class="grand"><dt>Grand total</dt><dd id="t-grand"></dd></div>' +
          '</dl></section>' +

        '<div class="savebar"><span id="fit-note" class="fit-note"></span>' +
          '<button type="button" class="btn only-narrow" data-act="preview">Preview</button>' +
          '<button type="submit" class="btn primary">' + (d.id ? 'Save changes' : 'Save invoice') + '</button></div>' +
      '</form>' +
      '<aside class="preview-col" aria-label="Invoice preview"><div class="preview-head">Live preview <span>A4, prints exactly like this</span></div>' +
        '<div class="sheet-holder" id="preview"></div></aside>' +
      '</div>';
    refreshEditor(true);
  }

  var previewTimer;
  function refreshEditor(now) {
    var d = S.draft, t = Sheet.compute(d);
    $$('#item-rows .item-row').forEach(function (row, i) {
      var it = d.items[i] || {};
      $('.i-amt', row).textContent = money((Number(it.qty) || 0) * (Number(it.unit_price) || 0));
    });
    $$('[data-tax]').forEach(function (el) { el.hidden = el.getAttribute('data-tax') !== t.tax_type; });
    $('#t-sub').textContent = money(t.sub_total_price);
    $('#t-cgst').textContent = money(t.cgst_amount);
    $('#t-sgst').textContent = money(t.sgst_amount);
    $('#t-igst').textContent = money(t.igst_amount);
    $('#t-round').textContent = (t.round_off > 0 ? '+' : '') + money(t.round_off);
    $('#t-grand').textContent = '₹ ' + money(t.grand_total);
    $('#t-words').textContent = t.total_words;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      var holder = $('#preview');
      if (!holder) return;
      var s = mountSheet(holder, draftInvoice());
      var note = fitNote(s, t.items.length), el = $('#fit-note');
      el.textContent = note.text; el.className = 'fit-note ' + note.cls;
    }, now ? 0 : 140);
    rememberDraft();
  }

  function fillClient(c) {
    var d = S.draft;
    d.client_name = c.name; d.client_gstin = c.gstin || ''; d.client_phone = c.phone || ''; d.client_email = c.email || ''; d.client_address = c.address || '';
    ['client_gstin', 'client_phone', 'client_email', 'client_address'].forEach(function (k) {
      var el = $('[data-f="' + k + '"]'); if (el) el.value = d[k];
    });
  }

  function onEditorInput(e) {
    var el = e.target, d = S.draft;
    var f = el.getAttribute('data-f');
    if (f) {
      d[f] = el.type === 'checkbox' ? el.checked : el.value;
      if (f === 'invoice_no') d.number_touched = true;
      if (f === 'ship_diff') $('#ship-field').hidden = !el.checked;
      if (f === 'client_name') {
        var match = S.clients.filter(function (c) { return c.name.toLowerCase() === el.value.trim().toLowerCase(); })[0];
        if (match) fillClient(match);
      }
      refreshEditor();
      return;
    }
    var k = el.getAttribute('data-k'), row = el.closest('.item-row');
    if (k && row) {
      d.items[Number(row.getAttribute('data-i'))][k] = el.value;
      refreshEditor();
    }
  }

  function saveInvoice(btn) {
    var d = S.draft;
    var focus = function (sel, msg) { var el = $(sel); if (el) el.focus(); toast(msg, 'error'); };
    if (!String(d.invoice_no).trim()) return focus('[data-f=invoice_no]', 'Enter an invoice number.');
    if (!d.invoice_date) return focus('[data-f=invoice_date]', 'Choose the invoice date.');
    if (!String(d.client_name).trim()) return focus('[data-f=client_name]', 'Enter the client name.');
    var named = 0;
    for (var i = 0; i < d.items.length; i++) {
      var it = d.items[i], has = String(it.item).trim();
      if (has) named++;
      else if (Number(it.unit_price) > 0 || String(it.hsn).trim()) return focus('.item-row[data-i="' + i + '"] .i-desc', 'Item ' + (i + 1) + ' needs a description.');
      if (has && !(Number(it.qty) > 0)) return focus('.item-row[data-i="' + i + '"] .i-qty', 'Item ' + (i + 1) + ' needs a quantity.');
    }
    if (!named) return focus('.i-desc', 'Add at least one item.');

    var payload = draftInvoice();
    busy(btn, true);
    api('saveInvoice', payload).then(function (res) {
      upsert(S.invoices, res.invoice, 'id', true);
      upsert(S.firms, res.firm, 'id');
      upsert(S.clients, res.client, 'id');
      toast(d.id ? 'Changes saved to Google Sheets' : 'Invoice ' + res.invoice.invoice_no + ' saved to Google Sheets', 'ok');
      S.draft = newDraft(res.firm.id);
      store.del('cis_draft');
      renderEditor();
      openViewer(res.invoice, true);
    }).catch(function (err) {
      busy(btn, false);
      if (err.code === 'DUPLICATE' && !d.id) {
        return load(true).then(function () {
          var firm = firmById(d.firm_id);
          if (firm && !d.number_touched) {
            d.invoice_no = nextNo(firm);
            renderEditor();
            toast('A teammate just used that number. Changed to ' + d.invoice_no + '. Save again.', 'error');
          } else toast(err.message, 'error');
        });
      }
      if (err.code !== 'AUTH') toast(err.message, 'error');
    });
  }

  // ------------------------------------------------------------------ invoice viewer
  function shareText(inv, firm) {
    return '*TAX INVOICE - ' + String(firm.name || '').toUpperCase() + '*\n\nDear ' + inv.client_name + ',\nPlease find the invoice details below:\n\n' +
      '*Bill No:* ' + inv.invoice_no + '\n*Date:* ' + inv.invoice_date + '\n*Total Amount:* ₹' + money(inv.grand_total) + '\n\n' +
      '*Bank details for payment*\nBank: ' + (firm.bank_name || '-') + '\nA/C Name: ' + (firm.account_name || firm.name || '-') +
      '\nA/C No: ' + (firm.account_no || '-') + '\nIFSC: ' + (firm.ifsc_code || '-') + '\n\n' + (firm.email ? 'Email: ' + firm.email + '\n' : '') + 'Thank you for your business!';
  }

  function openWhatsApp(inv, firm, phone) {
    var digits = String(phone).replace(/\D/g, '');
    if (digits.length === 10) digits = '91' + digits;
    window.open('https://wa.me/' + digits + '?text=' + encodeURIComponent(shareText(inv, firm)), '_blank', 'noopener');
  }

  function whatsApp(inv, firm) {
    if (String(inv.client_phone).replace(/\D/g, '').length >= 10) return openWhatsApp(inv, firm, inv.client_phone);
    formDialog({
      title: 'Send on WhatsApp', intro: 'No phone number is saved for ' + inv.client_name + '.', submitLabel: 'Open WhatsApp',
      fields: [{ k: 'phone', label: 'WhatsApp number', type: 'tel', required: true, placeholder: '98290 12345' }],
      onSubmit: function (v) {
        if (v.phone.replace(/\D/g, '').length < 10) throw new Error('Enter a 10-digit mobile number.');
        openWhatsApp(inv, firm, v.phone);
      }
    });
  }

  function gmail(inv, firm) {
    var tax = (Number(inv.cgst_amount) || 0) + (Number(inv.sgst_amount) || 0) + (Number(inv.igst_amount) || 0);
    var body = 'Dear ' + inv.client_name + ',\n\nGreetings from ' + firm.name + '.\n\nPlease find the details of Tax Invoice ' + inv.invoice_no + ' dated ' + inv.invoice_date + '.\n\n' +
      'Taxable value: ₹' + money(inv.sub_total_price) + '\nGST: ₹' + money(tax) + '\nGrand total: ₹' + money(inv.grand_total) + '\nIn words: ' + inv.total_words + '\n\n' +
      'Bank details for payment\nBank: ' + (firm.bank_name || '-') + '\nAccount name: ' + (firm.account_name || firm.name) + '\nAccount no: ' + (firm.account_no || '-') + '\nIFSC: ' + (firm.ifsc_code || '-') + '\n\n' +
      'Warm regards,\n' + firm.name + '\nGSTIN: ' + (firm.gstin || '-');
    window.open('https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(inv.client_email || '') + '&cc=' + encodeURIComponent(firm.email || '') +
      '&su=' + encodeURIComponent('Tax Invoice ' + inv.invoice_no + ' from ' + firm.name) + '&body=' + encodeURIComponent(body), '_blank', 'noopener');
  }

  function statusChip(s) { return '<span class="chip ' + esc(String(s || 'Issued').toLowerCase()) + '">' + esc(s || 'Issued') + '</span>'; }

  function openViewer(inv, justSaved) {
    var firm = firmById(inv.firm_id) || { name: inv.firm_name };
    var mine = isAdmin() || inv.created_by === S.user.username;
    var cancelled = inv.status === 'Cancelled';
    var d = openDialog(
      '<header><h2>' + esc(inv.invoice_no) + ' ' + statusChip(inv.status) + '</h2><button type="button" class="icon-btn" data-close aria-label="Close">&times;</button></header>' +
      '<div class="viewer-body"><div class="viewer-sheet"><div class="sheet-holder"></div></div>' +
      '<div class="viewer-side">' +
        (justSaved ? '<p class="notice ok">Saved. It is now a row in the Google Sheet.</p>' : '') +
        '<dl class="facts"><div><dt>Firm</dt><dd>' + esc(firm.name) + '</dd></div><div><dt>Client</dt><dd>' + esc(inv.client_name) + '</dd></div>' +
        '<div><dt>Date</dt><dd>' + esc(inv.invoice_date) + '</dd></div><div><dt>Total</dt><dd>₹ ' + money(inv.grand_total) + '</dd></div>' +
        '<div><dt>Created by</dt><dd>' + esc(inv.created_by || '-') + '</dd></div></dl>' +
        '<p class="fit-note" data-fit></p>' +
        '<button class="btn primary block" data-v="print">Print / Save as PDF</button>' +
        '<div class="btn-pair"><button class="btn" data-v="wa">WhatsApp</button><button class="btn" data-v="mail">Email</button></div>' +
        '<hr>' +
        (cancelled ? '' : (inv.status === 'Paid' ? '<button class="btn block" data-v="unpaid">Mark as unpaid</button>' : '<button class="btn block" data-v="paid">Mark as paid</button>')) +
        (mine && !cancelled ? '<button class="btn block" data-v="edit">Edit</button>' : '') +
        '<button class="btn block" data-v="copy">Duplicate as new invoice</button>' +
        (isAdmin() && !cancelled ? '<button class="btn block danger-text" data-v="cancel">Cancel invoice</button>' : '') +
        (isAdmin() && cancelled ? '<button class="btn block" data-v="restore">Restore invoice</button>' : '') +
        (justSaved ? '<button class="btn quiet block" data-close>Create another invoice</button>' : '') +
      '</div></div>', 'viewer');

    var s = mountSheet($('.sheet-holder', d), inv);
    var note = fitNote(s, (inv.items || []).length), noteEl = $('[data-fit]', d);
    noteEl.textContent = note.text; noteEl.className = 'fit-note ' + note.cls;

    var setStatus = function (btn, status) {
      busy(btn, true);
      return api('setInvoiceStatus', { id: inv.id, status: status }).then(function (res) {
        upsert(S.invoices, res.invoice, 'id', true);
        d.close();
        toast('Invoice ' + inv.invoice_no + ' marked ' + status.toLowerCase(), 'ok');
        if (currentView() === 'invoices') renderInvoices();
        openViewer(res.invoice);
      }).catch(function (err) { busy(btn, false); toast(err.message, 'error'); });
    };

    d.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-v]');
      if (!btn) return;
      var act = btn.getAttribute('data-v');
      if (act === 'print') printInvoice(inv);
      else if (act === 'wa') whatsApp(inv, firm);
      else if (act === 'mail') gmail(inv, firm);
      else if (act === 'paid') setStatus(btn, 'Paid');
      else if (act === 'unpaid' || act === 'restore') setStatus(btn, 'Issued');
      else if (act === 'cancel') {
        formDialog({
          title: 'Cancel invoice ' + inv.invoice_no + '?', danger: true, submitLabel: 'Cancel invoice', cancelLabel: 'Keep invoice',
          intro: 'The invoice stays in the records marked Cancelled, and its number is not reused.',
          onSubmit: function () { return setStatus(null, 'Cancelled'); }
        });
      } else if (act === 'edit' || act === 'copy') {
        if (act === 'edit') S.draft = draftFromInvoice(inv);
        else S.draft = newDraft(firmById(inv.firm_id) && firmById(inv.firm_id).active !== 'no' ? inv.firm_id : '', inv);
        d.close();
        if (currentView() === 'new') renderEditor(); else location.hash = '#new';
      }
    });
  }

  // ------------------------------------------------------------------ Invoices list
  function renderInvoices() {
    var f = S.filters;
    $('#view').innerHTML =
      '<div class="page">' +
      '<div class="page-head"><h1>Invoices</h1><div class="head-actions"><button class="btn quiet" data-act="reload">Refresh</button><a class="btn primary" href="#new">New invoice</a></div></div>' +
      '<div class="filters">' +
        '<input type="search" id="f-q" placeholder="Search invoice number or client" value="' + esc(f.q) + '" aria-label="Search invoices">' +
        '<select id="f-firm" aria-label="Firm"><option value="all">All firms</option>' + S.firms.map(function (x) {
          return '<option value="' + esc(x.id) + '"' + (f.firm === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select>' +
        '<select id="f-status" aria-label="Status">' + [['all', 'Any status'], ['Issued', 'Unpaid'], ['Paid', 'Paid'], ['Cancelled', 'Cancelled']].map(function (o) {
          return '<option value="' + o[0] + '"' + (f.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      '</div><div id="inv-list"></div></div>';
    drawInvoiceList();
  }

  function drawInvoiceList() {
    var f = S.filters, q = f.q.trim().toLowerCase();
    var rows = S.invoices.filter(function (i) {
      return (f.firm === 'all' || i.firm_id === f.firm) && (f.status === 'all' || (i.status || 'Issued') === f.status) &&
        (!q || String(i.invoice_no).toLowerCase().indexOf(q) >= 0 || String(i.client_name).toLowerCase().indexOf(q) >= 0);
    });
    var live = rows.filter(function (i) { return i.status !== 'Cancelled'; });
    var sum = function (list, fn) { return list.reduce(function (a, i) { return a + (Number(fn(i)) || 0); }, 0); };
    var billed = sum(live, function (i) { return i.grand_total; });
    var gst = sum(live, function (i) { return i.cgst_amount + i.sgst_amount + i.igst_amount; });
    var unpaid = sum(live.filter(function (i) { return i.status !== 'Paid'; }), function (i) { return i.grand_total; });
    var box = $('#inv-list');
    if (!S.invoices.length) {
      box.innerHTML = '<div class="empty-state"><h2>No invoices yet</h2><p>The first invoice you save appears here and in the Google Sheet.</p><a class="btn primary" href="#new">Create an invoice</a></div>';
      return;
    }
    box.innerHTML =
      '<dl class="summary"><div><dt>Invoices</dt><dd>' + live.length + '</dd></div><div><dt>Billed</dt><dd>₹ ' + money(billed) + '</dd></div>' +
      '<div><dt>GST in these</dt><dd>₹ ' + money(gst) + '</dd></div><div><dt>Awaiting payment</dt><dd>₹ ' + money(unpaid) + '</dd></div></dl>' +
      (rows.length ? '<div class="table-wrap"><table class="list"><thead><tr><th>Invoice</th><th>Date</th><th>Client</th><th class="hide-s">Firm</th><th class="num hide-s">Taxable</th><th class="num hide-s">GST</th><th class="num">Total</th><th>Status</th><th class="hide-s">By</th></tr></thead><tbody>' +
        rows.map(function (i) {
          var firm = firmById(i.firm_id) || {};
          return '<tr data-id="' + esc(i.id) + '" class="' + (i.status === 'Cancelled' ? 'void' : '') + '">' +
            '<td><button class="link" data-act="view">' + esc(i.invoice_no) + '</button></td><td class="nowrap">' + esc(i.invoice_date) + '</td><td>' + esc(i.client_name) + '</td>' +
            '<td class="hide-s"><span class="dot" style="background:' + Sheet.safeColor(firm.theme_color) + '"></span>' + esc(firm.name || i.firm_name) + '</td>' +
            '<td class="num hide-s">' + money(i.sub_total_price) + '</td><td class="num hide-s">' + money(i.cgst_amount + i.sgst_amount + i.igst_amount) + '</td>' +
            '<td class="num strong">' + money(i.grand_total) + '</td><td>' + statusChip(i.status) + '</td><td class="hide-s muted">' + esc(i.created_by) + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : '<div class="empty-state small"><p>No invoices match these filters.</p></div>');
  }

  // ------------------------------------------------------------------ Clients
  var CLIENT_FIELDS = [
    { k: 'name', label: 'Client name', required: true }, { k: 'gstin', label: 'GSTIN', half: true, placeholder: 'Leave empty if unregistered' },
    { k: 'phone', label: 'Phone / WhatsApp', type: 'tel', half: true }, { k: 'email', label: 'Email', type: 'email' },
    { k: 'address', label: 'Billing address', type: 'textarea' }
  ];

  function renderClients() {
    $('#view').innerHTML = '<div class="page"><div class="page-head"><h1>Clients</h1><button class="btn primary" data-act="add-client">Add client</button></div>' +
      (S.clients.length
        ? '<div class="table-wrap"><table class="list"><thead><tr><th>Name</th><th>GSTIN</th><th class="hide-s">Phone</th><th class="hide-s">Email</th><th class="hide-s">Address</th><th></th></tr></thead><tbody>' +
          S.clients.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (c) {
            return '<tr data-id="' + esc(c.id) + '"><td><button class="link" data-act="edit-client">' + esc(c.name) + '</button></td><td>' + (esc(c.gstin) || '<span class="muted">Unregistered</span>') +
              '</td><td class="hide-s">' + esc(c.phone) + '</td><td class="hide-s">' + esc(c.email) + '</td><td class="hide-s">' + esc(c.address) +
              '</td><td class="num"><button class="btn small" data-act="invoice-client">New invoice</button></td></tr>';
          }).join('') + '</tbody></table></div>'
        : '<div class="empty-state"><h2>No clients saved</h2><p>Clients are saved automatically when you create an invoice.</p></div>') + '</div>';
  }

  function clientDialog(c) {
    formDialog({
      title: c ? 'Edit client' : 'Add client', fields: CLIENT_FIELDS, values: c || {}, submitLabel: c ? 'Save changes' : 'Add client',
      onSubmit: function (v) {
        if (c) v.id = c.id;
        return api('saveClient', v).then(function (res) { upsert(S.clients, res.client, 'id'); renderClients(); toast('Client saved', 'ok'); });
      }
    });
  }

  // ------------------------------------------------------------------ Firms
  function renderFirms() {
    $('#view').innerHTML = '<div class="page"><div class="page-head"><h1>Firms</h1>' + (isAdmin() ? '<button class="btn primary" data-act="add-firm">Add firm</button>' : '') + '</div>' +
      (isAdmin() ? '' : '<p class="muted">Only an admin can change firm and bank details.</p>') +
      '<div class="firm-cards">' + S.firms.map(function (f) {
        var logo = Sheet.safeLogo(f.logo_url);
        return '<article class="firm-card' + (f.active === 'no' ? ' off' : '') + '" style="--fc:' + Sheet.safeColor(f.theme_color) + '" data-id="' + esc(f.id) + '">' +
          '<div class="firm-card-head">' + (logo ? '<img src="' + esc(logo) + '" alt="">' : '') + '<div><h2>' + esc(f.name) + (f.active === 'no' ? ' <span class="chip cancelled">Inactive</span>' : '') + '</h2><p>' + esc(f.address) + '</p></div></div>' +
          '<dl class="facts"><div><dt>GSTIN</dt><dd>' + esc(f.gstin || '-') + '</dd></div><div><dt>Email</dt><dd>' + esc(f.email || '-') + '</dd></div>' +
          '<div><dt>Bank</dt><dd>' + esc(f.bank_name || '-') + '</dd></div><div><dt>Account</dt><dd>' + esc(f.account_no || '-') + '</dd></div>' +
          '<div><dt>IFSC</dt><dd>' + esc(f.ifsc_code || '-') + '</dd></div><div><dt>Next invoice</dt><dd>' + esc(nextNo(f)) + '</dd></div></dl>' +
          (isAdmin() ? '<button class="btn" data-act="edit-firm">Edit details</button>' : '') + '</article>';
      }).join('') + '</div></div>';
  }

  function firmDialog(f) {
    var v = f || { theme_color: '#1e3a8a', next_invoice_no: 1, state: 'Rajasthan', state_code: '08', active: 'yes' };
    formDialog({
      title: f ? 'Edit ' + f.name : 'Add firm', values: v, submitLabel: f ? 'Save changes' : 'Add firm', cls: 'wide',
      fields: [
        { k: 'name', label: 'Firm name', required: true }, { k: 'address', label: 'Registered address', type: 'textarea' },
        { k: 'gstin', label: 'GSTIN', half: true }, { k: 'email', label: 'Email', type: 'email', half: true },
        { k: 'phone', label: 'Phone', type: 'tel', half: true }, { k: 'upi_id', label: 'UPI ID (optional)', half: true },
        { k: 'bank_name', label: 'Bank name', half: true }, { k: 'account_name', label: 'Account holder name', half: true },
        { k: 'account_no', label: 'Account number', half: true }, { k: 'ifsc_code', label: 'IFSC code', half: true },
        { k: 'invoice_prefix', label: 'Invoice number prefix', half: true, placeholder: 'e.g. CRF-' },
        { k: 'next_invoice_no', label: 'Next invoice number', type: 'number', half: true },
        { k: 'theme_color', label: 'Invoice colour', type: 'color', half: true },
        { k: 'active', label: 'Status', type: 'select', half: true, options: [['yes', 'Active'], ['no', 'Inactive (hidden when billing)']] },
        { k: 'logo_url', label: 'Logo', type: 'logo', hint: 'PNG or JPG. It is resized automatically.' }
      ],
      onSubmit: function (out) {
        if (f) { out.id = f.id; out.state = f.state; out.state_code = f.state_code; }
        return api('saveFirm', out).then(function (res) { upsert(S.firms, res.firm, 'id'); renderFirms(); toast('Firm saved', 'ok'); });
      }
    });
  }

  // ------------------------------------------------------------------ Team
  function renderTeam() {
    $('#view').innerHTML = '<div class="page narrow"><div class="page-head"><h1>Team</h1><button class="btn primary" data-act="add-user">Add team member</button></div>' +
      '<p class="muted">Each person signs in with their own username and PIN. Every invoice records who created it.</p>' +
      '<div class="table-wrap"><table class="list"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>' +
      S.users.map(function (u) {
        return '<tr data-id="' + esc(u.username) + '"><td class="strong">' + esc(u.name) + '</td><td>' + esc(u.username) + '</td><td>' + (u.role === 'admin' ? 'Admin' : 'Member') +
          '</td><td>' + (u.active ? '<span class="chip paid">Active</span>' : '<span class="chip cancelled">Disabled</span>') + '</td><td class="num"><button class="btn small" data-act="edit-user">Edit</button></td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  function userDialog(u) {
    formDialog({
      title: u ? 'Edit ' + u.name : 'Add team member', submitLabel: u ? 'Save changes' : 'Add member',
      values: u ? { username: u.username, name: u.name, role: u.role, active: u.active ? 'yes' : 'no' } : { role: 'member', active: 'yes' },
      fields: [
        { k: 'name', label: 'Full name', required: true },
        { k: 'username', label: 'Username', required: true, readonly: !!u, half: true, placeholder: 'e.g. ravi', autocomplete: 'off' },
        { k: 'pin', label: u ? 'New PIN (leave empty to keep)' : 'PIN', type: 'password', required: !u, half: true, autocomplete: 'new-password', hint: 'At least 6 characters. Share it with them privately.' },
        { k: 'role', label: 'Role', type: 'select', half: true, options: [['member', 'Member: creates invoices'], ['admin', 'Admin: also manages firms and team']] },
        { k: 'active', label: 'Access', type: 'select', half: true, options: [['yes', 'Can sign in'], ['no', 'Disabled']] }
      ],
      onSubmit: function (v) {
        v.is_new = !u;
        return api('saveUser', v).then(function (res) { S.users = res.users; renderTeam(); toast('Team member saved', 'ok'); });
      }
    });
  }

  function changePinDialog() {
    formDialog({
      title: 'Change your PIN', submitLabel: 'Change PIN',
      fields: [{ k: 'current_pin', label: 'Current PIN', type: 'password', required: true, autocomplete: 'current-password' },
        { k: 'new_pin', label: 'New PIN', type: 'password', required: true, autocomplete: 'new-password', hint: 'At least 6 characters.' }],
      onSubmit: function (v) {
        return api('changeMyPin', v).then(function (res) { S.token = res.token; store.set('cis_token', res.token); toast('PIN changed', 'ok'); });
      }
    });
  }

  // ------------------------------------------------------------------ events
  $('#view').addEventListener('input', function (e) {
    if (e.target.closest('#inv-form')) return onEditorInput(e);
    if (e.target.id === 'f-q') { S.filters.q = e.target.value; drawInvoiceList(); }
  });
  $('#view').addEventListener('change', function (e) {
    if (e.target.id === 'f-firm') { S.filters.firm = e.target.value; drawInvoiceList(); }
    if (e.target.id === 'f-status') { S.filters.status = e.target.value; drawInvoiceList(); }
  });
  $('#view').addEventListener('submit', function (e) {
    if (e.target.id === 'inv-form') { e.preventDefault(); saveInvoice($('button[type=submit]', e.target)); }
  });
  $('#view').addEventListener('keydown', function (e) {
    // Enter in the last item's price adds the next row, for fast keyboard entry.
    if (e.key === 'Enter' && e.target.matches('.item-row input')) {
      e.preventDefault();
      var rows = $$('#item-rows .item-row');
      if (e.target.closest('.item-row') === rows[rows.length - 1]) addItem();
      else $('.i-desc', rows[rows.indexOf(e.target.closest('.item-row')) + 1]).focus();
    }
  });

  function addItem() {
    S.draft.items.push({ item: '', hsn: '', qty: 1, unit_price: '' });
    $('#item-rows').insertAdjacentHTML('beforeend', itemRowHtml(S.draft.items[S.draft.items.length - 1], S.draft.items.length - 1));
    refreshEditor();
    $('#item-rows .item-row:last-child .i-desc').focus();
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el || !S.user && el.getAttribute('data-act') !== 'reload') return;
    var act = el.getAttribute('data-act');
    var row = el.closest('[data-id]'), id = row ? row.getAttribute('data-id') : '';
    var d = S.draft;
    switch (act) {
      case 'reload': load().then(function () { toast('Up to date', 'ok'); }); break;
      case 'sign-out': signOut(); break;
      case 'change-pin': closeMenu(); changePinDialog(); break;
      case 'firm':
        d.firm_id = el.getAttribute('data-id');
        if (!d.id && !d.number_touched) d.invoice_no = nextNo(firmById(d.firm_id));
        renderEditor();
        break;
      case 'add-item': addItem(); break;
      case 'del-item':
        if (d.items.length === 1) d.items[0] = { item: '', hsn: '', qty: 1, unit_price: '' };
        else d.items.splice(Number(el.closest('.item-row').getAttribute('data-i')), 1);
        $('#item-rows').innerHTML = d.items.map(itemRowHtml).join('');
        refreshEditor();
        break;
      case 'reset':
        S.draft = newDraft(d.firm_id); store.del('cis_draft'); renderEditor();
        break;
      case 'preview': {
        var dlg = openDialog('<header><h2>Preview</h2><button type="button" class="icon-btn" data-close aria-label="Close">&times;</button></header><div class="viewer-sheet"><div class="sheet-holder"></div></div>', 'viewer');
        mountSheet($('.sheet-holder', dlg), draftInvoice());
        break;
      }
      case 'view': openViewer(S.invoices.filter(function (i) { return i.id === id; })[0]); break;
      case 'add-client': clientDialog(); break;
      case 'edit-client': clientDialog(S.clients.filter(function (c) { return c.id === id; })[0]); break;
      case 'invoice-client': {
        var c = S.clients.filter(function (x) { return x.id === id; })[0];
        S.draft = newDraft((S.draft || {}).firm_id, { client_name: c.name, client_gstin: c.gstin, client_phone: c.phone, client_email: c.email, client_address: c.address });
        location.hash = '#new';
        break;
      }
      case 'add-firm': firmDialog(); break;
      case 'edit-firm': firmDialog(firmById(id)); break;
      case 'add-user': userDialog(); break;
      case 'edit-user': userDialog(S.users.filter(function (u) { return u.username === id; })[0]); break;
    }
  });

  // ------------------------------------------------------------------ start
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (S.user && currentView() === 'new') refreshEditor(true); });
  if (S.token && API) load(); else showLogin();
})();
