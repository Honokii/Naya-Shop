# Naya Shop Kiosk

A custom artist-shop and convention self-checkout web app built for Naya Torinko. The project combines a lightweight storefront, admin inventory tools, PIXEL/Epaygames checkout, Google Sheets order logging, and direct NIIMBOT Bluetooth receipt printing.

## Current project status

The project is functional as a kiosk and hosted storefront, but the catalogue/admin data is still stored locally in each browser using IndexedDB. Orders can be sent to a shared Google Sheet. A future shared database layer such as Supabase is the next major upgrade for syncing products, inventory, logo, categories, and settings across devices.

## Features

### Storefront

- Responsive customer-facing product grid
- Pink/yellow background with minimal floating header
- Adjustable transparent shop logo with subtle bob animation
- Optional shop name and description
- Clickable product categories
- Two-line product titles
- Product image hover zoom
- Cart with quantity controls
- PHP pricing

### Admin

- Add products with image, name, price, category, and inventory quantity
- Edit existing product name, price, category, stock, and image
- Delete products
- Create/delete categories
- Inventory and sold-count tracking
- Editable shop logo, title, description, and logo size
- QR payment-image upload
- Order history stored locally
- Test/reset tools

### Checkout

Every order currently asks for the same buyer information:

- Full name
- Email
- Phone number
- Full address

Supported payment methods:

- Cash
- QR payment
- PIXEL / Epaygames

Every checkout receives an order reference in the format:

```text
SHOP-12345678
```

The same order reference is included in the PIXEL payment message and the seller order log so payments can be matched to orders.

### PIXEL payment flow

The storefront calls the Cloudflare Worker endpoint:

```text
POST /create
```

The Worker requests a PIXEL/Epaygames payment session using:

- PIXEL creator: `nayatorinko`
- Supporter name: `Shop Order`
- Supporter message: order number + cart contents
- Amount: current checkout total

PIXEL returns an Epaygames checkout link, which is opened for the customer.

The current PIXEL success/failure handling uses the return URLs supplied when the payment link is generated:

```text
?pixel_status=success&pixel_order=...
?pixel_status=failed&pixel_order=...
```

On a success return, the local kiosk finalizes the order, clears the cart, deducts local inventory, and shows the receipt.

> **Important:** This redirect is not equivalent to server-side payment verification. A production public shop should verify a payment using an official webhook/status API before treating an order as paid.

### Google Sheets seller log

Completed orders are sent to the same Cloudflare Worker at:

```text
POST /order
```

The Worker forwards sanitized order data to a Google Apps Script Web App. The Apps Script writes the order to an `Orders` sheet and ignores duplicate order numbers.

Current spreadsheet columns:

1. Order Number
2. Order Date
3. Payment Method
4. PIXEL Reference
5. Total (PHP)
6. Full Name
7. Email
8. Phone
9. Address
10. Items
11. Units
12. Internal Order ID
13. Receipt Number
14. Status

If the sheet endpoint is temporarily unavailable, the storefront queues the order log locally and retries later.

### NIIMBOT receipt printing

The storefront integrates NIIMBlueLib for Web Bluetooth communication with compatible NIIMBOT printers.

Current flow:

1. Admin connects to the NIIMBOT printer from the browser.
2. A completed order is rendered to a receipt canvas.
3. The canvas is encoded and sent directly to the printer.
4. System/browser printing is also available as a fallback.

The kiosk has been tested around 45 × 60 mm thermal sticker-paper usage. Gap-label mode should be used for individual sticker labels rather than continuous-paper mode.

## Project architecture

```text
Customer / Admin browser
        |
        |  static website
        v
Cloudflare: naya-shop
        |
        | POST /create     POST /order
        v
Cloudflare Worker: naya-pixel-checkout
        |                         |
        |                         +--> Google Apps Script --> Google Sheet
        |
        +--> PIXEL donate flow --> Epaygames payment page

Browser --> Web Bluetooth --> NIIMBOT printer
```

## Folder structure

```text
naya-shop/
├── index.html
├── shop.html
├── niimbluelib.min.js
├── cloudflare/
│   └── naya-pixel-checkout-worker.js
├── google-apps-script/
│   └── order-webhook.gs
└── README.md
```

`index.html` and `shop.html` are the same storefront source in this package. `index.html` is the version intended for deployment at the root URL.

### NIIMBlue library file

The bundled `niimbluelib.min.js` in this package is currently a small loader that fetches the pinned NIIMBlueLib build from the CDN. The storefront therefore needs internet access when that library has not already been cached. To make the kiosk completely offline, replace that loader with the actual UMD build using the same filename.

## Cloudflare storefront deployment

Upload the deploy files so `index.html` is directly in the static asset root:

```text
index.html
niimbluelib.min.js
```

Current storefront URL used by the code:

```text
https://naya-shop.nayatorinkoch.workers.dev/
```

The storefront currently expects its PIXEL/order bridge at:

```text
https://naya-pixel-checkout.nayatorinkoch.workers.dev
```

If either URL changes, update the corresponding constants in the code.

## Cloudflare PIXEL/order Worker setup

Deploy:

```text
cloudflare/naya-pixel-checkout-worker.js
```

The Worker exposes:

```text
POST /create
POST /order
```

Add these Worker Variables/Secrets:

```text
ORDER_SHEET_WEBHOOK_URL
ORDER_SHEET_SECRET
```

`ORDER_SHEET_WEBHOOK_URL` must be the Google Apps Script deployment URL ending in `/exec`.

`ORDER_SHEET_SECRET` should be stored as a Cloudflare secret and must exactly match `ORDER_SECRET` in the Apps Script.

## Google Sheets setup

Create a Google Sheet, then open:

```text
Extensions > Apps Script
```

Paste:

```text
google-apps-script/order-webhook.gs
```

Update:

```javascript
const SPREADSHEET_ID = "YOUR_SPREADSHEET_ID";
const ORDER_SECRET = "THE_SAME_SECRET_USED_IN_CLOUDFLARE";
```

Deploy it as a Web App. After changing the script later, deploy a **new version** of the existing Web App deployment.

The script creates an `Orders` tab automatically if it does not exist.

The `Status` column uses a dropdown with these options:

```text
New
Processing
Ready
Completed
Cancelled
```

After deploying a new Apps Script version, select `setupOrdersSheet` in the
Apps Script editor and click **Run** once to apply the dropdown to the existing
sheet immediately. New order submissions also apply and maintain the dropdown
automatically.

## Local development

The site can be served locally instead of opening `file://` directly.

Example:

```bash
python -m http.server 8080 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:8080/
```

The Worker currently permits both `127.0.0.1:8080` and `localhost:8080` as development origins.

## Storage model

### Shared online now

- Completed-order spreadsheet log
- PIXEL payment-link creation

### Still local to each browser

- Products
- Product images
- Categories
- Shop logo
- Shop name/description
- Inventory counts
- Local order history
- QR image
- Printer settings

This means adding a product on one computer does **not** yet make that product appear automatically on another computer.

## Recommended next upgrade: shared database

Move the browser-local catalogue/settings to a backend database such as Supabase:

```text
Supabase database
├── products
├── categories
├── shop_settings
├── inventory
└── orders

Supabase Storage
├── product-images
├── shop-logo
└── payment-assets
```

That would make the same products, stock, settings, and images appear on every device and would let Admin changes update the public shop without redeploying HTML.

It would also make it possible to validate the server-side price of each cart before creating a PIXEL payment, rather than trusting a total supplied by browser JavaScript.

## Security / production notes

1. **Do not put private/service-role keys into `index.html`.** Browser code is public.
2. Keep `ORDER_SHEET_SECRET` in Cloudflare Worker secrets.
3. The current product catalogue and cart totals are client-side, so they are not authoritative for a public ecommerce site.
4. The PIXEL `/v1/donate` flow used here was derived from the current PIXEL website behavior. Treat it as integration code that may require maintenance if PIXEL changes its flow.
5. The current success redirect is useful for kiosk UX but is not cryptographic proof of payment.
6. Review the terms/licensing of third-party services and NIIMBlueLib before relying on them commercially.

## Main configuration points

### `index.html`

Search for:

```javascript
PIXEL_BRIDGE_URL
```

### Cloudflare Worker

Update if the storefront domain changes:

```javascript
ALLOWED_ORIGINS
SHOP_URL
```

PIXEL creator username is currently:

```javascript
username: "nayatorinko"
```

### Google Apps Script

Configure:

```javascript
SPREADSHEET_ID
SHEET_NAME
ORDER_SECRET
```

## Current project goal

The project is intended to work as both:

- an artist-alley / convention self-checkout kiosk with direct receipt printing; and
- the foundation for a shareable online artist shop.

The current build is strongest as a kiosk. Shared catalogue data and authoritative payment verification are the two major pieces still needed before treating it as a full multi-device ecommerce backend.
