// /api/verify-subscription.js
import crypto from "crypto";

export default async function handler(req, res) {
  // Allow only POST
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const body = req.body || {};
    const {
      razorpay_payment_id,
      razorpay_subscription_id,
      razorpay_signature,
    } = body;

    // Basic parameter check
    if (!razorpay_payment_id || !razorpay_subscription_id) {
      return res
        .status(400)
        .json({ ok: false, error: "missing_parameters" });
    }

    // Ensure env vars exist
    const KEY_ID = process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY;
    const KEY_SECRET = process.env.RAZORPAY_SECRET || process.env.RAZORPAY_KEY_SECRET;

    if (!KEY_ID || !KEY_SECRET) {
      console.error("Missing Razorpay credentials. Vercel env must include RAZORPAY_KEY_ID and RAZORPAY_SECRET (or RAZORPAY_KEY / RAZORPAY_KEY_SECRET).");
      return res.status(500).json({ ok: false, error: "server_config_missing" });
    }

    // If signature present, verify it: HMAC_SHA256(payment_id + '|' + subscription_id)
    if (razorpay_signature) {
      try {
        const expected = crypto
          .createHmac("sha256", KEY_SECRET)
          .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
          .digest("hex");

        if (expected !== razorpay_signature) {
          console.warn("Signature mismatch", { expected, provided: razorpay_signature });
          return res.status(400).json({ ok: false, error: "signature_mismatch" });
        }
      } catch (sigErr) {
        console.error("Signature verification exception:", sigErr);
        return res.status(500).json({ ok: false, error: "signature_verification_error" });
      }
    } else {
      // signature missing - we still continue but warn
      console.warn("No razorpay_signature provided in request body - continuing but signature not verified.");
    }

    // Fetch payment from Razorpay to ensure it's captured
    const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
    const paymentUrl = `https://api.razorpay.com/v1/payments/${razorpay_payment_id}`;

    const payResp = await fetch(paymentUrl, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    const payText = await payResp.text();
    let payJson = null;
    try {
      payJson = JSON.parse(payText);
    } catch (e) {
      // log and return error
      console.error("Failed to parse payment response from Razorpay:", payText);
      return res.status(502).json({ ok: false, error: "invalid_payment_response", details: payText });
    }

    if (!payResp.ok) {
      console.error("Razorpay payment fetch failed:", payResp.status, payJson);
      return res.status(502).json({ ok: false, error: "fetch_payment_failed", details: payJson });
    }

    // Check captured status
    if (payJson.status !== "captured") {
      console.warn("Payment status not captured:", payJson.status);
      return res.status(400).json({ ok: false, error: "payment_not_captured", status: payJson.status });
    }

    // At this point verification succeeded
    console.log("Payment verified OK:", { payment_id: razorpay_payment_id, subscription_id: razorpay_subscription_id });

    // OPTIONAL: do more (save to DB, call Zapier etc.)

    return res.status(200).json({ ok: true, message: "verified", payment: { id: payJson.id, status: payJson.status, amount: payJson.amount } });
  } catch (err) {
    console.error("Unexpected verify-subscription error:", err);
    return res.status(500).json({ ok: false, error: "server_error", details: err.message || String(err) });
  }
}
