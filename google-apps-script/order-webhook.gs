// Naya Shop order logger for Google Sheets
//
// SETUP
// 1. Replace SPREADSHEET_ID with the ID from the Google Sheet URL.
// 2. Replace ORDER_SECRET with the same value as Cloudflare's ORDER_SHEET_SECRET.
// 3. Deploy as a Web App, execute as yourself, with access allowed to anyone.
// 4. After edits: Deploy > Manage deployments > Edit > New version > Deploy.

const SPREADSHEET_ID = "PASTE_YOUR_SPREADSHEET_ID_HERE";
const SHEET_NAME = "Orders";
const ORDER_SECRET = "PASTE_THE_SAME_ORDER_SECRET_HERE";

const HEADERS = [
  "Order Number",
  "Order Date",
  "Payment Method",
  "PIXEL Reference",
  "Total (PHP)",
  "Full Name",
  "Email",
  "Phone",
  "Address",
  "Items",
  "Units",
  "Internal Order ID",
  "Receipt Number",
  "Status"
];

function safeCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrdersSheet() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function doPost(e) {
  try {
    const body = JSON.parse(
      e.postData && e.postData.contents
        ? e.postData.contents
        : "{}"
    );

    if (!body.secret || body.secret !== ORDER_SECRET) {
      return jsonResponse({
        success: false,
        message: "Invalid order secret."
      });
    }

    const orderNumber = String(body.orderNumber || "").trim();
    if (!/^SHOP-[A-Za-z0-9_-]+$/.test(orderNumber)) {
      return jsonResponse({
        success: false,
        message: "Invalid order number."
      });
    }

    const sheet = getOrdersSheet();
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);

    try {
      const lastRow = sheet.getLastRow();

      if (lastRow > 1) {
        const existingOrderNumbers = sheet
          .getRange(2, 1, lastRow - 1, 1)
          .getDisplayValues()
          .flat();

        if (existingOrderNumbers.includes(orderNumber)) {
          return jsonResponse({
            success: true,
            duplicate: true,
            orderNumber
          });
        }
      }

      const items = Array.isArray(body.items) ? body.items : [];

      const itemText = items
        .map((item) => {
          const name = String(item.name || "Item").trim();
          const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
          const price = Math.max(0, Number(item.price) || 0);
          return `${name} x${quantity} @ ₱${price.toFixed(2)}`;
        })
        .join("\n");

      const unitCount = items.reduce(
        (sum, item) => sum + Math.max(1, Math.floor(Number(item.quantity) || 1)),
        0
      );

      const createdAt = body.createdAt ? new Date(body.createdAt) : new Date();

      sheet.appendRow([
        safeCell(orderNumber),
        createdAt,
        safeCell(String(body.paymentMethod || "").toUpperCase()),
        safeCell(body.pixelReference || ""),
        Number(body.total) || 0,
        safeCell(body.recipientName || ""),
        safeCell(body.email || ""),
        safeCell(body.phone || ""),
        safeCell(body.shippingAddress || ""),
        safeCell(itemText),
        unitCount,
        safeCell(body.orderId || ""),
        safeCell(body.receiptNumber || ""),
        "New"
      ]);

      const row = sheet.getLastRow();
      sheet.getRange(row, 2).setNumberFormat("yyyy-mm-dd hh:mm:ss");
      sheet.getRange(row, 5).setNumberFormat('₱#,##0.00');
      sheet.getRange(row, 9, 1, 2).setWrap(true);

      return jsonResponse({
        success: true,
        duplicate: false,
        orderNumber
      });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return jsonResponse({
      success: false,
      message: String(error && error.message ? error.message : error)
    });
  }
}
