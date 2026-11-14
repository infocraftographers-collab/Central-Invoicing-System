#!/usr/bin/env node
// Backend checks against the local preview server. Usage: node dev/test-backend.js [port]
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = Number(process.argv[2] || 8791);
const DATA = path.join(os.tmpdir(), 'cis-test-' + process.pid + '.json');
const api = async (action, data, token) => {
  const r = await fetch('http://localhost:' + PORT + '/api', { method: 'POST', body: JSON.stringify({ action, data, token }) });
  return r.json();
};

(async () => {
  const srv = spawn('node', [path.join(__dirname, 'server.js'), PORT], {
    env: { ...process.env, DEV_ADMIN_PIN: '482913', DEV_DATA_FILE: DATA, DEV_DELAY_MS: '0' }, stdio: 'ignore'
  });
  try {
    for (let i = 0; i < 40; i++) { try { await fetch('http://localhost:' + PORT + '/'); break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }

    let r = await api('bootstrap', {}, 'nope');
    assert.equal(r.ok, false); assert.equal(r.code, 'AUTH');
    r = await api('login', { username: 'admin', pin: 'wrong1' });
    assert.equal(r.ok, false);
    r = await api('login', { username: 'Admin', pin: '482913' });
    assert.ok(r.ok, r.error);
    const admin = r.data.token;

    r = await api('bootstrap', {}, admin);
    assert.equal(r.data.firms.length, 2);
    const crafto = r.data.firms.find((f) => f.id === 'craftographers');
    assert.strictEqual(crafto.account_no, '50200050618222');
    assert.strictEqual(crafto.state_code, '08');
    assert.strictEqual(crafto.next_invoice_no, 12);
    assert.ok(r.data.users && r.data.sheet_url);

    // The real AS Enterprises invoice 20 from the old system: totals must match to the paisa.
    const items = [[253, 1452.54], [581, 194.92], [60, 964.41], [21, 1122.88], [45, 508.47], [98, 223.73], [215, 97.46], [18, 940.67], [53, 320.34], [26, 591.53]]
      .map(([qty, unit_price], i) => ({ item: 'Part ' + (i + 1), hsn: '8512', qty, unit_price }));
    const base = { firm_id: 'as_enterprises', invoice_no: 'ASE-21', invoice_date: '14/11/2026', client_name: "=HYPERLINK(\"x\") O'Brien & Sons",
      client_phone: '+91 98290 12345', tax_type: 'intra', cgst_rate: 9, sgst_rate: 9, items };
    r = await api('saveInvoice', base, admin);
    assert.ok(r.ok, r.error);
    const inv = r.data.invoice;
    assert.equal(inv.sub_total_qty, 1370);
    assert.equal(Math.round((inv.round_off + inv.sub_total_price + inv.cgst_amount + inv.sgst_amount) * 100) / 100, inv.grand_total);
    assert.ok(Math.abs(inv.round_off) <= 0.5);
    assert.equal(inv.cgst_amount, inv.sgst_amount);
    assert.equal(inv.total_words.endsWith('Rupees Only'), true);
    assert.equal(inv.client_name, "=HYPERLINK(\"x\") O'Brien & Sons");
    assert.equal(inv.client_phone, '+91 98290 12345');
    assert.equal(r.data.firm.next_invoice_no, 22);

    r = await api('saveInvoice', base, admin);
    assert.equal(r.code, 'DUPLICATE');
    r = await api('saveInvoice', { ...base, invoice_no: 'ASE-22', invoice_date: '2026-11-14' }, admin);
    assert.equal(r.ok, false);
    r = await api('saveInvoice', { ...base, invoice_no: 'ASE-22', items: [] }, admin);
    assert.equal(r.ok, false);

    // Team: member can create, cannot edit others' invoices, cancel, or touch firms/users.
    r = await api('saveUser', { is_new: true, username: 'Ravi', name: 'Ravi', role: 'member', pin: '123' }, admin);
    assert.equal(r.ok, false);
    r = await api('saveUser', { is_new: true, username: 'Ravi', name: 'Ravi', role: 'member', pin: '654321' }, admin);
    assert.ok(r.ok, r.error);
    r = await api('login', { username: 'ravi', pin: '654321' });
    const member = r.data.token;
    r = await api('bootstrap', {}, member);
    assert.equal(r.data.users, undefined); assert.equal(r.data.sheet_url, undefined);
    assert.equal(r.data.invoices.length, 1);
    r = await api('saveInvoice', { ...base, id: inv.id, client_name: 'Changed' }, member);
    assert.equal(r.ok, false);
    r = await api('setInvoiceStatus', { id: inv.id, status: 'Cancelled' }, member);
    assert.equal(r.ok, false);
    r = await api('setInvoiceStatus', { id: inv.id, status: 'Paid' }, member);
    assert.equal(r.data.invoice.status, 'Paid');
    r = await api('saveFirm', { id: 'craftographers', name: 'Hacked' }, member);
    assert.equal(r.ok, false);
    r = await api('saveUser', { username: 'ravi', role: 'admin' }, member);
    assert.equal(r.ok, false);
    r = await api('saveInvoice', { firm_id: 'craftographers', invoice_no: 'CRF-12', invoice_date: '14/11/2026', client_name: 'Depot', tax_type: 'inter', igst_rate: 18,
      items: [{ item: 'NBC FILTER', hsn: '8421', qty: 75, unit_price: 120210.16 }] }, member);
    assert.ok(r.ok, r.error);
    assert.equal(r.data.invoice.grand_total, 10638599);
    assert.equal(r.data.invoice.cgst_amount, 0);
    assert.equal(r.data.invoice.created_by, 'ravi');
    const mine = r.data.invoice;

    // Editing keeps the id, replaces item rows, never duplicates.
    r = await api('saveInvoice', { ...mine, items: [{ item: 'One', qty: 2, unit_price: 10.005 }], tax_type: 'intra', cgst_rate: 9, sgst_rate: 9 }, member);
    assert.ok(r.ok, r.error);
    assert.equal(r.data.invoice.id, mine.id);
    assert.equal(r.data.invoice.sub_total_price, 20.01);
    const sheets = JSON.parse(fs.readFileSync(DATA, 'utf8')).sheets;
    assert.equal(sheets['Invoices'].length, 3);
    assert.equal(sheets['Invoice Items'].filter((row) => row[0] === mine.id).length, 1);
    assert.equal(sheets['Invoice Items'].length, 1 + 10 + 1);

    // Cancel, PIN change, deactivation.
    r = await api('setInvoiceStatus', { id: inv.id, status: 'Cancelled' }, admin);
    assert.equal(r.data.invoice.status, 'Cancelled');
    r = await api('saveInvoice', { ...base, id: inv.id }, admin);
    assert.equal(r.ok, false);
    r = await api('changeMyPin', { current_pin: '654321', new_pin: '111222' }, member);
    assert.ok(r.ok, r.error);
    assert.equal((await api('bootstrap', {}, member)).code, 'AUTH');
    assert.ok((await api('bootstrap', {}, r.data.token)).ok);
    r = await api('saveUser', { username: 'admin', role: 'member' }, admin);
    assert.equal(r.ok, false);
    await api('saveUser', { username: 'ravi', name: 'Ravi', role: 'member', active: false }, admin);
    assert.equal((await api('login', { username: 'ravi', pin: '111222' })).ok, false);

    r = await api('saveClient', { name: 'New Client', gstin: '08abcde1234f1z5' }, admin);
    assert.equal(r.data.client.gstin, '08ABCDE1234F1Z5');
    r = await api('saveFirm', { name: 'Skyline Logistics', invoice_prefix: 'SKY/2026/', next_invoice_no: 1, theme_color: '#047857' }, admin);
    assert.equal(r.data.firm.id, 'skyline_logistics');
    r = await api('saveInvoice', { ...base, firm_id: 'skyline_logistics', invoice_no: 'SKY/2026/1' }, admin);
    assert.equal(r.data.firm.next_invoice_no, 2);

    for (let i = 0; i < 5; i++) await api('login', { username: 'admin', pin: 'bad' + i });
    assert.match((await api('login', { username: 'admin', pin: '482913' })).error, /Too many/);

    console.log('All backend checks passed.');
  } finally {
    srv.kill();
    fs.rmSync(DATA, { force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
