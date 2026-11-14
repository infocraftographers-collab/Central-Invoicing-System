# Central Invoicing

GST tax invoices for Craftographers and A S Enterprises. Team members sign in, create invoices in the browser, and every invoice is recorded in a Google Sheet. Invoices print on a single A4 page.

To put it online, follow [DEPLOY.md](DEPLOY.md).

## What is where

| Path | What it is |
| --- | --- |
| `web/` | The website. Plain HTML, CSS and JavaScript, no build step. Upload this folder to any static host. |
| `web/config.js` | The one setting: your Apps Script web app URL. |
| `web/sheet.js`, `web/sheet.css` | The A4 invoice: layout, totals, amount in words, fit-to-one-page. Shared by preview and print. |
| `apps-script/Code.gs` | The backend. Paste into the Google Sheet's Apps Script editor. Handles logins, invoice numbering, totals and all writes to the Sheet. |
| `dev/server.js` | Local preview. Runs the real `Code.gs` against an imitation Sheet. |
| `dev/test-backend.js` | Backend checks: `node dev/test-backend.js` |
| `legacy/` | The earlier Python + SQLite version. Not used any more; safe to delete. |

## How the pieces talk

```
Browser (web/)  --POST JSON-->  Apps Script web app (Code.gs)  -->  Google Sheet tabs
                                                                    Invoices, Invoice Items,
                                                                    Firms, Clients, Users
```

- Totals are always recomputed by the script; the browser's numbers are only a preview.
- PINs are stored salted and hashed. Five wrong attempts lock a username for 15 minutes.
- Sessions last 7 days and end immediately when a PIN changes or a member is disabled.
