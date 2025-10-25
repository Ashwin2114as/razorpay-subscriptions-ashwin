// /api/start-subscription.js
import Razorpay from "razorpay";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  try {
    const { name, email, contact, plan_id, total_count } = req.body || {};
    if (!email || !contact || !plan_id) return res.status(400).json({ ok: false, error: "missing_fields" });

    const rz = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY,
      key_secret: process.env.RAZORPAY_SECRET || process.env.RAZORPAY_KEY_SECRET,
    });

    // Try to create customer (Razorpay may allow duplicates; we try-catch)
    let customer = null;
    try {
      customer = await rz.customers.create({ name, email, contact });
    } catch (e) {
      console.warn("Customer create warning (continuing):", e && (e.error?.description || e.message || e));
      // continue without failing; we'll attach notes to subscription
      customer = null;
    }

    const subscriptionPayload = {
      plan_id,
      customer_notify: 1,
      notes: { name: name || "", email: email || "", contact: contact || "" },
    };

    if (customer && customer.id) subscriptionPayload.customer_id = customer.id;
    if (total_count && Number(total_count) >= 1) subscriptionPayload.total_count = Number(total_count);

    const subscription = await rz.subscriptions.create(subscriptionPayload);

    return res.status(200).json({ ok: true, subscription });
  } catch (err) {
    console.error("start-subscription error:", err);
    return res.status(500).json({ ok: false, error: "server_error", details: err.message || String(err) });
  }
}
