// The A4 invoice sheet: totals, amount in words, HTML, and fit-to-one-page.
// Used by the live preview, the invoice viewer and printing, so all three are identical.
(function (global) {
  'use strict';

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function money(n) {
    return (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function r2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

  function safeColor(c) { return /^#[0-9a-fA-F]{6}$/.test(String(c || '')) ? c : '#1e3a8a'; }

  function safeLogo(url) {
    url = String(url || '');
    return /^(data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$|https:\/\/|assets\/[\w.-]+$)/.test(url) ? url : '';
  }

  function amountInWords(num) {
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

  // Same arithmetic as the Google Sheet backend, so the preview matches what gets saved.
  function compute(d) {
    var items = [];
    (d.items || []).forEach(function (it) {
      var name = String(it.item || '').trim();
      var qty = Number(it.qty) || 0, price = Number(it.unit_price) || 0;
      if (!name && !price) return;
      items.push({ sno: items.length + 1, item: name, hsn: String(it.hsn || '').trim(), qty: qty, unit_price: price, total_price: r2(qty * price) });
    });
    var intra = d.tax_type !== 'inter';
    var subQty = 0, sub = 0;
    items.forEach(function (it) { subQty += it.qty; sub += it.total_price; });
    sub = r2(sub);
    var cgstRate = intra ? Number(d.cgst_rate) || 0 : 0;
    var sgstRate = intra ? Number(d.sgst_rate) || 0 : 0;
    var igstRate = intra ? 0 : Number(d.igst_rate) || 0;
    var cgst = r2(sub * cgstRate / 100), sgst = r2(sub * sgstRate / 100), igst = r2(sub * igstRate / 100);
    var raw = r2(sub + cgst + sgst + igst);
    var grand = Math.round(raw);
    return {
      items: items, tax_type: intra ? 'intra' : 'inter', sub_total_qty: subQty, sub_total_price: sub,
      cgst_rate: cgstRate, cgst_amount: cgst, sgst_rate: sgstRate, sgst_amount: sgst, igst_rate: igstRate, igst_amount: igst,
      round_off: r2(grand - raw), grand_total: grand, total_words: amountInWords(grand)
    };
  }

  function pct(n) { return (Number(n) || 0).toString() + '%'; }

  function html(inv, firm) {
    firm = firm || {};
    var items = inv.items || [];
    var intra = inv.tax_type ? inv.tax_type !== 'inter' : !(Number(inv.igst_amount) > 0);
    var logo = safeLogo(firm.logo_url);
    var rateSum = 0;
    var rows = items.map(function (it, i) {
      rateSum += Number(it.unit_price) || 0;
      return '<tr><td class="c">' + (i + 1) + '</td><td class="desc">' + esc(it.item) + '</td><td class="c">' + esc(it.hsn || '-') +
        '</td><td class="c">' + esc(Number(it.qty) || 0) + '</td><td class="r">' + money(it.unit_price) + '</td><td class="r b">' + money(it.total_price) + '</td></tr>';
    }).join('');
    if (!rows) rows = '<tr><td class="c">1</td><td class="desc empty">Items you add appear here</td><td></td><td></td><td></td><td></td></tr>';

    var taxRows = intra
      ? '<tr><td>CGST (' + pct(inv.cgst_rate) + ')</td><td class="r">' + money(inv.cgst_amount) + '</td></tr>' +
        '<tr><td>SGST (' + pct(inv.sgst_rate) + ')</td><td class="r">' + money(inv.sgst_amount) + '</td></tr>'
      : '<tr><td>IGST (' + pct(inv.igst_rate) + ')</td><td class="r">' + money(inv.igst_amount) + '</td></tr>';

    var shipTo = String(inv.ship_to || '').trim();
    var contact = [firm.email ? 'Email: ' + esc(firm.email) : '', firm.phone ? 'Phone: ' + esc(firm.phone) : ''].filter(Boolean).join(' &nbsp;|&nbsp; ');

    return '' +
      '<div class="sheet" style="--c:' + safeColor(firm.theme_color) + '">' +
      (inv.status === 'Cancelled' ? '<div class="sh-void">Cancelled</div>' : '') +
      '<div class="sheet-fit">' +
        '<div class="sh-head">' +
          '<div class="sh-firm">' +
            (logo ? '<img class="sh-logo" src="' + esc(logo) + '" alt="">' : '') +
            '<div class="sh-firm-name">' + esc(firm.name || '') + '</div>' +
            '<div class="sh-line">' + esc(firm.address || '') + '</div>' +
            (contact ? '<div class="sh-line">' + contact + '</div>' : '') +
            '<div class="sh-line"><b>GSTIN: ' + esc(firm.gstin || '-') + '</b></div>' +
          '</div>' +
          '<div class="sh-meta">' +
            '<div class="sh-title">Tax Invoice</div>' +
            '<table><tr><td>Invoice No.</td><td class="b">' + esc(inv.invoice_no || '-') + '</td></tr>' +
            '<tr><td>Date</td><td class="b">' + esc(inv.invoice_date || '-') + '</td></tr></table>' +
          '</div>' +
        '</div>' +
        '<div class="sh-parties">' +
          '<div class="sh-party"><div class="sh-label">Billed to</div>' +
            '<div class="sh-party-name">' + (esc(inv.client_name) || '<span class="empty">Client name</span>') + '</div>' +
            (inv.client_address ? '<div class="sh-line pre">' + esc(inv.client_address) + '</div>' : '') +
            '<div class="sh-line"><b>GSTIN:</b> ' + (inv.client_gstin ? esc(String(inv.client_gstin).toUpperCase()) : 'Unregistered / Govt.') + '</div>' +
          '</div>' +
          '<div class="sh-party"><div class="sh-label">Shipped to</div>' +
            (shipTo ? '<div class="sh-line pre strong">' + esc(shipTo) + '</div>' : '<div class="sh-line strong">Same as billed to</div>') +
            (inv.notes ? '<div class="sh-line"><b>PO / Ref:</b> ' + esc(inv.notes) + '</div>' : '') +
          '</div>' +
        '</div>' +
        '<table class="sh-items">' +
          '<thead><tr><th class="c w-sno">S.No</th><th class="l">Description of goods / services</th><th class="c w-hsn">HSN / SAC</th>' +
          '<th class="c w-qty">Qty</th><th class="r w-rate">Unit price (&#8377;)</th><th class="r w-amt">Total (&#8377;)</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
          '<tfoot><tr><td colspan="3" class="r">Sub total (taxable value)</td><td class="c">' + esc(Number(inv.sub_total_qty) || 0) + '</td>' +
          '<td class="r">' + (rateSum ? money(rateSum) : '') + '</td><td class="r">' + money(inv.sub_total_price) + '</td></tr></tfoot>' +
        '</table>' +
        '<div class="sh-bottom">' +
          '<div class="sh-left">' +
            '<div class="sh-box"><div class="sh-label">Bank details for payment</div>' +
              '<table class="sh-bank">' +
              '<tr><td>Bank</td><td>' + esc(firm.bank_name || '-') + '</td></tr>' +
              '<tr><td>A/C name</td><td>' + esc(firm.account_name || firm.name || '-') + '</td></tr>' +
              '<tr><td>A/C no.</td><td>' + esc(firm.account_no || '-') + '</td></tr>' +
              '<tr><td>IFSC</td><td>' + esc(firm.ifsc_code || '-') + '</td></tr>' +
              (firm.upi_id ? '<tr><td>UPI</td><td>' + esc(firm.upi_id) + '</td></tr>' : '') +
              '</table></div>' +
            '<div class="sh-words"><div class="sh-label">Total amount in words</div><div>' + esc(inv.total_words || '') + '</div></div>' +
          '</div>' +
          '<table class="sh-tax">' +
            '<tr><td>Taxable amount</td><td class="r">' + money(inv.sub_total_price) + '</td></tr>' + taxRows +
            '<tr><td>Round off</td><td class="r">' + money(inv.round_off) + '</td></tr>' +
            '<tr class="grand"><td>Grand total</td><td class="r">&#8377; ' + money(inv.grand_total) + '</td></tr>' +
          '</table>' +
        '</div>' +
        '<div class="sh-grow"></div>' +
        '<div class="sh-foot">' +
          '<div class="sh-terms"><b>Terms &amp; conditions</b><br>1. Goods once sold will not be taken back.<br>' +
            '2. Payments due within terms of work order / contract.<br>3. Subject to ' + esc((firm.address || '').match(/jodhpur/i) ? 'Jodhpur' : 'local') + ' jurisdiction only.</div>' +
          '<div class="sh-sign"><div>For <b>' + esc(firm.name || '') + '</b></div><div class="sh-sign-line">Authorised signatory</div></div>' +
        '</div>' +
        '<div class="sh-note">This is a computer generated invoice.</div>' +
      '</div></div>';
  }

  /** Shrinks the sheet's content until everything sits on one A4 page. Returns the scale used (1 = full size). */
  function fit(sheet) {
    var inner = sheet.querySelector('.sheet-fit');
    var H = sheet.clientHeight;
    var set = function (s) { sheet.style.setProperty('--s', String(s)); };
    set(1);
    if (inner.offsetHeight <= H + 1.5) return 1;
    var lo = 0.05, hi = 1;
    for (var i = 0; i < 12; i++) {
      var mid = (lo + hi) / 2;
      set(mid);
      if (inner.offsetHeight * mid <= H + 1.5) lo = mid; else hi = mid;
    }
    set(lo);
    return lo;
  }

  global.Sheet = { esc: esc, money: money, compute: compute, amountInWords: amountInWords, html: html, fit: fit, safeColor: safeColor, safeLogo: safeLogo };
})(window);
