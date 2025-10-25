// /api/verify-subscription.js
import crypto from "crypto";
import fetch from "node-fetch"; // (optional in latest Vercel, but safe)

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const {
      razorpay_payment_id,
      razorpay_subscription_id,
      razorpay_signature,
    } = req.body;

    if (!razorpay_payment_id || !razorpay_subscription_id) {
      return res.status(400).json({ ok: false, error: "missing_parameters" });
    }

    const RZP_SECRET = process.env.RAZORPAY_SECRET;
    const RZP_KEY_ID = process.env.RAZORPAY_KEY_ID;

    if (!RZP_SECRET || !RZP_KEY_ID) {
      console.error("Missing Razorpay credentials in environment variables");
      return res
        .status(500)
        .json({ ok: false, error: "server_config_missing" });
    }

    // ✅ Verify Razorpay signature if present
    if (razorpay_signature) {
      const generated = crypto
        .createHmac("sha256", RZP_SECRET)
        .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
        .digest("hex");

      if (generated !== razorpay_signature) {
        console.warn("Signature mismatch");
        return res.status(400).json({ ok: false, error: "signature_mismatch" });
      }
    }

    // ✅ Optionally confirm payment on Razorpay API
    const auth = Buffer.from(`${RZP_KEY_ID}:${RZP_SECRET}`).toString("base64");
    const payResp = await fetch(
      `https://api.razorpay.com/v1/payments/${razorpay_payment_id}`,
      {
        headers: { Authorization: `Basic ${auth}` },
      }
    );

    if (!payResp.ok) {
      const errText = await payResp.text();
      console.error("Failed to fetch payment from Razorpay:", errText);
      return res
        .status(500)
        .json({ ok: false, error: "fetch_payment_failed" });
    }

    const payment = await payResp.json();

    if (payment.status !== "captured") {
      console.warn("Payment not captured yet:", payment.status);
      return res
        .status(400)
        .json({ ok: false, error: "payment_not_captured" });
    }

    // ✅ If we reach here → verified successfully
    console.log("✅ Payment verified successfully:", payment.id);

    // Optionally store in DB or call Zapier here

    return res.status(200).json({ ok: true, message: "verified" });
  } catch (err) {
    console.error("verify-subscription error:", err);
    return res
      .status(500)
      .json({ ok: false, error: "server_error", details: err.message });
  }
}
