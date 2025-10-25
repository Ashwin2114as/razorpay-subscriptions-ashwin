// /api/razorpay-webhook.js
import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const zapierUrl = process.env.ZAPIER_WEBHOOK_URL;

  if (!secret) {
    console.error("RAZORPAY_WEBHOOK_SECRET not set");
    return res.status(500).json({ ok: false, error: "webhook_secret_not_configured" });
  }

  // raw body used to compute HMAC exactly as Razorpay sent it
  const bodyRaw = JSON.stringify(req.body || {});
  const signature = req.headers["x-razorpay-signature"] || req.headers["X-Razorpay-Signature"];

  // verify signature
  const expected = crypto.createHmac("sha256", secret).update(bodyRaw).digest("hex");
  if (!signature || expected !== signature) {
    console.warn("Invalid webhook signature", { expected, signature });
    return res.status(400).json({ ok: false, error: "invalid_signature" });
  }

  try {
    const event = req.body.event;
    const payload = req.body.payload || {};

    // helper to get email (notes preferred)
    const sub = payload.subscription && payload.subscription.entity;
    const payment = payload.payment && payload.payment.entity;
    const customer = payload.customer && payload.customer.entity;

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

    // Decide if this is a "paid" event we should forward
    let shouldForward = false;
    let forwardPayload = null;

    if (event === "payment.captured") {
      // payment captured: forward
      const pay = payment;
      if (pay && pay.status === "captured") {
        shouldForward = true;
        forwardPayload = {
          event,
          payment_id: pay.id,
          amount: pay.amount,
          currency: pay.currency,
          email,
          name,
          raw: req.body,
        };
      }
    } else if (event === "subscription.charged" || event === "subscription.activated") {
      // subscription events contain subscription and maybe payment
      const pay = payload.payment && payload.payment.entity;
      const subscriptionEntity = sub || (payload.subscription && payload.subscription.entity);
      const payStatus = pay && pay.status;
      if (pay && payStatus === "captured") {
        shouldForward = true;
        forwardPayload = {
          event,
          payment_id: pay.id,
          subscription_id: subscriptionEntity && subscriptionEntity.id,
          plan_id: subscriptionEntity && subscriptionEntity.plan_id,
          amount: pay.amount,
          currency: pay.currency,
          email,
          name,
          raw: req.body,
        };
      } else {
        // sometimes subscription.activated has no payment attached — ignore unless payment present
        shouldForward = false;
      }
    } else if (event === "order.paid") {
      // if you use orders
      const orderPayment = payload.payment && payload.payment.entity;
      if (orderPayment && orderPayment.status === "captured") {
        shouldForward = true;
        forwardPayload = {
          event,
          payment_id: orderPayment.id,
          order_id: payload.order && payload.order.entity && payload.order.entity.id,
          amount: orderPayment.amount,
          currency: orderPayment.currency,
          email,
          name,
          raw: req.body,
        };
      }
    } else {
      // ignore other events
      shouldForward = false;
    }

    if (shouldForward && forwardPayload) {
      if (!zapierUrl) {
        console.warn("ZAPIER_WEBHOOK_URL not set - skipping forward", forwardPayload);
      } else {
        // Post to Zapier
        try {
          await fetch(zapierUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(forwardPayload),
          });
          console.log("Forwarded paid event to Zapier:", forwardPayload.event, forwardPayload.payment_id || forwardPayload.subscription_id);
        } catch (err) {
          console.error("Failed to forward to Zapier:", err);
        }
      }
    } else {
      console.log("Ignored event (not a paid event):", event);
    }

    // Always respond 200 to Razorpay (unless signature invalid)
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    return res.status(500).json({ ok: false, error: "internal_error", details: err.message || String(err) });
  }
}
