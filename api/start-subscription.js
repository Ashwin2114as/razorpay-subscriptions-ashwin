// api/start-subscription.js
import Razorpay from "razorpay";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  try {
    const { name, email, contact, plan_id, total_count } = req.body || {};
    if (!email || !contact || !plan_id) return res.status(400).json({ ok: false, error: "missing_fields" });

    const key_id = process.env.RAZORPAY_KEY_ID;
    const key_secret = process.env.RAZORPAY_SECRET;
    if (!key_id || !key_secret) {
      console.error("Missing RAZORPAY_KEY_ID or RAZORPAY_SECRET");
      return res.status(500).json({ ok: false, error: "missing_razorpay_keys" });
    }

    const rz = new Razorpay({ key_id, key_secret });

    // create customer (best-effort)
    let customer = null;
    try {
      customer = await rz.customers.create({ name, email, contact });
    } catch (err) {
      console.warn("Customer creation failed/skipped:", err && err.error?.description || err.message || err);
      customer = null;
    }

    const payload = {
      plan_id,
      customer_notify: 1,
      notes: { name: name || "", email: email || "", contact: contact || "" }
    };
    if (customer && customer.id) payload.customer_id = customer.id;
    if (total_count && Number(total_count) >= 1) payload.total_count = Number(total_count);

    const subscription = await rz.subscriptions.create(payload);

    return res.status(200).json({ ok: true, subscription });
  } catch (err) {
    console.error("start-subscription error:", err && (err.error?.description || err.message || err));
    return res.status(500).json({ ok: false, error: "server_error", details: err.message || String(err) });
  }
}
