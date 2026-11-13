import os
import sys
import json
import sqlite3
import csv
import io
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from database import get_db, init_db
from indian_currency_words import number_to_indian_words

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
ASSETS_DIR = os.path.join(BASE_DIR, "assets")

class InvoicingRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS and disable aggressive caching for dev/local use
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def send_json(self, data, status=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def parse_json_body(self):
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length > 0:
            raw_body = self.rfile.read(content_length).decode('utf-8')
            return json.loads(raw_body)
        return {}

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # Static assets
        if path.startswith("/assets/"):
            filename = os.path.basename(path)
            filepath = os.path.join(ASSETS_DIR, filename)
            if os.path.exists(filepath):
                self.serve_file(filepath)
                return
            else:
                self.send_error(404, "Asset not found")
                return

        # Static frontend files
        if path == "/" or path == "/index.html":
            filepath = os.path.join(STATIC_DIR, "index.html")
            self.serve_file(filepath)
            return

        if path.startswith("/static/"):
            rel_path = path[len("/static/"):]
            filepath = os.path.join(STATIC_DIR, rel_path)
            if os.path.exists(filepath):
                self.serve_file(filepath)
                return
            else:
                self.send_error(404, "File not found")
                return

        # API Endpoints
        if path == "/api/firms":
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM firms")
            rows = [dict(row) for row in cursor.fetchall()]
            conn.close()
            self.send_json(rows)
            return

        if path.startswith("/api/firms/"):
            firm_id = path.split("/")[-1]
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM firms WHERE id = ?", (firm_id,))
            row = cursor.fetchone()
            conn.close()
            if row:
                self.send_json(dict(row))
            else:
                self.send_json({"error": "Firm not found"}, 404)
            return

        if path == "/api/clients":
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM clients ORDER BY name ASC")
            rows = [dict(row) for row in cursor.fetchall()]
            conn.close()
            self.send_json(rows)
            return

        if path == "/api/invoices":
            conn = get_db()
            cursor = conn.cursor()
            sql = "SELECT invoices.*, firms.name as firm_name, firms.theme_color FROM invoices JOIN firms ON invoices.firm_id = firms.id WHERE 1=1"
            params = []
            
            firm_filter = query.get("firm", [None])[0]
            if firm_filter and firm_filter != "all":
                sql += " AND invoices.firm_id = ?"
                params.append(firm_filter)

            search = query.get("search", [None])[0]
            if search:
                sql += " AND (invoices.invoice_no LIKE ? OR invoices.client_name LIKE ?)"
                params.append(f"%{search}%")
                params.append(f"%{search}%")

            sql += " ORDER BY invoices.id DESC"
            cursor.execute(sql, params)
            rows = []
            for row in cursor.fetchall():
                d = dict(row)
                try:
                    d["items"] = json.loads(d.get("items_json") or "[]")
                except:
                    d["items"] = []
                rows.append(d)
            conn.close()
            self.send_json(rows)
            return

        if path.startswith("/api/invoices/"):
            try:
                inv_id = int(path.split("/")[-1])
            except ValueError:
                self.send_json({"error": "Invalid invoice id"}, 400)
                return

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("""
            SELECT invoices.*, firms.name as firm_name, firms.address as firm_address, 
                   firms.email as firm_email, firms.gstin as firm_gstin, firms.state as firm_state,
                   firms.state_code as firm_state_code, firms.bank_name, firms.account_name, 
                   firms.account_no, firms.ifsc_code, firms.upi_id, firms.logo_url, firms.theme_color
            FROM invoices JOIN firms ON invoices.firm_id = firms.id
            WHERE invoices.id = ?
            """, (inv_id,))
            row = cursor.fetchone()
            conn.close()
            if row:
                d = dict(row)
                try:
                    d["items"] = json.loads(d.get("items_json") or "[]")
                except:
                    d["items"] = []
                self.send_json(d)
            else:
                self.send_json({"error": "Invoice not found"}, 404)
            return

        if path == "/api/settings":
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT key, value FROM settings")
            rows = {row["key"]: row["value"] for row in cursor.fetchall()}
            conn.close()
            self.send_json(rows)
            return

        if path == "/api/export/csv":
            # Export all invoices as CSV suitable for Google Sheets import
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("""
            SELECT invoices.id, firms.name as firm_name, invoices.invoice_no, invoices.invoice_date,
                   invoices.client_name, invoices.client_gstin, invoices.sub_total_price,
                   invoices.cgst_rate, invoices.cgst_amount, invoices.sgst_rate, invoices.sgst_amount,
                   invoices.igst_rate, invoices.igst_amount, invoices.round_off, invoices.grand_total,
                   invoices.status, invoices.created_at
            FROM invoices JOIN firms ON invoices.firm_id = firms.id
            ORDER BY invoices.id ASC
            """)
            rows = cursor.fetchall()
            conn.close()

            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow([
                "ID", "Firm", "Invoice No", "Date", "Client Name", "Client GSTIN",
                "Taxable Value (Sub Total)", "CGST %", "CGST Amount", "SGST %", "SGST Amount",
                "IGST %", "IGST Amount", "Round Off", "Grand Total (INR)", "Status", "Timestamp"
            ])
            for r in rows:
                writer.writerow([
                    r["id"], r["firm_name"], r["invoice_no"], r["invoice_date"],
                    r["client_name"], r["client_gstin"], r["sub_total_price"],
                    r["cgst_rate"], r["cgst_amount"], r["sgst_rate"], r["sgst_amount"],
                    r["igst_rate"], r["igst_amount"], r["round_off"], r["grand_total"],
                    r["status"], r["created_at"]
                ])

            csv_data = output.getvalue().encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/csv; charset=utf-8')
            self.send_header('Content-Disposition', 'attachment; filename="invoices_export.csv"')
            self.send_header('Content-Length', str(len(csv_data)))
            self.end_headers()
            self.wfile.write(csv_data)
            return

        self.send_error(404, "Endpoint not found")

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/amount_to_words":
            body = self.parse_json_body()
            amount = body.get("amount", 0)
            words = number_to_indian_words(amount)
            self.send_json({"words": words})
            return

        if path == "/api/firms":
            body = self.parse_json_body()
            name = body.get("name", "").strip()
            if not name:
                self.send_json({"error": "Firm name is required"}, 400)
                return

            firm_id = body.get("id", "").strip().lower()
            if not firm_id:
                import re, time
                slug = re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')
                firm_id = slug if slug else f"firm_{int(time.time())}"

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM firms WHERE id = ?", (firm_id,))
            if cursor.fetchone():
                import time
                firm_id = f"{firm_id}_{int(time.time()) % 1000}"

            logo_url = body.get("logo_url", "").strip()
            if not logo_url:
                logo_url = "/assets/craftographers_logo.png"

            theme_color = body.get("theme_color", "#1e3a8a")
            prefix = body.get("invoice_prefix", f"{name[:3].upper()}-")
            next_no = int(body.get("next_invoice_no", 1))

            cursor.execute("""
            INSERT INTO firms (
                id, name, address, email, gstin, phone, state, state_code,
                bank_name, account_name, account_no, ifsc_code, upi_id,
                logo_url, theme_color, invoice_prefix, next_invoice_no
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                firm_id, name,
                body.get("address", ""),
                body.get("email", ""),
                body.get("gstin", ""),
                body.get("phone", ""),
                body.get("state", "Rajasthan"),
                body.get("state_code", "08"),
                body.get("bank_name", "HDFC Bank"),
                body.get("account_name", body.get("account_name", name)),
                body.get("account_no", ""),
                body.get("ifsc_code", ""),
                body.get("upi_id", ""),
                logo_url,
                theme_color,
                prefix,
                next_no
            ))
            conn.commit()
            conn.close()
            self.send_json({"id": firm_id, "message": f"Firm {name} created successfully"})
            return

        if path == "/api/clients":
            body = self.parse_json_body()
            name = body.get("name", "").strip()
            if not name:
                self.send_json({"error": "Client name is required"}, 400)
                return
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("""
            INSERT INTO clients (name, address, gstin, state, state_code, phone, email)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                name,
                body.get("address", ""),
                body.get("gstin", ""),
                body.get("state", ""),
                body.get("state_code", ""),
                body.get("phone", ""),
                body.get("email", "")
            ))
            client_id = cursor.lastrowid
            conn.commit()
            conn.close()
            self.send_json({"id": client_id, "message": "Client created"})
            return

        if path == "/api/invoices":
            body = self.parse_json_body()
            firm_id = body.get("firm_id")
            invoice_no = str(body.get("invoice_no", "")).strip()
            invoice_date = body.get("invoice_date", "").strip()
            client_name = body.get("client_name", "").strip()

            if not firm_id or not invoice_no or not client_name:
                self.send_json({"error": "Firm, Invoice Number, and Client Name are required"}, 400)
                return

            items = body.get("items", [])
            items_json = json.dumps(items)

            grand_total = float(body.get("grand_total", 0))
            total_words = body.get("total_words", "")
            if not total_words:
                total_words = number_to_indian_words(grand_total)

            conn = get_db()
            cursor = conn.cursor()

            cursor.execute("""
            INSERT INTO invoices (
                firm_id, invoice_no, invoice_date, client_name, client_address, client_gstin,
                client_state, client_state_code, client_phone, client_email, ship_to,
                sub_total_qty, sub_total_unit_price, sub_total_price,
                cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount,
                round_off, grand_total, total_words, status, notes, items_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                firm_id, invoice_no, invoice_date, client_name,
                body.get("client_address", ""), body.get("client_gstin", ""),
                body.get("client_state", ""), body.get("client_state_code", ""),
                body.get("client_phone", ""), body.get("client_email", ""),
                body.get("ship_to", ""),
                float(body.get("sub_total_qty", 0)),
                float(body.get("sub_total_unit_price", 0)),
                float(body.get("sub_total_price", 0)),
                float(body.get("cgst_rate", 0)),
                float(body.get("cgst_amount", 0)),
                float(body.get("sgst_rate", 0)),
                float(body.get("sgst_amount", 0)),
                float(body.get("igst_rate", 0)),
                float(body.get("igst_amount", 0)),
                float(body.get("round_off", 0)),
                grand_total, total_words,
                body.get("status", "Issued"),
                body.get("notes", ""),
                items_json
            ))
            new_id = cursor.lastrowid

            # Save client to directory if not existing
            cursor.execute("SELECT id FROM clients WHERE name = ?", (client_name,))
            if not cursor.fetchone():
                cursor.execute("""
                INSERT INTO clients (name, address, gstin, phone, email)
                VALUES (?, ?, ?, ?, ?)
                """, (
                    client_name,
                    body.get("client_address", ""),
                    body.get("client_gstin", ""),
                    body.get("client_phone", ""),
                    body.get("client_email", "")
                ))

            # Increment firm's next_invoice_no if numerical
            try:
                numeric_val = int("".join(filter(str.isdigit, invoice_no)))
                cursor.execute("UPDATE firms SET next_invoice_no = MAX(next_invoice_no, ?) WHERE id = ?", (numeric_val + 1, firm_id))
            except:
                pass

            conn.commit()

            # Attempt automated webhook sync to Google Sheets if configured
            cursor.execute("SELECT value FROM settings WHERE key = 'sheets_webhook_url'")
            sheet_url_row = cursor.fetchone()
            sheet_synced = False
            if sheet_url_row and sheet_url_row["value"]:
                sheet_synced = self.push_to_google_sheet(sheet_url_row["value"], {
                    "id": new_id,
                    "firm_id": firm_id,
                    "invoice_no": invoice_no,
                    "invoice_date": invoice_date,
                    "client_name": client_name,
                    "client_gstin": body.get("client_gstin", ""),
                    "sub_total_price": float(body.get("sub_total_price", 0)),
                    "cgst_amount": float(body.get("cgst_amount", 0)),
                    "sgst_amount": float(body.get("sgst_amount", 0)),
                    "igst_amount": float(body.get("igst_amount", 0)),
                    "round_off": float(body.get("round_off", 0)),
                    "grand_total": grand_total,
                    "status": body.get("status", "Issued")
                })
                if sheet_synced:
                    cursor.execute("UPDATE invoices SET synced_to_sheet = 1 WHERE id = ?", (new_id,))
                    conn.commit()

            conn.close()
            self.send_json({
                "id": new_id,
                "message": "Invoice created successfully",
                "synced_to_sheet": sheet_synced
            })
            return

        if path == "/api/settings":
            body = self.parse_json_body()
            conn = get_db()
            cursor = conn.cursor()
            for k, v in body.items():
                cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (k, str(v)))
            conn.commit()
            conn.close()
            self.send_json({"message": "Settings updated"})
            return

        self.send_error(404, "Endpoint not found")

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/invoices/"):
            try:
                inv_id = int(path.split("/")[-1])
            except ValueError:
                self.send_json({"error": "Invalid invoice id"}, 400)
                return

            body = self.parse_json_body()
            items = body.get("items", [])
            items_json = json.dumps(items)
            grand_total = float(body.get("grand_total", 0))
            total_words = body.get("total_words", "")
            if not total_words:
                total_words = number_to_indian_words(grand_total)

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("""
            UPDATE invoices SET
                firm_id = ?, invoice_no = ?, invoice_date = ?, client_name = ?,
                client_address = ?, client_gstin = ?, client_state = ?, client_state_code = ?,
                client_phone = ?, client_email = ?, ship_to = ?,
                sub_total_qty = ?, sub_total_unit_price = ?, sub_total_price = ?,
                cgst_rate = ?, cgst_amount = ?, sgst_rate = ?, sgst_amount = ?,
                igst_rate = ?, igst_amount = ?, round_off = ?, grand_total = ?,
                total_words = ?, status = ?, notes = ?, items_json = ?
            WHERE id = ?
            """, (
                body.get("firm_id"), body.get("invoice_no"), body.get("invoice_date"),
                body.get("client_name"), body.get("client_address", ""), body.get("client_gstin", ""),
                body.get("client_state", ""), body.get("client_state_code", ""),
                body.get("client_phone", ""), body.get("client_email", ""),
                body.get("ship_to", ""),
                float(body.get("sub_total_qty", 0)),
                float(body.get("sub_total_unit_price", 0)),
                float(body.get("sub_total_price", 0)),
                float(body.get("cgst_rate", 0)),
                float(body.get("cgst_amount", 0)),
                float(body.get("sgst_rate", 0)),
                float(body.get("sgst_amount", 0)),
                float(body.get("igst_rate", 0)),
                float(body.get("igst_amount", 0)),
                float(body.get("round_off", 0)),
                grand_total, total_words,
                body.get("status", "Issued"),
                body.get("notes", ""),
                items_json,
                inv_id
            ))
            conn.commit()
            conn.close()
            self.send_json({"id": inv_id, "message": "Invoice updated successfully"})
            return

        if path.startswith("/api/firms/"):
            firm_id = path.split("/")[-1]
            body = self.parse_json_body()
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("""
            UPDATE firms SET
                name = COALESCE(?, name),
                address = COALESCE(?, address),
                email = COALESCE(?, email),
                gstin = COALESCE(?, gstin),
                phone = COALESCE(?, phone),
                bank_name = COALESCE(?, bank_name),
                account_name = COALESCE(?, account_name),
                account_no = COALESCE(?, account_no),
                ifsc_code = COALESCE(?, ifsc_code),
                upi_id = COALESCE(?, upi_id),
                invoice_prefix = COALESCE(?, invoice_prefix),
                next_invoice_no = COALESCE(?, next_invoice_no)
            WHERE id = ?
            """, (
                body.get("name"), body.get("address"), body.get("email"),
                body.get("gstin"), body.get("phone"), body.get("bank_name"),
                body.get("account_name"), body.get("account_no"), body.get("ifsc_code"),
                body.get("upi_id"), body.get("invoice_prefix"), body.get("next_invoice_no"),
                firm_id
            ))
            conn.commit()
            conn.close()
            self.send_json({"message": f"Firm {firm_id} updated successfully"})
            return

        self.send_error(404, "Endpoint not found")

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/firms/"):
            firm_id = path.split("/")[-1]
            if firm_id in ("craftographers", "as_enterprises"):
                self.send_json({"error": "Primary firm cannot be deleted"}, 400)
                return
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("DELETE FROM firms WHERE id = ?", (firm_id,))
            conn.commit()
            conn.close()
            self.send_json({"message": f"Firm {firm_id} deleted successfully"})
            return

        if path.startswith("/api/invoices/"):
            try:
                inv_id = int(path.split("/")[-1])
            except ValueError:
                self.send_json({"error": "Invalid invoice id"}, 400)
                return

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("DELETE FROM invoices WHERE id = ?", (inv_id,))
            conn.commit()
            conn.close()
            self.send_json({"message": f"Invoice {inv_id} deleted successfully"})
            return

        self.send_error(404, "Endpoint not found")

    def push_to_google_sheet(self, webhook_url, payload):
        """Optionally post invoice record to Google Sheets Apps Script Webhook"""
        try:
            req_data = json.dumps(payload).encode('utf-8')
            req = urllib.request.Request(
                webhook_url,
                data=req_data,
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=5) as response:
                return response.status in (200, 201)
        except Exception as e:
            print(f"Google Sheet webhook sync notice: {e}")
            return False

    def serve_file(self, filepath):
        ext = os.path.splitext(filepath)[1].lower()
        content_types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".svg": "image/svg+xml"
        }
        content_type = content_types.get(ext, "application/octet-stream")
        try:
            with open(filepath, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error(500, f"Error reading file: {e}")

def run_server(port=8080):
    init_db()
    server_address = ('', port)
    httpd = ThreadingHTTPServer(server_address, InvoicingRequestHandler)
    print(f"==================================================")
    print(f" Central Invoicing System started!")
    print(f" Dashboard URL: http://localhost:{port}")
    print(f" Press Ctrl+C to stop.")
    print(f"==================================================")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        httpd.server_close()

if __name__ == "__main__":
    port = 8080
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    run_server(port)
