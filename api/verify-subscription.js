// api/verify-subscription.js
import Razorpay from "razorpay";
import fetch from "node-fetch";

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "OPTIONS,POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const { razorpay_payment_id, razorpay_subscription_id } = req.body || {};
    if (!razorpay_payment_id || !razorpay_subscription_id) {
      return res.status(400).json({ error: "Missing payment_id or subscription_id" });
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    // 1) verify payment
    let payment;
    try {
      payment = await razorpay.payments.fetch(razorpay_payment_id);
    } catch (err) {
      console.error("payments.fetch error:", err);
      return res.status(500).json({ error: "Failed to fetch payment" });
    }

    if (!payment || payment.status !== "captured") {
      return res.status(400).json({ error: "Payment not captured", payment });
    }

    // 2) verify subscription
    let subscription;
    try {
      subscription = await razorpay.subscriptions.fetch(razorpay_subscription_id);
    } catch (err) {
      console.error("subscriptions.fetch error:", err);
      return res.status(500).json({ error: "Failed to fetch subscription" });
    }

    if (!subscription || !["active", "authenticated"].includes(subscription.status)) {
      return res.status(400).json({ error: "Subscription not active", subscription });
    }

    // 3) optional: persist verified submission to Google Sheet or DB
    // If you set GS_URL env var, forward the notes to the sheet
    const notes = subscription.notes || {};
    if (process.env.GS_URL) {
      try {
        await fetch(process.env.GS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: notes.name,
            email: notes.email,
            phone: notes.contact,
            subscription_id: razorpay_subscription_id,
            payment_id: razorpay_payment_id
          })
        });
      } catch (err) {
        console.error("Failed to save to GS_URL:", err);
        // continue — verification still succeeded
      }
    }

    return res.status(200).json({ ok: true, notes, payment, subscription });
  } catch (err) {
    console.error("verify-subscription error:", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}
