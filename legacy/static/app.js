// Central Invoicing System Client-side Logic (Dynamic Multi-Firm & Executive Edition)

let state = {
  activeFirmId: 'craftographers',
  firms: {},
  clients: [],
  invoices: [],
  editingInvoiceId: null,
  currentTotals: {
    subTotalQty: 0,
    subTotalPrice: 0,
    cgstRate: 9,
    cgstAmount: 0,
    sgstRate: 9,
    sgstAmount: 0,
    igstRate: 18,
    igstAmount: 0,
    roundOff: 0,
    grandTotal: 0,
    totalWords: ''
  }
};

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  setDefaultDate();
  await loadFirms();
  await loadClients();
  await loadInvoicesList();
  await loadSettings();
  
  // Set default initial firm
  if (state.firms['craftographers']) {
    switchFirm('craftographers');
  } else {
    const firstFirmId = Object.keys(state.firms)[0];
    if (firstFirmId) switchFirm(firstFirmId);
  }
  
  // Add initial item row if empty
  if (document.querySelectorAll('.item-input-row').length === 0) {
    addNewItemRow();
  }
});

function setDefaultDate() {
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const yyyy = today.getFullYear();
  document.getElementById('inv-date-input').value = `${dd}/${mm}/${yyyy}`;
}

// ==========================================
// FIRMS & DYNAMIC MULTI-FIRM MANAGEMENT
// ==========================================
async function loadFirms() {
  try {
    const res = await fetch('/api/firms');
    const firmsList = await res.json();
    state.firms = {};
    firmsList.forEach(f => {
      state.firms[f.id] = f;
    });
    
    renderFirmSwitcher();
    populateFirmDropdowns();
    renderFirmsSettings();
  } catch (err) {
    console.error("Error loading firms:", err);
  }
}

function renderFirmSwitcher() {
  const container = document.getElementById('firm-switcher-container');
  if (!container) return;
  container.innerHTML = '';

  const firmList = Object.values(state.firms);
  firmList.forEach(firm => {
    const btn = document.createElement('button');
    const isActive = firm.id === state.activeFirmId;
    btn.className = `firm-btn ${isActive ? 'active' : ''} ${firm.id === 'craftographers' ? 'crafto' : (firm.id === 'as_enterprises' ? 'as' : '')}`;
    
    // Custom inline style for non-default firms
    if (isActive && firm.id !== 'craftographers' && firm.id !== 'as_enterprises') {
      btn.style.background = firm.theme_color || '#1e3a8a';
      btn.style.color = '#ffffff';
    }

    const logoSrc = firm.logo_url || '/assets/craftographers_logo.png';
    btn.innerHTML = `
      <img src="${logoSrc}" alt="${escapeHtml(firm.name)}" class="firm-logo-badge" onerror="this.src='/assets/craftographers_logo.png'">
      <span>${escapeHtml(firm.name)}</span>
    `;
    btn.onclick = () => switchFirm(firm.id);
    container.appendChild(btn);
  });

  // Quick "+ Add Firm" pill button
  const addBtn = document.createElement('button');
  addBtn.className = 'firm-btn';
  addBtn.style.color = 'var(--blue-600)';
  addBtn.style.fontWeight = '800';
  addBtn.innerHTML = `<span>➕ Add</span>`;
  addBtn.title = "Register a new firm";
  addBtn.onclick = () => {
    switchTab('settings-view');
    toggleNewFirmForm(true);
  };
  container.appendChild(addBtn);
}

function populateFirmDropdowns() {
  // 1. Editor select dropdown
  const invSelect = document.getElementById('inv-firm-select');
  if (invSelect) {
    const currentVal = invSelect.value;
    invSelect.innerHTML = '';
    Object.values(state.firms).forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.innerText = f.name;
      invSelect.appendChild(opt);
    });
    if (currentVal && state.firms[currentVal]) {
      invSelect.value = currentVal;
    } else {
      invSelect.value = state.activeFirmId;
    }
  }

  // 2. Records filter dropdown
  const recFilter = document.getElementById('records-firm-filter');
  if (recFilter) {
    const currentVal = recFilter.value;
    recFilter.innerHTML = '<option value="all">🏢 All Firms</option>';
    Object.values(state.firms).forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.innerText = f.name;
      recFilter.appendChild(opt);
    });
    if (currentVal) recFilter.value = currentVal;
  }
}

function switchFirm(firmId) {
  state.activeFirmId = firmId;
  const firm = state.firms[firmId];
  if (!firm) return;

  // Re-render switcher active states
  renderFirmSwitcher();

  // Update Select Dropdown
  const invSelect = document.getElementById('inv-firm-select');
  if (invSelect) invSelect.value = firmId;

  // Update Banner Info & Styling Mode
  const banner = document.getElementById('firm-banner-card');
  if (firmId === 'craftographers') {
    banner.className = 'firm-banner crafto-mode';
  } else if (firmId === 'as_enterprises') {
    banner.className = 'firm-banner as-mode';
  } else {
    banner.className = 'firm-banner';
    banner.style.borderLeft = `5px solid ${firm.theme_color || '#1e3a8a'}`;
  }

  document.getElementById('active-firm-logo').src = firm.logo_url || '/assets/craftographers_logo.png';
  document.getElementById('active-firm-name').innerText = firm.name;
  document.getElementById('active-firm-address').innerText = firm.address;
  document.getElementById('active-firm-gstin').innerText = `GSTIN: ${firm.gstin || 'Unregistered'}`;
  document.getElementById('active-firm-bank').innerText = `${firm.bank_name || 'Bank'} A/C: ${firm.account_no || '-'} (IFSC: ${firm.ifsc_code || '-'})`;
  document.getElementById('active-firm-email').innerText = firm.email || '-';

  // Update Save Button Styling
  const saveBtn = document.getElementById('btn-save-invoice');
  if (firmId === 'craftographers') {
    saveBtn.className = 'btn btn-crafto';
    saveBtn.style.background = '';
  } else if (firmId === 'as_enterprises') {
    saveBtn.className = 'btn btn-primary';
    saveBtn.style.background = '';
  } else {
    saveBtn.className = 'btn btn-primary';
    saveBtn.style.background = firm.theme_color || '#1e3a8a';
  }

  // Auto-fill next invoice number with firm prefix if not editing an existing invoice
  if (!state.editingInvoiceId) {
    const prefix = firm.invoice_prefix !== undefined ? firm.invoice_prefix : '';
    const nextNo = firm.next_invoice_no !== undefined ? firm.next_invoice_no : '';
    document.getElementById('inv-number-input').value = `${prefix}${nextNo}`;
  }

  showToast(`Switched active firm to ${firm.name}`, '🏢');
}

function onFirmSelectChanged(firmId) {
  switchFirm(firmId);
}

// ==========================================
// TABS NAVIGATION
// ==========================================
function switchTab(tabId) {
  document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
  document.querySelectorAll('.tab-link').forEach(btn => btn.classList.remove('active'));

  const targetSec = document.getElementById(tabId);
  if (targetSec) targetSec.classList.add('active');

  const tabBtns = document.querySelectorAll('.tab-link');
  if (tabId === 'editor-view') tabBtns[0].classList.add('active');
  if (tabId === 'records-view') {
    tabBtns[1].classList.add('active');
    loadInvoicesList();
  }
  if (tabId === 'clients-view') {
    tabBtns[2].classList.add('active');
    renderClientsTable();
  }
  if (tabId === 'settings-view') {
    tabBtns[3].classList.add('active');
    renderFirmsSettings();
  }
}

// ==========================================
// CLIENT DIRECTORY & AUTOCOMPLETE
// ==========================================
async function loadClients() {
  try {
    const res = await fetch('/api/clients');
    state.clients = await res.json();
    populateClientPresetDropdown();
  } catch (err) {
    console.error("Error loading clients:", err);
  }
}

function populateClientPresetDropdown() {
  const sel = document.getElementById('inv-client-preset');
  sel.innerHTML = '<option value="">-- Choose saved client or enter below --</option>';
  state.clients.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.innerText = c.name + (c.gstin ? ` (${c.gstin})` : '');
    sel.appendChild(opt);
  });
}

function onSelectExistingClient(clientId) {
  if (!clientId) return;
  const client = state.clients.find(c => c.id == clientId);
  if (!client) return;

  document.getElementById('inv-client-name').value = client.name || '';
  document.getElementById('inv-client-gstin').value = client.gstin || '';
  document.getElementById('inv-client-phone').value = client.phone || '';
  document.getElementById('inv-client-email').value = client.email || '';
  if (client.address) {
    document.getElementById('inv-ship-to').value = client.address;
  }
  showToast(`Loaded details for ${client.name}`, '👤');
}

// ==========================================
// GST TAX BIFURCATION LOGIC
// ==========================================
function onTaxTypeChanged(mode) {
  const rowCgst = document.getElementById('row-cgst');
  const rowSgst = document.getElementById('row-sgst');
  const rowIgst = document.getElementById('row-igst');

  if (mode === 'intra') {
    rowCgst.style.display = '';
    rowSgst.style.display = '';
    rowIgst.style.display = 'none';
  } else {
    rowCgst.style.display = 'none';
    rowSgst.style.display = 'none';
    rowIgst.style.display = '';
  }
  recalculateTotals();
}

// ==========================================
// LINE ITEMS TABLE MANAGEMENT
// ==========================================
function addNewItemRow(data = {}) {
  const tbody = document.getElementById('editor-items-tbody');
  const rowCount = tbody.querySelectorAll('tr').length + 1;

  const tr = document.createElement('tr');
  tr.className = 'item-input-row';
  tr.innerHTML = `
    <td class="text-center row-sno" style="font-weight: 700; color: var(--blue-900);">${rowCount}</td>
    <td>
      <input type="text" class="item-name" placeholder="Description of goods or service" value="${escapeHtml(data.item || '')}" required>
    </td>
    <td>
      <input type="text" class="item-hsn" placeholder="e.g. 8512" value="${escapeHtml(data.hsn || '')}">
    </td>
    <td>
      <input type="number" class="item-qty" placeholder="1" step="any" min="0" value="${data.qty !== undefined ? data.qty : 1}" oninput="onItemRowInput(this)">
    </td>
    <td>
      <input type="number" class="item-rate" placeholder="0.00" step="any" min="0" value="${data.unit_price !== undefined ? data.unit_price : ''}" oninput="onItemRowInput(this)">
    </td>
    <td>
      <input type="number" class="item-total" placeholder="0.00" readonly style="background: var(--blue-50); font-weight: 700; color: var(--blue-950);" value="${data.total_price !== undefined ? Number(data.total_price).toFixed(2) : ''}">
    </td>
    <td class="text-center">
      <button type="button" class="btn-icon-delete" title="Remove Item" onclick="deleteItemRow(this)">✕</button>
    </td>
  `;

  tbody.appendChild(tr);
  recalculateTotals();
}

function deleteItemRow(btn) {
  const tbody = document.getElementById('editor-items-tbody');
  if (tbody.querySelectorAll('tr').length <= 1) {
    showToast("Invoice must contain at least one item row", "⚠️");
    return;
  }
  const tr = btn.closest('tr');
  tr.remove();
  
  // Re-index S.NO
  tbody.querySelectorAll('.row-sno').forEach((td, idx) => {
    td.innerText = idx + 1;
  });
  recalculateTotals();
}

function onItemRowInput(input) {
  const row = input.closest('tr');
  const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
  const rate = parseFloat(row.querySelector('.item-rate').value) || 0;
  const total = qty * rate;
  row.querySelector('.item-total').value = total > 0 ? total.toFixed(2) : '';
  recalculateTotals();
}

// ==========================================
// REAL-TIME TOTALS & AMOUNT IN WORDS
// ==========================================
let wordsDebounceTimer = null;

function recalculateTotals() {
  const rows = document.querySelectorAll('#editor-items-tbody tr');
  let subTotalQty = 0;
  let subTotalPrice = 0;

  rows.forEach(r => {
    const qty = parseFloat(r.querySelector('.item-qty').value) || 0;
    const total = parseFloat(r.querySelector('.item-total').value) || 0;
    subTotalQty += qty;
    subTotalPrice += total;
  });

  const taxMode = document.getElementById('inv-tax-type').value;
  let cgstAmount = 0;
  let sgstAmount = 0;
  let igstAmount = 0;

  let cgstRate = 0;
  let sgstRate = 0;
  let igstRate = 0;

  if (taxMode === 'intra') {
    cgstRate = parseFloat(document.getElementById('tax-cgst-rate').value) || 0;
    sgstRate = parseFloat(document.getElementById('tax-sgst-rate').value) || 0;
    cgstAmount = (subTotalPrice * cgstRate) / 100;
    sgstAmount = (subTotalPrice * sgstRate) / 100;
  } else {
    igstRate = parseFloat(document.getElementById('tax-igst-rate').value) || 0;
    igstAmount = (subTotalPrice * igstRate) / 100;
  }

  const rawTotal = subTotalPrice + cgstAmount + sgstAmount + igstAmount;
  const roundedGrandTotal = Math.round(rawTotal);
  const roundOff = roundedGrandTotal - rawTotal;

  // Update UI values
  document.getElementById('calc-subtotal').innerText = `₹ ${subTotalPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('calc-cgst').innerText = `₹ ${cgstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('calc-sgst').innerText = `₹ ${sgstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('calc-igst').innerText = `₹ ${igstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  
  if (!state.manualRoundOff) {
    document.getElementById('tax-roundoff').value = roundOff.toFixed(2);
  }
  const currentRoundOff = parseFloat(document.getElementById('tax-roundoff').value) || 0;
  const finalGrandTotal = rawTotal + currentRoundOff;

  document.getElementById('calc-grandtotal').innerText = `₹ ${finalGrandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  state.currentTotals = {
    subTotalQty,
    subTotalPrice,
    cgstRate,
    cgstAmount,
    sgstRate,
    sgstAmount,
    igstRate,
    igstAmount,
    roundOff: currentRoundOff,
    grandTotal: finalGrandTotal
  };

  // Debounced fetch for Indian words
  clearTimeout(wordsDebounceTimer);
  wordsDebounceTimer = setTimeout(() => {
    fetchAmountInWords(finalGrandTotal);
  }, 250);
}

function onRoundOffManualChange() {
  state.manualRoundOff = true;
  recalculateTotals();
  setTimeout(() => { state.manualRoundOff = false; }, 3000);
}

async function fetchAmountInWords(amount) {
  try {
    const res = await fetch('/api/amount_to_words', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amount })
    });
    const data = await res.json();
    const words = data.words || 'Zero Rupees Only';
    state.currentTotals.totalWords = words;
    document.getElementById('words-preview-text').innerText = words;
  } catch (err) {
    console.error("Error fetching amount in words:", err);
  }
}

// ==========================================
// SAVE INVOICE TO DATABASE & RECORDS
// ==========================================
async function saveCurrentInvoice() {
  const firmId = state.activeFirmId;
  const invNo = document.getElementById('inv-number-input').value.trim();
  const invDate = document.getElementById('inv-date-input').value.trim();
  const clientName = document.getElementById('inv-client-name').value.trim();

  if (!invNo) {
    showToast("Please enter an invoice number", "⚠️");
    document.getElementById('inv-number-input').focus();
    return;
  }

  if (!invDate) {
    showToast("Please enter invoice date", "⚠️");
    document.getElementById('inv-date-input').focus();
    return;
  }

  if (!clientName) {
    showToast("Please enter client name", "⚠️");
    document.getElementById('inv-client-name').focus();
    return;
  }

  // Gather items
  const items = [];
  const rows = document.querySelectorAll('#editor-items-tbody tr');
  rows.forEach((r, idx) => {
    const item = r.querySelector('.item-name').value.trim();
    const hsn = r.querySelector('.item-hsn').value.trim();
    const qty = parseFloat(r.querySelector('.item-qty').value) || 0;
    const unit_price = parseFloat(r.querySelector('.item-rate').value) || 0;
    const total_price = parseFloat(r.querySelector('.item-total').value) || 0;
    if (item) {
      items.push({
        sno: idx + 1,
        item,
        hsn,
        qty,
        unit_price,
        total_price
      });
    }
  });

  if (items.length === 0) {
    showToast("Please add at least one line item with description", "⚠️");
    return;
  }

  const payload = {
    firm_id: firmId,
    invoice_no: invNo,
    invoice_date: invDate,
    client_name: clientName,
    client_address: document.getElementById('inv-ship-to').value.trim() || clientName,
    client_gstin: document.getElementById('inv-client-gstin').value.trim(),
    client_phone: document.getElementById('inv-client-phone').value.trim(),
    client_email: document.getElementById('inv-client-email').value.trim(),
    ship_to: document.getElementById('inv-ship-to').value.trim(),
    notes: document.getElementById('inv-notes').value.trim(),
    items: items,
    sub_total_qty: state.currentTotals.subTotalQty,
    sub_total_unit_price: 0,
    sub_total_price: state.currentTotals.subTotalPrice,
    cgst_rate: state.currentTotals.cgstRate,
    cgst_amount: state.currentTotals.cgstAmount,
    sgst_rate: state.currentTotals.sgstRate,
    sgst_amount: state.currentTotals.sgstAmount,
    igst_rate: state.currentTotals.igstRate,
    igst_amount: state.currentTotals.igstAmount,
    round_off: state.currentTotals.roundOff,
    grand_total: state.currentTotals.grandTotal,
    total_words: state.currentTotals.totalWords,
    status: 'Issued'
  };

  try {
    let url = '/api/invoices';
    let method = 'POST';

    if (state.editingInvoiceId) {
      url = `/api/invoices/${state.editingInvoiceId}`;
      method = 'PUT';
    }

    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || "Failed to save invoice", "❌");
      return;
    }

    showToast(`Invoice #${invNo} saved successfully!`, "✅");

    // Refresh client list & firm counter
    await loadClients();
    await loadFirms();

    // Reset editing state
    state.editingInvoiceId = null;

    // Show prompt for WhatsApp or Print
    if (confirm(`Invoice #${invNo} saved to records!\n\nWould you like to open the Print / PDF preview now?`)) {
      previewAndPrintCurrentInvoice();
    }
  } catch (err) {
    console.error("Save error:", err);
    showToast("Error saving invoice to database", "❌");
  }
}

function resetEditorForm() {
  state.editingInvoiceId = null;
  setDefaultDate();
  document.getElementById('inv-client-preset').value = '';
  document.getElementById('inv-client-name').value = '';
  document.getElementById('inv-client-gstin').value = '';
  document.getElementById('inv-client-phone').value = '';
  document.getElementById('inv-client-email').value = '';
  document.getElementById('inv-ship-to').value = '';
  document.getElementById('inv-notes').value = '';

  const tbody = document.getElementById('editor-items-tbody');
  tbody.innerHTML = '';
  addNewItemRow();

  const firm = state.firms[state.activeFirmId];
  if (firm) {
    const prefix = firm.invoice_prefix !== undefined ? firm.invoice_prefix : '';
    const nextNo = firm.next_invoice_no !== undefined ? firm.next_invoice_no : '';
    document.getElementById('inv-number-input').value = `${prefix}${nextNo}`;
  }

  recalculateTotals();
  showToast("Invoice form reset", "🔄");
}

// ==========================================================================
// 🌟 EXECUTIVE CORPORATE A4 INVOICE RENDERING ENGINE
// ==========================================================================
function previewAndPrintCurrentInvoice() {
  const firm = state.firms[state.activeFirmId];
  if (!firm) return;

  const invNo = document.getElementById('inv-number-input').value.trim() || 'DRAFT';
  const invDate = document.getElementById('inv-date-input').value.trim();
  const clientName = document.getElementById('inv-client-name').value.trim() || 'Client / Buyer';
  const clientGstin = document.getElementById('inv-client-gstin').value.trim();
  const shipTo = document.getElementById('inv-ship-to').value.trim();
  const notes = document.getElementById('inv-notes').value.trim();

  const items = [];
  const rows = document.querySelectorAll('#editor-items-tbody tr');
  rows.forEach((r, idx) => {
    const item = r.querySelector('.item-name').value.trim();
    const hsn = r.querySelector('.item-hsn').value.trim();
    const qty = parseFloat(r.querySelector('.item-qty').value) || 0;
    const rate = parseFloat(r.querySelector('.item-rate').value) || 0;
    const total = parseFloat(r.querySelector('.item-total').value) || 0;
    if (item || total > 0) {
      items.push({
        sno: idx + 1,
        item,
        hsn,
        qty,
        unit_price: rate,
        total_price: total
      });
    }
  });

  const currentInv = {
    firm_id: state.activeFirmId,
    invoice_no: invNo,
    invoice_date: invDate,
    client_name: clientName,
    client_address: shipTo || clientName,
    client_gstin: clientGstin,
    ship_to: shipTo,
    notes: notes,
    items: items,
    sub_total_qty: state.currentTotals.subTotalQty,
    sub_total_price: state.currentTotals.subTotalPrice,
    cgst_rate: state.currentTotals.cgstRate,
    cgst_amount: state.currentTotals.cgstAmount,
    sgst_rate: state.currentTotals.sgstRate,
    sgst_amount: state.currentTotals.sgstAmount,
    igst_rate: state.currentTotals.igstRate,
    igst_amount: state.currentTotals.igstAmount,
    round_off: state.currentTotals.roundOff,
    grand_total: state.currentTotals.grandTotal,
    total_words: state.currentTotals.totalWords
  };

  populatePrintModalWithData(currentInv);
  document.getElementById('print-modal').classList.add('active');
}

function populatePrintModalWithData(inv) {
  const firm = state.firms[inv.firm_id] || inv;

  // IMPORTANT: Set browser document title according to firm and bill number
  // This automatically dictates the suggested PDF download filename!
  const sanitizedFirmName = (firm.name || 'Firm').replace(/[^a-zA-Z0-9_-]/g, '_');
  const sanitizedInvNo = (inv.invoice_no || 'Bill').replace(/[^a-zA-Z0-9_-]/g, '_');
  document.title = `${sanitizedFirmName}_Invoice_${sanitizedInvNo}`;

  // Update modal header bar
  const modalBillTitle = document.getElementById('modal-bill-title');
  if (modalBillTitle) {
    modalBillTitle.innerText = `${firm.name} - Bill No. ${inv.invoice_no}`;
  }

  // 1. Color Grade Application
  const sheet = document.getElementById('printable-invoice');
  if (inv.firm_id === 'craftographers') {
    sheet.className = 'invoice-sheet inv-grade-crafto';
  } else if (inv.firm_id === 'as_enterprises') {
    sheet.className = 'invoice-sheet inv-grade-as';
  } else {
    sheet.className = 'invoice-sheet inv-grade-as';
    if (firm.theme_color) {
      sheet.style.setProperty('--grade-primary', firm.theme_color);
      sheet.style.setProperty('--grade-primary-dark', firm.theme_color);
    }
  }

  // 2. Header & Supplier Details (Enlarged prominent logo)
  document.getElementById('print-logo').src = firm.logo_url || '/assets/craftographers_logo.png';
  document.getElementById('print-firm-name').innerText = firm.name;
  document.getElementById('print-firm-address').innerText = firm.address;
  document.getElementById('print-firm-email').innerText = firm.email;
  document.getElementById('print-firm-gstin').innerText = firm.gstin || '-';

  // 3. Invoice Meta Block (Reverse Charge & Place of Supply REMOVED)
  document.getElementById('print-inv-no').innerText = inv.invoice_no;
  document.getElementById('print-inv-date').innerText = inv.invoice_date;

  // 4. Buyer & Ship-To Cards
  document.getElementById('print-client-name').innerText = inv.client_name;
  document.getElementById('print-client-address').innerText = inv.client_address || inv.ship_to || 'Jodhpur, Rajasthan';
  
  if (inv.client_gstin && inv.client_gstin.trim() !== '') {
    document.getElementById('print-client-gstin').innerText = inv.client_gstin.toUpperCase();
  } else {
    document.getElementById('print-client-gstin').innerText = 'UNREGISTERED / GOVT DEPOT';
  }

  if (inv.ship_to && inv.ship_to.trim() !== '') {
    document.getElementById('print-ship-name').innerText = 'Consignee Address';
    document.getElementById('print-ship-to').innerText = inv.ship_to;
  } else {
    document.getElementById('print-ship-name').innerText = 'Same as Billed To';
    document.getElementById('print-ship-to').innerText = inv.client_address || 'Delivery per work order terms';
  }

  document.getElementById('print-inv-notes').innerText = inv.notes || 'As per Purchase Order / Contract';

  // 5. Line Items Table
  const tbody = document.getElementById('print-items-tbody');
  tbody.innerHTML = '';
  const items = inv.items || [];
  let totalQty = 0;
  let totalRateSum = 0;
  let subTotal = 0;

  items.forEach((it, idx) => {
    const q = Number(it.qty) || 0;
    const r = Number(it.unit_price) || 0;
    const t = Number(it.total_price) || (q * r);

    totalQty += q;
    totalRateSum += r;
    subTotal += t;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="text-center" style="font-weight: 700;">${idx + 1}</td>
      <td style="font-weight: 600; padding-left: 10px;">${escapeHtml(it.item)}</td>
      <td class="text-center" style="color: #475569; font-weight: 600;">${escapeHtml(it.hsn || '-')}</td>
      <td class="text-center" style="font-weight: 700;">${q}</td>
      <td class="text-right" style="font-family: monospace; font-size: 10px;">${r > 0 ? r.toFixed(2) : '-'}</td>
      <td class="text-right" style="font-weight: 700; padding-right: 10px; font-family: monospace; font-size: 10.5px;">${t.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('print-total-qty').innerText = totalQty;
  document.getElementById('print-total-unitprice').innerText = totalRateSum > 0 ? totalRateSum.toFixed(2) : '';
  document.getElementById('print-subtotal-val').innerText = subTotal.toFixed(2);

  // 6. Tax Summary Table (Right Card)
  document.getElementById('print-taxable-val').innerText = `₹ ${Number(inv.sub_total_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  const isIntra = Number(inv.cgst_amount) > 0 || Number(inv.sgst_amount) > 0 || (Number(inv.igst_amount) === 0);
  if (isIntra) {
    document.getElementById('print-row-cgst').style.display = '';
    document.getElementById('print-row-sgst').style.display = '';
    document.getElementById('print-row-igst').style.display = 'none';

    document.getElementById('print-cgst-rate').innerText = `${Number(inv.cgst_rate || 9).toFixed(2)}%`;
    document.getElementById('print-cgst-val').innerText = `₹ ${Number(inv.cgst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

    document.getElementById('print-sgst-rate').innerText = `${Number(inv.sgst_rate || 9).toFixed(2)}%`;
    document.getElementById('print-sgst-val').innerText = `₹ ${Number(inv.sgst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  } else {
    document.getElementById('print-row-cgst').style.display = 'none';
    document.getElementById('print-row-sgst').style.display = 'none';
    document.getElementById('print-row-igst').style.display = '';

    document.getElementById('print-igst-rate').innerText = `${Number(inv.igst_rate || 18).toFixed(2)}%`;
    document.getElementById('print-igst-val').innerText = `₹ ${Number(inv.igst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  }

  document.getElementById('print-roundoff-val').innerText = `₹ ${Number(inv.round_off || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  document.getElementById('print-grandtotal-val').innerText = `₹ ${Math.round(Number(inv.grand_total)).toLocaleString('en-IN')}`;

  // 7. Remittance & Bank Card (Left Card)
  document.getElementById('print-bank-name').innerText = firm.bank_name || 'Bank';
  document.getElementById('print-bank-accname').innerText = firm.account_name || firm.name;
  document.getElementById('print-bank-accno').innerText = firm.account_no || '-';
  document.getElementById('print-bank-ifsc').innerText = firm.ifsc_code || '-';

  // 8. Amount in Words
  document.getElementById('print-amount-words').innerText = inv.total_words || 'Zero Rupees Only.';

  // 9. Signatory
  document.getElementById('print-sign-firm').innerText = firm.name;
}

function closePrintModal() {
  document.getElementById('print-modal').classList.remove('active');
  document.title = "Central Invoicing System | GST Record Keeping & Billing";
}

function triggerBrowserPrint() {
  window.print();
}

// ==========================================
// 1-CLICK WHATSAPP SHARING
// ==========================================
function shareOnWhatsAppCurrent() {
  const firm = state.firms[state.activeFirmId];
  const invNo = document.getElementById('inv-number-input').value.trim() || '';
  const invDate = document.getElementById('inv-date-input').value.trim() || '';
  const clientName = document.getElementById('inv-client-name').value.trim() || 'Sir/Madam';
  let phone = document.getElementById('inv-client-phone').value.trim();
  const grandTotal = state.currentTotals.grandTotal;

  if (!phone) {
    phone = prompt("Enter Client WhatsApp Mobile Number (e.g. 9829012345):", "");
    if (!phone) return;
  }

  // Clean phone number: remove spaces, dashes, +
  let cleanPhone = phone.replace(/[^0-9]/g, '');
  if (cleanPhone.length === 10) {
    cleanPhone = '91' + cleanPhone;
  }

  const message = 
`*TAX INVOICE - ${firm.name.toUpperCase()}*

Dear ${clientName},
Please find the invoice details below:

📄 *Bill No:* ${invNo}
📅 *Date:* ${invDate}
💰 *Total Amount:* ₹${grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}

🏦 *Payment / Bank Details:*
• *Bank:* ${firm.bank_name || 'HDFC Bank'}
• *A/C Name:* ${firm.account_name || firm.name}
• *A/C No:* ${firm.account_no}
• *IFSC Code:* ${firm.ifsc_code}

${firm.email ? `✉️ Email: ${firm.email}\n` : ''}Thank you for your business!`;

  const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
  window.open(waUrl, '_blank');
  showToast("Opening WhatsApp Web / App...", "💬");
}

// ==========================================
// 1-CLICK GMAIL SENDING
// ==========================================
function shareViaGmailCurrent() {
  const firm = state.firms[state.activeFirmId];
  const invNo = document.getElementById('inv-number-input').value.trim() || '';
  const invDate = document.getElementById('inv-date-input').value.trim() || '';
  const clientName = document.getElementById('inv-client-name').value.trim() || 'Sir/Madam';
  const clientEmail = document.getElementById('inv-client-email').value.trim();
  const grandTotal = state.currentTotals.grandTotal;

  const subject = `Tax Invoice #${invNo} from ${firm.name}`;
  const ccEmail = firm.email || "info.craftographers@gmail.com";

  const body = 
`Dear ${clientName},

Greetings from ${firm.name}!

Please find the billing details for Tax Invoice #${invNo} dated ${invDate}.

SUMMARY:
------------------------------------------
Bill No: ${invNo}
Invoice Date: ${invDate}
Billed To: ${clientName}
Total Taxable Value: ₹${state.currentTotals.subTotalPrice.toFixed(2)}
GST Tax Amount: ₹${(state.currentTotals.cgstAmount + state.currentTotals.sgstAmount + state.currentTotals.igstAmount).toFixed(2)}
Grand Total: ₹${grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
Amount in Words: ${state.currentTotals.totalWords}

BANK ACCOUNT DETAILS FOR REMITTANCE:
------------------------------------------
Bank Name: ${firm.bank_name || 'HDFC Bank'}
Account Name: ${firm.account_name || firm.name}
Account No: ${firm.account_no}
IFSC Code: ${firm.ifsc_code}

Please remit the payment at your earliest convenience and confirm once completed.

Warm regards,
Accounts Team
${firm.name}
GSTIN: ${firm.gstin || '-'}
Email: ${firm.email}`;

  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(clientEmail)}&cc=${encodeURIComponent(ccEmail)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.open(gmailUrl, '_blank');
  showToast("Opening Gmail draft...", "✉️");
}

// ==========================================
// BILLING RECORDS & HISTORY
// ==========================================
async function loadInvoicesList() {
  const firmFilter = document.getElementById('records-firm-filter').value;
  try {
    let url = '/api/invoices';
    if (firmFilter && firmFilter !== 'all') {
      url += `?firm=${firmFilter}`;
    }
    const res = await fetch(url);
    state.invoices = await res.json();
    renderInvoicesTable(state.invoices);
    updateDashboardStats(state.invoices);
  } catch (err) {
    console.error("Error loading invoices:", err);
  }
}

function filterInvoicesLocally() {
  const query = document.getElementById('records-search-input').value.toLowerCase().trim();
  if (!query) {
    renderInvoicesTable(state.invoices);
    return;
  }
  const filtered = state.invoices.filter(inv => {
    return (inv.invoice_no && inv.invoice_no.toLowerCase().includes(query)) ||
           (inv.client_name && inv.client_name.toLowerCase().includes(query));
  });
  renderInvoicesTable(filtered);
}

function renderInvoicesTable(invoices) {
  const tbody = document.getElementById('invoices-table-tbody');
  tbody.innerHTML = '';

  if (invoices.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; padding: 2.5rem; color: #64748b; font-weight: 500;">No invoices found. Click "Create Invoice" to start!</td></tr>`;
    return;
  }

  invoices.forEach(inv => {
    const firm = state.firms[inv.firm_id];
    const firmName = firm ? firm.name : (inv.firm_name || inv.firm_id);
    const firmBadge = `<span class="badge" style="background: var(--blue-50); color: var(--blue-900); border: 1.5px solid var(--blue-200); font-weight: 700;">${escapeHtml(firmName)}</span>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight: 800; color: var(--blue-950);">#${escapeHtml(inv.invoice_no)}</td>
      <td>${firmBadge}</td>
      <td style="white-space: nowrap; font-weight: 600;">${escapeHtml(inv.invoice_date)}</td>
      <td style="font-weight: 600; color: #0f172a;">${escapeHtml(inv.client_name)}</td>
      <td style="text-align: right; font-family: monospace;">₹${Number(inv.sub_total_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
      <td style="text-align: right; font-family: monospace;">₹${Number(inv.cgst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
      <td style="text-align: right; font-family: monospace;">₹${Number(inv.sgst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
      <td style="text-align: right; font-family: monospace;">₹${Number(inv.igst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
      <td style="text-align: right; font-weight: 800; color: var(--blue-950); font-family: monospace; font-size: 0.95rem;">₹${Number(inv.grand_total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
      <td><span class="status-badge status-issued">${escapeHtml(inv.status || 'Issued')}</span></td>
      <td style="text-align: center; white-space: nowrap;">
        <button class="btn btn-secondary" style="padding: 5px 9px; font-size: 0.82rem;" title="Print / PDF" onclick="openInvoicePrintById(${inv.id})">🖨️</button>
        <button class="btn btn-whatsapp" style="padding: 5px 9px; font-size: 0.82rem;" title="WhatsApp" onclick="openWhatsAppForInvoiceById(${inv.id})">💬</button>
        <button class="btn btn-gmail" style="padding: 5px 9px; font-size: 0.82rem;" title="Gmail" onclick="openGmailForInvoiceById(${inv.id})">✉️</button>
        <button class="btn btn-secondary" style="padding: 5px 9px; font-size: 0.82rem;" title="Edit" onclick="editInvoiceById(${inv.id})">✏️</button>
        <button class="btn-icon-delete" style="display: inline-flex; vertical-align: middle; width: 28px; height: 28px;" title="Delete" onclick="deleteInvoiceById(${inv.id})">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function updateDashboardStats(invoices) {
  let totalRev = 0;
  let totalCgstSgst = 0;
  let totalIgst = 0;

  invoices.forEach(inv => {
    totalRev += Number(inv.grand_total) || 0;
    totalCgstSgst += (Number(inv.cgst_amount) || 0) + (Number(inv.sgst_amount) || 0);
    totalIgst += Number(inv.igst_amount) || 0;
  });

  document.getElementById('stat-total-invoices').innerText = invoices.length;
  document.getElementById('stat-total-revenue').innerText = `₹ ${totalRev.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  document.getElementById('stat-total-cgst-sgst').innerText = `₹ ${totalCgstSgst.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  document.getElementById('stat-total-igst').innerText = `₹ ${totalIgst.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

async function openInvoicePrintById(id) {
  try {
    const res = await fetch(`/api/invoices/${id}`);
    const inv = await res.json();
    populatePrintModalWithData(inv);
    document.getElementById('print-modal').classList.add('active');
  } catch (err) {
    showToast("Error loading invoice for print", "❌");
  }
}

async function editInvoiceById(id) {
  try {
    const res = await fetch(`/api/invoices/${id}`);
    const inv = await res.json();
    state.editingInvoiceId = inv.id;

    switchFirm(inv.firm_id);
    document.getElementById('inv-number-input').value = inv.invoice_no;
    document.getElementById('inv-date-input').value = inv.invoice_date;
    document.getElementById('inv-client-name').value = inv.client_name;
    document.getElementById('inv-client-gstin').value = inv.client_gstin || '';
    document.getElementById('inv-client-phone').value = inv.client_phone || '';
    document.getElementById('inv-client-email').value = inv.client_email || '';
    document.getElementById('inv-ship-to').value = inv.ship_to || '';
    document.getElementById('inv-notes').value = inv.notes || '';

    // Populate items
    const tbody = document.getElementById('editor-items-tbody');
    tbody.innerHTML = '';
    (inv.items || []).forEach(it => {
      addNewItemRow(it);
    });

    // Populate taxes
    if (inv.igst_amount > 0) {
      document.getElementById('inv-tax-type').value = 'inter';
      onTaxTypeChanged('inter');
      document.getElementById('tax-igst-rate').value = inv.igst_rate;
    } else {
      document.getElementById('inv-tax-type').value = 'intra';
      onTaxTypeChanged('intra');
      document.getElementById('tax-cgst-rate').value = inv.cgst_rate;
      document.getElementById('tax-sgst-rate').value = inv.sgst_rate;
    }

    document.getElementById('tax-roundoff').value = inv.round_off || 0;
    recalculateTotals();

    switchTab('editor-view');
    showToast(`Loaded Invoice #${inv.invoice_no} for editing`, "✏️");
  } catch (err) {
    showToast("Error loading invoice for edit", "❌");
  }
}

async function deleteInvoiceById(id) {
  if (!confirm(`Are you sure you want to permanently delete this invoice record?`)) return;

  try {
    const res = await fetch(`/api/invoices/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast("Invoice deleted", "🗑️");
      await loadInvoicesList();
    }
  } catch (err) {
    showToast("Error deleting invoice", "❌");
  }
}

async function openWhatsAppForInvoiceById(id) {
  try {
    const res = await fetch(`/api/invoices/${id}`);
    const inv = await res.json();
    const firm = state.firms[inv.firm_id] || inv;

    let phone = inv.client_phone;
    if (!phone) {
      phone = prompt(`Enter Client WhatsApp Mobile Number for #${inv.invoice_no}:`, "");
      if (!phone) return;
    }

    let cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

    const message = 
`*TAX INVOICE - ${firm.name.toUpperCase()}*

Dear ${inv.client_name},
Please find the invoice details below:

📄 *Bill No:* ${inv.invoice_no}
📅 *Date:* ${inv.invoice_date}
💰 *Total Amount:* ₹${Number(inv.grand_total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}

🏦 *Payment / Bank Details:*
• *Bank:* ${firm.bank_name || 'HDFC Bank'}
• *A/C Name:* ${firm.account_name || firm.name}
• *A/C No:* ${firm.account_no}
• *IFSC Code:* ${firm.ifsc_code}

${firm.email ? `✉️ Email: ${firm.email}\n` : ''}Thank you for your business!`;

    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank');
  } catch (err) {
    showToast("Error loading invoice for WhatsApp", "❌");
  }
}

async function openGmailForInvoiceById(id) {
  try {
    const res = await fetch(`/api/invoices/${id}`);
    const inv = await res.json();
    const firm = state.firms[inv.firm_id] || inv;

    const subject = `Tax Invoice #${inv.invoice_no} from ${firm.name}`;
    const body = 
`Dear ${inv.client_name},

Please find the billing details for Tax Invoice #${inv.invoice_no} dated ${inv.invoice_date}.

Total Amount: ₹${Number(inv.grand_total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
Amount in Words: ${inv.total_words}

Bank Details:
Bank: ${firm.bank_name || 'HDFC Bank'}
A/C Name: ${firm.account_name || firm.name}
A/C No: ${firm.account_no}
IFSC: ${firm.ifsc_code}

Thank you,
${firm.name}`;

    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(inv.client_email || '')}&cc=${encodeURIComponent(firm.email || "info.craftographers@gmail.com")}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(gmailUrl, '_blank');
  } catch (err) {
    showToast("Error loading invoice for Gmail", "❌");
  }
}

// ==========================================
// CLIENTS TAB
// ==========================================
function renderClientsTable() {
  const tbody = document.getElementById('clients-table-tbody');
  tbody.innerHTML = '';
  if (state.clients.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 2.5rem; font-weight: 500;">No clients recorded yet.</td></tr>`;
    return;
  }
  state.clients.forEach(c => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight: 700; color: #0f172a;">${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.address || '-')}</td>
      <td><span class="badge badge-gst">${escapeHtml(c.gstin || 'Unregistered')}</span></td>
      <td>${escapeHtml(c.phone || '-')}</td>
      <td>${escapeHtml(c.email || '-')}</td>
      <td style="text-align: center;">
        <button class="btn btn-secondary" style="padding: 5px 10px; font-size: 0.82rem;" onclick="createInvoiceForClient('${escapeHtml(c.name)}', '${escapeHtml(c.gstin || '')}', '${escapeHtml(c.phone || '')}', '${escapeHtml(c.email || '')}')">Create Invoice</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function createInvoiceForClient(name, gstin, phone, email) {
  resetEditorForm();
  document.getElementById('inv-client-name').value = name;
  document.getElementById('inv-client-gstin').value = gstin;
  document.getElementById('inv-client-phone').value = phone;
  document.getElementById('inv-client-email').value = email;
  switchTab('editor-view');
}

function showAddClientPrompt() {
  const name = prompt("Enter Client Name:");
  if (!name) return;
  const gstin = prompt("Enter Client GSTIN (optional):") || "";
  const phone = prompt("Enter Client Phone / WhatsApp (optional):") || "";
  const email = prompt("Enter Client Email (optional):") || "";

  fetch('/api/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, gstin, phone, email })
  }).then(async () => {
    showToast("Client added to directory", "👥");
    await loadClients();
    renderClientsTable();
  });
}

// ==========================================
// FIRMS SETTINGS & ADD NEW FIRM
// ==========================================
function toggleNewFirmForm(forceShow = null) {
  const card = document.getElementById('new-firm-card');
  if (forceShow === true) {
    card.style.display = 'block';
  } else if (forceShow === false) {
    card.style.display = 'none';
  } else {
    card.style.display = card.style.display === 'none' ? 'block' : 'none';
  }
}

function showAddFirmModal() {
  switchTab('settings-view');
  toggleNewFirmForm(true);
}

async function createNewFirm() {
  const name = document.getElementById('new-firm-name').value.trim();
  const address = document.getElementById('new-firm-address').value.trim();
  const prefix = document.getElementById('new-firm-prefix').value.trim() || `${name.substring(0, 3).toUpperCase()}-`;
  const nextNo = parseInt(document.getElementById('new-firm-nextno').value) || 1;
  const gstin = document.getElementById('new-firm-gstin').value.trim();
  const email = document.getElementById('new-firm-email').value.trim();
  const phone = document.getElementById('new-firm-phone').value.trim();
  const bank = document.getElementById('new-firm-bank').value.trim();
  const accName = document.getElementById('new-firm-accname').value.trim();
  const accNo = document.getElementById('new-firm-accno').value.trim();
  const ifsc = document.getElementById('new-firm-ifsc').value.trim();
  const color = document.getElementById('new-firm-color').value;
  const logo = document.getElementById('new-firm-logo').value.trim() || '/assets/craftographers_logo.png';

  if (!name) {
    showToast("Please enter Firm Name", "⚠️");
    document.getElementById('new-firm-name').focus();
    return;
  }

  if (!address) {
    showToast("Please enter Registered Address", "⚠️");
    document.getElementById('new-firm-address').focus();
    return;
  }

  try {
    const res = await fetch('/api/firms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        address,
        invoice_prefix: prefix,
        next_invoice_no: nextNo,
        gstin,
        email,
        phone,
        bank_name: bank,
        account_name: accName || name,
        account_no: accNo,
        ifsc_code: ifsc,
        theme_color: color,
        logo_url: logo
      })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || "Failed to create firm", "❌");
      return;
    }

    showToast(`Firm "${name}" registered successfully!`, "🎉");
    toggleNewFirmForm(false);
    
    // Clear inputs
    document.getElementById('new-firm-name').value = '';
    document.getElementById('new-firm-address').value = '';
    document.getElementById('new-firm-gstin').value = '';
    document.getElementById('new-firm-email').value = '';
    document.getElementById('new-firm-phone').value = '';
    document.getElementById('new-firm-prefix').value = '';
    document.getElementById('new-firm-bank').value = '';
    document.getElementById('new-firm-accname').value = '';
    document.getElementById('new-firm-accno').value = '';
    document.getElementById('new-firm-ifsc').value = '';

    await loadFirms();
    if (data.id) switchFirm(data.id);
  } catch (err) {
    console.error("Create firm error:", err);
    showToast("Error creating firm", "❌");
  }
}

function renderFirmsSettings() {
  const container = document.getElementById('firms-cards-container');
  if (!container) return;
  container.innerHTML = '';

  const firmsList = Object.values(state.firms);

  firmsList.forEach(firm => {
    const isCrafto = firm.id === 'craftographers';
    const isAS = firm.id === 'as_enterprises';
    const isPrimary = isCrafto || isAS;

    const card = document.createElement('div');
    card.style.background = isCrafto ? '#fffdfa' : '#f8fafc';
    card.style.padding = '1.5rem';
    card.style.borderRadius = 'var(--radius-md)';
    card.style.border = `2px solid ${isCrafto ? '#fed7aa' : (isAS ? '#cbd5e1' : firm.theme_color || '#bfdbfe')}`;
    card.style.boxShadow = 'var(--shadow-sm)';

    const deleteBtnHtml = !isPrimary ? `
      <button type="button" class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.75rem; color: #dc2626;" onclick="deleteCustomFirm('${firm.id}')">
        🗑️ Delete Firm
      </button>
    ` : '';

    card.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 0.5rem;">
        <h3 style="color: ${firm.theme_color || '#1e3a8a'}; font-weight: 900; font-size: 1.15rem;">${escapeHtml(firm.name)}</h3>
        <div style="display: flex; gap: 6px; align-items: center;">
          <span class="badge" style="background: var(--blue-50); color: var(--blue-900); font-weight: 700;">ID: ${escapeHtml(firm.id)}</span>
          ${deleteBtnHtml}
        </div>
      </div>

      <div class="form-group">
        <label>Firm Display Name</label>
        <input type="text" id="firm-name-${firm.id}" class="form-input" value="${escapeHtml(firm.name || '')}">
      </div>

      <div class="form-group">
        <label>Registered Address</label>
        <textarea id="firm-address-${firm.id}" class="form-textarea" rows="2">${escapeHtml(firm.address || '')}</textarea>
      </div>

      <div class="form-grid-2">
        <div class="form-group">
          <label>GSTIN</label>
          <input type="text" id="firm-gstin-${firm.id}" class="form-input" value="${escapeHtml(firm.gstin || '')}">
        </div>
        <div class="form-group">
          <label>Billing Gmail / Email</label>
          <input type="email" id="firm-email-${firm.id}" class="form-input" value="${escapeHtml(firm.email || '')}">
        </div>
      </div>

      <div class="form-grid-2">
        <div class="form-group">
          <label>Phone / WhatsApp</label>
          <input type="text" id="firm-phone-${firm.id}" class="form-input" value="${escapeHtml(firm.phone || '')}" placeholder="e.g. 9829012345">
        </div>
        <div class="form-group">
          <label>Bill Number Prefix</label>
          <input type="text" id="firm-prefix-${firm.id}" class="form-input" value="${escapeHtml(firm.invoice_prefix || '')}" placeholder="e.g. CRF- or ASE-">
        </div>
      </div>

      <div class="form-group">
        <label>Next Bill Counter Number</label>
        <input type="number" id="firm-nextno-${firm.id}" class="form-input" value="${firm.next_invoice_no || 1}">
      </div>

      <div style="background: #ffffff; padding: 1rem; border-radius: 6px; border: 1px solid #e2e8f0; margin: 1rem 0;">
        <h4 style="font-size: 0.88rem; font-weight: 700; color: #1e3a8a; margin-bottom: 0.5rem;">🏦 Bank Details for Invoices</h4>
        <div class="form-grid-2">
          <div class="form-group">
            <label>Bank Name</label>
            <input type="text" id="firm-bank-${firm.id}" class="form-input" value="${escapeHtml(firm.bank_name || 'HDFC Bank')}">
          </div>
          <div class="form-group">
            <label>Account Holder Name</label>
            <input type="text" id="firm-accname-${firm.id}" class="form-input" value="${escapeHtml(firm.account_name || firm.name)}">
          </div>
        </div>
        <div class="form-grid-2">
          <div class="form-group">
            <label>Bank Account Number</label>
            <input type="text" id="firm-accno-${firm.id}" class="form-input" value="${escapeHtml(firm.account_no || '')}">
          </div>
          <div class="form-group">
            <label>IFSC Code</label>
            <input type="text" id="firm-ifsc-${firm.id}" class="form-input" value="${escapeHtml(firm.ifsc_code || '')}">
          </div>
        </div>
      </div>

      <button class="btn btn-primary" style="width: 100%; justify-content: center; background: ${firm.theme_color || '#1e3a8a'};" onclick="saveFirmProfile('${firm.id}')">
        💾 Save ${escapeHtml(firm.name)} Details
      </button>
    `;

    container.appendChild(card);
  });
}

async function deleteCustomFirm(firmId) {
  if (!confirm(`Are you sure you want to delete this firm? Existing invoices will remain recorded.`)) return;

  try {
    const res = await fetch(`/api/firms/${firmId}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || "Firm deleted", "🗑️");
      await loadFirms();
      switchFirm('craftographers');
    } else {
      showToast(data.error || "Cannot delete firm", "❌");
    }
  } catch (err) {
    showToast("Error deleting firm", "❌");
  }
}

async function saveFirmProfile(firmId) {
  const name = document.getElementById(`firm-name-${firmId}`).value.trim();
  const address = document.getElementById(`firm-address-${firmId}`).value.trim();
  const gstin = document.getElementById(`firm-gstin-${firmId}`).value.trim();
  const email = document.getElementById(`firm-email-${firmId}`).value.trim();
  const phone = document.getElementById(`firm-phone-${firmId}`).value.trim();
  const prefix = document.getElementById(`firm-prefix-${firmId}`).value.trim();
  const nextNo = parseInt(document.getElementById(`firm-nextno-${firmId}`).value) || 1;
  const bankName = document.getElementById(`firm-bank-${firmId}`).value.trim();
  const accName = document.getElementById(`firm-accname-${firmId}`).value.trim();
  const accNo = document.getElementById(`firm-accno-${firmId}`).value.trim();
  const ifsc = document.getElementById(`firm-ifsc-${firmId}`).value.trim();

  try {
    const res = await fetch(`/api/firms/${firmId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        address,
        gstin,
        email,
        phone,
        bank_name: bankName,
        account_name: accName,
        account_no: accNo,
        ifsc_code: ifsc,
        invoice_prefix: prefix,
        next_invoice_no: nextNo
      })
    });

    if (res.ok) {
      showToast(`Updated details for ${name || firmId}`, "🏦");
      await loadFirms();
      switchFirm(state.activeFirmId);
    } else {
      showToast("Failed to save firm profile", "❌");
    }
  } catch (err) {
    showToast("Error updating firm details", "❌");
  }
}

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const settings = await res.json();
    if (settings.sheets_webhook_url) {
      document.getElementById('setting-sheets-webhook').value = settings.sheets_webhook_url;
    }
  } catch (err) {
    console.error("Error loading settings:", err);
  }
}

async function saveSettings() {
  const webhook = document.getElementById('setting-sheets-webhook').value.trim();
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheets_webhook_url: webhook })
    });
    showToast("Google Sheets Webhook setting saved!", "📊");
  } catch (err) {
    showToast("Failed to save settings", "❌");
  }
}

// ==========================================
// TOAST NOTIFICATION HELPER
// ==========================================
function showToast(message, icon = 'ℹ️') {
  const toast = document.getElementById('app-toast');
  document.getElementById('toast-icon').innerText = icon;
  document.getElementById('toast-text').innerText = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3200);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
