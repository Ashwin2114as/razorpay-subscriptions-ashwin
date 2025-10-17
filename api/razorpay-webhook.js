import crypto from "crypto"

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" })

  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET
    const zapierWebhook = process.env.ZAPIER_WEBHOOK_URL

    // Razorpay sends signature in header
    const signature = req.headers["x-razorpay-signature"]
    const body = JSON.stringify(req.body)

    // Verify webhook signature
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(body)
      .digest("hex")

    if (expectedSignature !== signature) {
      return res.status(400).json({ message: "Invalid signature" })
    }

    const event = req.body.event
    const payload = req.body.payload

    // Important info from Razorpay
    const customerEmail = payload?.subscription?.entity?.customer_notify
      ? payload.subscription.entity.customer_notify
      : payload?.payment?.entity?.email

    const data = {
      event,
      subscription_id: payload?.subscription?.entity?.id || null,
      status: payload?.subscription?.entity?.status || null,
      plan_id: payload?.subscription?.entity?.plan_id || null,
      customer_id: payload?.subscription?.entity?.customer_id || null,
      email: payload?.subscription?.entity?.notes?.email || customerEmail,
      name: payload?.subscription?.entity?.notes?.name,
      current_start: payload?.subscription?.entity?.current_start,
      current_end: payload?.subscription?.entity?.current_end,
      updated_at: payload?.subscription?.entity?.updated_at,
    }

    // Forward event to Zapier
    await fetch(zapierWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })

    return res.status(200).json({ message: "Webhook processed", event })
  } catch (err) {
    console.error("Webhook error:", err)
    return res.status(500).json({ message: "Server error", error: err.message })
  }
}
