// api/verify-subscription.js
import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  try {
    const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body || {};

    if (!razorpay_payment_id || !razorpay_subscription_id) {
      return res.status(400).json({ ok: false, error: "missing_parameters" });
    }

    const KEY_ID = process.env.RAZORPAY_KEY_ID;
    const KEY_SECRET = process.env.RAZORPAY_SECRET;
    if (!KEY_ID || !KEY_SECRET) {
      return res.status(500).json({ ok: false, error: "missing_razorpay_keys" });
    }

    // verify signature if available
    if (razorpay_signature) {
      const expected = crypto.createHmac("sha256", KEY_SECRET)
        .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
        .digest("hex");

      if (expected !== razorpay_signature) {
        console.warn("signature_mismatch", { expected, provided: razorpay_signature });
        return res.status(400).json({ ok: false, error: "signature_mismatch" });
      }
    } else {
      console.warn("No razorpay_signature provided; proceeding to fetch payment");
    }

    // fetch payment details from Razorpay to ensure captured
    const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
    const payResp = await fetch(`https://api.razorpay.com/v1/payments/${razorpay_payment_id}`, {
      headers: { Authorization: `Basic ${auth}` }
    });

    const payText = await payResp.text();
    let payJson;
    try {
      payJson = JSON.parse(payText);
    } catch (e) {
      console.error("Invalid payment response from Razorpay:", payText);
      return res.status(502).json({ ok: false, error: "invalid_payment_response", details: payText });
    }

    if (!payResp.ok) {
      console.error("Failed to fetch payment:", payJson);
      return res.status(502).json({ ok: false, error: "fetch_payment_failed", details: payJson });
    }

    if (payJson.status !== "captured") {
      console.warn("Payment not captured:", payJson.status);
      return res.status(400).json({ ok: false, error: "payment_not_captured", status: payJson.status });
    }

    // success
    return res.status(200).json({ ok: true, payment: { id: payJson.id, status: payJson.status, amount: payJson.amount } });
  } catch (err) {
    console.error("verify-subscription error:", err);
    return res.status(500).json({ ok: false, error: "server_error", details: err.message || String(err) });
  }
}
