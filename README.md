# Central Invoicing & GST Record System
### Tailored for Craftographers & AS Enterprises

A lightweight, high-performance, and staff-friendly invoicing dashboard and database built to manage GST billing, record-keeping, WhatsApp sharing, Gmail dispatch, and Google Sheets synchronization.

---

## 🌟 Key Features

1. **Dual Firm Profile Switching:**
   - **Craftographers:**
     - GSTIN: `08GFFPS1076L1ZV`
     - Email: `info.craftographers@gmail.com`
     - Bank: HDFC Bank | A/C: `50200050618222` | IFSC: `HDFC0000142`
     - Brand Theme: Terracotta `#A0522D` with authentic logo
   - **AS Enterprises:**
     - GSTIN: `08TFCPS8191N1Z3`
     - Email: `gem.asenterprises94@gmail.com`
     - Bank: HDFC Bank | A/C: `50200106872092` | IFSC: `HDFC0000142`
     - Brand Theme: Midnight Charcoal `#111827` with classic laurel logo

2. **Automated GST Tax Engine:**
   - **Intra-State (within Rajasthan - 08):** Automatically calculates & bifurcates **CGST (9%) + SGST (9%)** (or custom split).
   - **Inter-State (outside Rajasthan):** Automatically applies **IGST (18%)**.
   - Dynamic Round-Off adjustment to nearest Rupee.
   - **Indian Currency in Words Engine:** Converts total into standard Indian notation (*e.g., "One Crore Six Lakh Thirty-Eight Thousand Six Hundred Rupees Only"* or *"Seven Lakh Ninety Nine Thousand One Hundred Thirty Six Rupees Only"*).

3. **100% Visual Replica of Invoice PDF:**
   - Formatted to match standard A4 paper with exact margins, headers, item table, and bank details.
   - 1-click "Print / Save PDF" using your Mac or browser print dialog (`Cmd + P`).

4. **1-Click WhatsApp Sharing:**
   - Instantly opens WhatsApp Web or the WhatsApp Desktop/Mobile app with a pre-formatted message addressed to the client with the invoice number, date, amount, and bank remittance details.

5. **Gmail Integration:**
   - Directly opens Gmail compose window pre-filled with the invoice subject, structured body, client address, and automatically cc'd to `info.craftographers@gmail.com`.

6. **Automatic Record Keeping & Google Sheets Sync:**
   - All invoices are saved automatically in a central SQLite database.
   - **CSV Export:** 1-click download of all billing records ready to import into Google Sheets.
   - **Real-Time Webhook:** Includes an optional 8-line Google Apps Script to auto-append rows to your live Google Sheet every time staff saves an invoice.

---

## 🚀 How to Run

Open your terminal and run:
```bash
cd /Users/abhisheksharma/.gemini/antigravity/scratch/central-invoicing-system
./start.sh
```
Or directly:
```bash
python3 server.py 8080
```
Then open [http://localhost:8080](http://localhost:8080) in your web browser.

---

## 📁 Project Structure

```
central-invoicing-system/
├── assets/
│   ├── craftographers_logo.png     # Craftographers brand logo
│   └── as_enterprises_logo.jpg     # AS Enterprises brand logo
├── database.py                     # SQLite database schema & pre-seeded samples
├── indian_currency_words.py        # Indian number-to-words converter (Lakhs/Crores)
├── server.py                       # HTTP server & REST APIs (Python standard library)
├── start.sh                        # 1-click launch script
├── static/
│   ├── app.js                      # Dynamic UI logic, calculations, WhatsApp/Gmail hooks
│   ├── index.html                  # Responsive staff-friendly dashboard & modal
│   └── style.css                   # Modern CSS & exact A4 print styles
└── invoicing.db                    # Persistent billing database
```
