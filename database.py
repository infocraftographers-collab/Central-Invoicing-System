import sqlite3
import json
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "invoicing.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS firms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        address TEXT NOT NULL,
        email TEXT NOT NULL,
        gstin TEXT NOT NULL,
        phone TEXT DEFAULT '',
        state TEXT NOT NULL,
        state_code TEXT NOT NULL,
        bank_name TEXT NOT NULL,
        account_name TEXT NOT NULL,
        account_no TEXT NOT NULL,
        ifsc_code TEXT NOT NULL,
        upi_id TEXT DEFAULT '',
        logo_url TEXT NOT NULL,
        theme_color TEXT NOT NULL,
        invoice_prefix TEXT DEFAULT '',
        next_invoice_no INTEGER DEFAULT 1
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        address TEXT DEFAULT '',
        gstin TEXT DEFAULT '',
        state TEXT DEFAULT '',
        state_code TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        email TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        firm_id TEXT NOT NULL,
        invoice_no TEXT NOT NULL,
        invoice_date TEXT NOT NULL,
        client_name TEXT NOT NULL,
        client_address TEXT DEFAULT '',
        client_gstin TEXT DEFAULT '',
        client_state TEXT DEFAULT '',
        client_state_code TEXT DEFAULT '',
        client_phone TEXT DEFAULT '',
        client_email TEXT DEFAULT '',
        ship_to TEXT DEFAULT '',
        sub_total_qty REAL DEFAULT 0,
        sub_total_unit_price REAL DEFAULT 0,
        sub_total_price REAL DEFAULT 0,
        cgst_rate REAL DEFAULT 0,
        cgst_amount REAL DEFAULT 0,
        sgst_rate REAL DEFAULT 0,
        sgst_amount REAL DEFAULT 0,
        igst_rate REAL DEFAULT 0,
        igst_amount REAL DEFAULT 0,
        round_off REAL DEFAULT 0,
        grand_total REAL DEFAULT 0,
        total_words TEXT DEFAULT '',
        status TEXT DEFAULT 'Issued',
        notes TEXT DEFAULT '',
        items_json TEXT DEFAULT '[]',
        synced_to_sheet INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(firm_id) REFERENCES firms(id)
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    );
    """)

    # Check if firms exist, if not seed default firms
    cursor.execute("SELECT COUNT(*) FROM firms")
    if cursor.fetchone()[0] == 0:
        cursor.execute("""
        INSERT INTO firms (id, name, address, email, gstin, phone, state, state_code, bank_name, account_name, account_no, ifsc_code, upi_id, logo_url, theme_color, invoice_prefix, next_invoice_no)
        VALUES 
        (
            'craftographers',
            'Craftographers',
            '66A/67A Adinath Nager, Pal Road, Jodhpur- 342008',
            'info.craftographers@gmail.com',
            '08GFFPS1076L1ZV',
            '',
            'Rajasthan',
            '08',
            'HDFC Bank',
            'Craftographers',
            '50200050618222',
            'HDFC0000142',
            '',
            '/assets/craftographers_logo.png',
            '#A0522D',
            'CRF-',
            12
        ),
        (
            'as_enterprises',
            'A S ENTERPRISES',
            '66A/67A Adinath Nager, Pal Road, Jodhpur- 342008',
            'gem.asenterprises94@gmail.com',
            '08TFCPS8191N1Z3',
            '',
            'Rajasthan',
            '08',
            'HDFC Bank',
            'AS Enterprises',
            '50200106872092',
            'HDFC0000142',
            '',
            '/assets/as_enterprises_logo.jpg',
            '#111827',
            'ASE-',
            21
        );
        """)

    # Seed initial client if empty
    cursor.execute("SELECT COUNT(*) FROM clients")
    if cursor.fetchone()[0] == 0:
        cursor.execute("""
        INSERT INTO clients (name, address, gstin, phone, email)
        VALUES ('The Commandant 224 ABOD C/O 56 APO', '224 ABOD C/O 56 APO', '', '', '')
        """)

    # Default settings
    cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('central_email', 'info.craftographers@gmail.com')")
    cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('sheets_webhook_url', '')")

    # Let's seed the 2 sample invoices from the user's PDF so they immediately have their real records in the system!
    cursor.execute("SELECT COUNT(*) FROM invoices")
    if cursor.fetchone()[0] == 0:
        # Sample 1: AS Enterprises Invoice 20
        items_as = [
            {"sno": 1, "item": "LV7/STLN-6240-72-0468907 PARKING LIGHT BULB 5W", "hsn": "8512", "qty": 253, "unit_price": 1452.54, "total_price": 367493.22},
            {"sno": 2, "item": "LV6/MT-36220-004440 FOG LIGHT 12V", "hsn": "8512", "qty": 581, "unit_price": 194.92, "total_price": 113245.76},
            {"sno": 3, "item": "LV7/MARUTI-31621M70F00 HOLDER ASSY RECTIFIER", "hsn": "8511", "qty": 60, "unit_price": 964.41, "total_price": 57864.40},
            {"sno": 4, "item": "LV7/TATA-312-411-1111 JOINT PIECE", "hsn": "8708", "qty": 21, "unit_price": 1122.88, "total_price": 23580.50},
            {"sno": 5, "item": "LV7/MARUTI-82202M82C30 LATCH ASSY DOOR LH", "hsn": "8301", "qty": 45, "unit_price": 508.47, "total_price": 22881.35},
            {"sno": 6, "item": "LV7/TATA-1108-411-2897 CENTRE BOLT M12X200 IS9484", "hsn": "7320", "qty": 98, "unit_price": 223.73, "total_price": 21925.42},
            {"sno": 7, "item": "LV7 MARUTI2940-001046OIL FILTER ASSY", "hsn": "8421", "qty": 215, "unit_price": 97.46, "total_price": 20953.38},
            {"sno": 8, "item": "LV7/HMV/8X8/AL-BOY30518 Door Lock", "hsn": "8708", "qty": 18, "unit_price": 940.67, "total_price": 16932.20},
            {"sno": 9, "item": "LV7/TATA-2641-7520-0112BASSY RELEASE CABLE COMP. CENTRE FLAP", "hsn": "8708", "qty": 53, "unit_price": 320.34, "total_price": 16977.96},
            {"sno": 10, "item": "LV7/TATA-2641-7270-0102 ASSY PADDING DOOR RH", "hsn": "8708", "qty": 26, "unit_price": 591.53, "total_price": 15379.66}
        ]
        cursor.execute("""
        INSERT INTO invoices (
            firm_id, invoice_no, invoice_date, client_name, client_address, client_gstin, ship_to,
            sub_total_qty, sub_total_unit_price, sub_total_price,
            cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount,
            round_off, grand_total, total_words, status, items_json
        ) VALUES (
            'as_enterprises', '20', '03/11/2026', 'The Commandant 224 ABOD C/O 56 APO', '', '', '',
            1370, 101893.54, 677233.85,
            9.0, 60951.05, 9.0, 60951.05, 0, 0,
            0.05, 799136.00, 'Seven lakh ninety nine thousand one hundred thirty six only.', 'Issued', ?
        )
        """, (json.dumps(items_as),))

        # Sample 2: Craftographers Invoice 11
        items_crf = [
            {"sno": 1, "item": "K9/BMP/NBC- 675-71-CB210 42140-000069 NBC FILTER 200M", "hsn": "8421", "qty": 75, "unit_price": 120210.16, "total_price": 9015762.72}
        ]
        cursor.execute("""
        INSERT INTO invoices (
            firm_id, invoice_no, invoice_date, client_name, client_address, client_gstin, ship_to,
            sub_total_qty, sub_total_unit_price, sub_total_price,
            cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount,
            round_off, grand_total, total_words, status, items_json
        ) VALUES (
            'craftographers', '11', '10/11/2026', 'The Commandant 224 ABOD C/O 56 APO', '', '', '',
            75, 120210.16, 9015762.72,
            9.0, 811418.64, 9.0, 811418.64, 0, 0,
            0.00, 10638600.00, 'One Crore Six Lakh Thirty-Eight Thousand Six Hundred Rupees.', 'Issued', ?
        )
        """, (json.dumps(items_crf),))

    conn.commit()
    conn.close()

if __name__ == "__main__":
    init_db()
    print("Database initialized successfully!")
