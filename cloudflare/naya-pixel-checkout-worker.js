const ALLOWED_ORIGINS = new Set([
  "https://naya-shop.nayatorinkoch.workers.dev",
  "http://127.0.0.1:8080",
  "http://localhost:8080"
]);

const SHOP_URL = "https://naya-shop.nayatorinkoch.workers.dev/";

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin)
      ? origin
      : "https://naya-shop.nayatorinkoch.workers.dev",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin)
    }
  });
}

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

async function createPixelPayment(request, origin) {
  let input;
  try {
    input = await request.json();
  } catch {
    return json({ success: false, message: "Invalid request body." }, 400, origin);
  }

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    return json({ success: false, message: "Invalid payment amount." }, 400, origin);
  }

  const orderId = cleanText(input.order_id, 80).replace(/[^a-zA-Z0-9_-]/g, "");
  if (!orderId) {
    return json({ success: false, message: "Missing order reference." }, 400, origin);
  }

  const supporterMessage = cleanText(input.supporter_message, 250);

  const successUrl = new URL(SHOP_URL);
  successUrl.searchParams.set("pixel_status", "success");
  successUrl.searchParams.set("pixel_order", orderId);

  const failureUrl = new URL(SHOP_URL);
  failureUrl.searchParams.set("pixel_status", "failed");
  failureUrl.searchParams.set("pixel_order", orderId);

  // PIXEL's current web flow generates an Epaygames checkout from this request.
  // This endpoint is not treated here as a documented public API and may change.
  const pixelPayload = {
    username: "nayatorinko",
    supporter_name: "Shop Order",
    supporter_message: supporterMessage,
    amount: Math.round(amount * 100) / 100,
    is_anonymous: 0,
    source: "epaygames",
    success_redirect_url: successUrl.toString(),
    failure_redirect_url: failureUrl.toString()
  };

  let pixelResponse;
  try {
    pixelResponse = await fetch("https://api.pixelforcreators.com/v1/donate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(pixelPayload)
    });
  } catch {
    return json({ success: false, message: "Could not contact PIXEL." }, 502, origin);
  }

  const result = await pixelResponse.json().catch(() => null);
  if (!pixelResponse.ok || !result?.success || !result?.data?.link_url) {
    return json({
      success: false,
      message: result?.message || "PIXEL did not create a payment link."
    }, 502, origin);
  }

  return json({
    success: true,
    data: {
      reference_no: result.data.reference_no || "",
      link_url: result.data.link_url,
      link_expires_at: result.data.link_expires_at || ""
    }
  }, 200, origin);
}

async function logOrderToSheet(request, origin, env) {
  if (!env.ORDER_SHEET_WEBHOOK_URL || !env.ORDER_SHEET_SECRET) {
    return json({
      success: false,
      message: "Order spreadsheet is not configured yet."
    }, 503, origin);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ success: false, message: "Invalid order data." }, 400, origin);
  }

  const orderNumber = cleanText(input.orderNumber, 80);
  if (!/^SHOP-[A-Za-z0-9_-]+$/.test(orderNumber)) {
    return json({ success: false, message: "Invalid order number." }, 400, origin);
  }

  const safeOrder = {
    orderNumber,
    orderId: cleanText(input.orderId, 100),
    receiptNumber: cleanText(input.receiptNumber, 50),
    createdAt: cleanText(input.createdAt, 80),
    paymentMethod: ["cash", "qr", "pixel"].includes(input.paymentMethod)
      ? input.paymentMethod
      : "unknown",
    pixelReference: cleanText(input.pixelReference, 120),
    total: Math.max(0, Number(input.total) || 0),
    recipientName: cleanText(input.recipientName, 120),
    email: cleanText(input.email, 180),
    phone: cleanText(input.phone, 60),
    shippingAddress: cleanText(input.shippingAddress, 600),
    items: Array.isArray(input.items)
      ? input.items.slice(0, 100).map((item) => ({
          name: cleanText(item.name, 120),
          price: Math.max(0, Number(item.price) || 0),
          quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
          lineTotal: Math.max(0, Number(item.lineTotal) || 0)
        }))
      : []
  };

  let sheetResponse;
  try {
    sheetResponse = await fetch(env.ORDER_SHEET_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: env.ORDER_SHEET_SECRET,
        ...safeOrder
      })
    });
  } catch {
    return json({
      success: false,
      message: "Could not reach the order spreadsheet."
    }, 502, origin);
  }

  const rawResponse = await sheetResponse.text();
  let result = null;
  try {
    result = JSON.parse(rawResponse);
  } catch {
    return json({
      success: false,
      message: "Google Apps Script did not return JSON."
    }, 502, origin);
  }

  if (!sheetResponse.ok || !result?.success) {
    return json({
      success: false,
      message: result?.message || "The order spreadsheet rejected the order."
    }, 502, origin);
  }

  return json({
    success: true,
    duplicate: Boolean(result.duplicate)
  }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      if (!ALLOWED_ORIGINS.has(origin)) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin)
      });
    }

    if (!ALLOWED_ORIGINS.has(origin)) {
      return json({
        success: false,
        message: "This storefront is not allowed to use this endpoint."
      }, 403, origin);
    }

    const url = new URL(request.url);

    if (url.pathname === "/create" && request.method === "POST") {
      return createPixelPayment(request, origin);
    }

    if (url.pathname === "/order" && request.method === "POST") {
      return logOrderToSheet(request, origin, env);
    }

    return json({ success: false, message: "Not found." }, 404, origin);
  }
};
