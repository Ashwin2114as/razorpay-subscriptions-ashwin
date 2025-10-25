// /api/start-subscription.js
import Razorpay from "razorpay";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const { name, email, contact, plan_id, total_count } = req.body || {};

    if (!email || !contact || !plan_id) {
      console.error("Missing required fields:", req.body);
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    // ✅ Check Razorpay credentials
    const key_id = process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY;
    const key_secret =
      process.env.RAZORPAY_SECRET || process.env.RAZORPAY_KEY_SECRET;

    if (!key_id || !key_secret) {
      console.error("Missing Razorpay credentials in environment variables");
      return res
        .status(500)
        .json({ ok: false, error: "missing_razorpay_keys" });
    }

    // ✅ Initialize Razorpay instance
    const rz = new Razorpay({
      key_id,
      key_secret,
    });

    // ✅ Create customer (optional but helps identify users)
    let customer = null;
    try {
      customer = await rz.customers.create({
        name,
        email,
        contact,
      });
      console.log("Customer created:", customer.id);
    } catch (e) {
      console.warn("Customer creation skipped:", e.message);
    }

    // ✅ Prepare subscription payload
    const subscriptionPayload = {
      plan_id,
      customer_notify: 1,
      notes: { name, email, contact },
    };

    if (customer && customer.id) subscriptionPayload.customer_id = customer.id;
    if (total_count && Number(total_count) >= 1)
      subscriptionPayload.total_count = Number(total_count);

    // ✅ Create subscription
    const subscription = await rz.subscriptions.create(subscriptionPayload);

    console.log("Subscription created:", subscription.id);

    // ✅ Respond with subscription
    return res.status(200).json({ ok: true, subscription });
  } catch (err) {
    console.error("start-subscription error:", err.response?.body || err);
    return res.status(500).json({
      ok: false,
      error: "server_error",
      details: err.message || String(err),
    });
  }
}
