// api/start-subscription.js
import Razorpay from "razorpay";

function sendError(res, status = 500, message = "Server error", details = null) {
  // Always return simple JSON so frontend can show it
  const payload = { error: message };
  if (details) payload.details = details;
  res.status(status).json(payload);
}

export default async function handler(req, res) {
  // CORS (use a fixed origin from env or * for dev)
  const origin = process.env.ALLOW_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "OPTIONS,POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");

  try {
    const body = req.body || {};
    const { name, email, contact, plan_id } = body;

    if (!email || !contact || !plan_id) {
      return sendError(res, 400, "Missing required fields (name, email, contact, plan_id)", { received: body });
    }

    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return sendError(res, 500, "Razorpay keys not configured in environment variables");
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    // create customer
    let customer;
    try {
      customer = await razorpay.customers.create({ name, email, contact });
    } catch (err) {
      console.error("Error creating Razorpay customer:", err);
      return sendError(res, 502, "Failed to create Razorpay customer", err?.message || err);
    }

    // create subscription
    let subscription;
    try {
      subscription = await razorpay.subscriptions.create({
        plan_id,
        customer_notify: 1,
        total_count: 0,
        customer_id: customer.id,
        notes: { name, email, contact },
      });
    } catch (err) {
      console.error("Error creating Razorpay subscription:", err);
      // Common reason: invalid plan_id or account permission
      const errMessage = err?.error?.description || err?.message || JSON.stringify(err);
      return sendError(res, 502, "Failed to create subscription. Check plan_id and Razorpay keys", errMessage);
    }

    return res.status(200).json({ subscription });
  } catch (err) {
    console.error("start-subscription unexpected error:", err);
    return sendError(res, 500, "Unexpected server error", err?.message || String(err));
  }
}
