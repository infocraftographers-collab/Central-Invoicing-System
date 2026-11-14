# Putting Central Invoicing online

About 10 minutes. You need a Google account (the one that should own the invoice records) and a free Netlify account.

How it fits together: the website (the `web` folder) is hosted on Netlify. Every save goes to a small script inside your Google Sheet, which writes the invoice as a row. The Sheet is the only database.

## 1. Create the Google Sheet and its script

1. Go to [sheets.new](https://sheets.new) and name the sheet, e.g. "Central Invoicing Records".
2. In the sheet menu choose **Extensions > Apps Script**.
3. Delete the sample code, then paste in everything from `apps-script/Code.gs`. Click the save icon.
4. In the function dropdown at the top pick **setup**, then click **Run**.
   Google asks for permission the first time: choose your account, then **Advanced > Go to project > Allow**.
5. Open **Execution log** at the bottom. It shows the first login:
   username `admin` and an 8-digit PIN. **Write the PIN down.**

The sheet now has five tabs: Invoices, Invoice Items, Firms, Clients, Users. Both firms are already filled in, with the next invoice numbers set to CRF-12 and ASE-21.

## 2. Publish the script

1. In the Apps Script editor click **Deploy > New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Set **Execute as: Me** and **Who has access: Anyone**. Click **Deploy**.
4. Copy the **Web app URL**. It ends in `/exec`.

"Anyone" only means the address is reachable. Nothing can be read or written without a valid username and PIN.

## 3. Connect the website

Open `web/config.js` and paste the URL between the quotes:

```js
window.INVOICE_API_URL = 'https://script.google.com/macros/s/XXXXXXXX/exec';
```

## 4. Put the website online

1. Sign in at [app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag the whole `web` folder onto the page.
3. Netlify gives you a link such as `https://something.netlify.app`. Rename it under **Site configuration > Change site name** if you like.

Any static host works the same way (Vercel, Cloudflare Pages, GitHub Pages): upload the contents of `web`.

## 5. Add your team

1. Open the link and sign in as `admin` with the PIN from step 1.
2. Top-right menu > **Change PIN**.
3. **Team > Add team member** for each person. Give them the link, their username and PIN.

Members can create invoices, edit their own, and mark invoices paid. Only admins can cancel invoices, edit firm and bank details, and manage the team.

## Day-to-day notes

- **Records**: admins get an "Open the Google Sheet" link in the top-right menu. You can sort, filter and chart in the Sheet freely, but do not delete or reorder columns, and leave the "Items (app data)" and PIN columns alone.
- **Invoice numbers** are checked by the Sheet, so two people can never save the same number for one firm.
- **Cancelled invoices** stay in the Sheet marked Cancelled. Nothing is ever deleted by the app.
- **Printing**: use "Print / Save as PDF". In the print dialog keep paper size A4 and scale 100% ("Default"). The invoice always fits one page.
- **Lost admin PIN**: in the Apps Script editor run `resetAdminPin`; the new PIN is in the Execution log.
- **Changing the script later**: paste the new `Code.gs`, then **Deploy > Manage deployments > edit (pencil) > Version: New version > Deploy**. The URL stays the same.

## Try it on this computer first (optional)

```bash
DEV_ADMIN_PIN=482913 node dev/server.js
```

Then open http://localhost:8080 and sign in as `admin` with that PIN. This preview stores data in `dev/.data.json`, not in Google.
