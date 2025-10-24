// api/razorpay-webhook.js
import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const bodyRaw = JSON.stringify(req.body || {});
  const signature = req.headers["x-razorpay-signature"] || req.headers["X-Razorpay-Signature"];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("RAZORPAY_WEBHOOK_SECRET not set");
    return res.status(500).json({ message: "Webhook secret not configured" });
  }

  // verify signature
  const expected = crypto.createHmac("sha256", secret).update(bodyRaw).digest("hex");
  if (expected !== signature) {
    console.warn("Invalid webhook signature", { expected, signature });
    return res.status(400).json({ message: "Invalid signature" });
  }

  try {
    const event = req.body.event;
    const payload = req.body.payload || {};
    const sub = payload.subscription && payload.subscription.entity;
    const payment = payload.payment && payload.payment.entity;
    const customer = payload.customer && payload.customer.entity;

    // Preference order: subscription.notes.email -> payment.email -> customer.email
    const email =
      (sub && sub.notes && sub.notes.email) ||
      (payment && payment.email) ||
      (customer && customer.email) ||
      null;

    const name =
      (sub && sub.notes && sub.notes.name) ||
      (customer && customer.name) ||
      (payment && payment.name) ||
      null;

    const forward = {
      event,
      subscription_id: sub && sub.id,
      status: sub && sub.status,
      plan_id: sub && sub.plan_id,
      customer_id: sub && sub.customer_id,
      email,
      name,
      current_start: sub && sub.current_start,
      current_end: sub && sub.current_end,
      raw: req.body,
    };

    // Post to Zapier Catch Hook (set in Vercel env ZAPIER_WEBHOOK_URL)
    if (process.env.ZAPIER_WEBHOOK_URL) {
      await fetch(process.env.ZAPIER_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(forward),
      });
    } else {
      console.warn("ZAPIER_WEBHOOK_URL missing; skipping forward.");
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}
