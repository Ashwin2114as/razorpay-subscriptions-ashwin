// api/start-subscription.js
import Razorpay from "razorpay";

/**
 * Robust start-subscription endpoint:
 * - Reuses existing Razorpay customer when email/contact matches
 * - Reuses an existing subscription for customer+plan if it exists (and is not cancelled)
 * - Creates subscription with either total_count (if provided) or SUBSCRIPTION_END_YEARS env, else defaults to 12
 */

function sendError(res, status = 500, message = "Server error", details = null) {
  const payload = { error: message };
  if (details !== undefined && details !== null) payload.details = details;
  res.status(status).json(payload);
}

export default async function handler(req, res) {
  // CORS
  const origin = process.env.ALLOW_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "OPTIONS,POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");

  try {
    const body = req.body || {};
    const { name, email, contact, plan_id } = body;

    if (!email || !contact || !plan_id) {
      return sendError(res, 400, "Missing required fields (name, email, contact, plan_id)", { received: body });
    }

    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return sendError(res, 500, "Razorpay keys not configured in environment variables");
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    // Helper to extract readable error text from Razorpay error objects
    const readableError = (err) => {
      try {
        if (!err) return String(err);
        if (err.error && err.error.description) return err.error.description;
        if (err.message) return err.message;
        return JSON.stringify(err);
      } catch (e) {
        return String(err);
      }
    };

    // 1) Try to find existing customer by email
    let customer = null;
    try {
      // Razorpay supports listing customers with query params (email/contact)
      // We'll try email first, then contact.
      const byEmail = await razorpay.customers.all({ email });
      if (Array.isArray(byEmail?.items) && byEmail.items.length > 0) {
        customer = byEmail.items[0];
      } else {
        // try by contact
        const byContact = await razorpay.customers.all({ contact });
        if (Array.isArray(byContact?.items) && byContact.items.length > 0) {
          customer = byContact.items[0];
        }
      }
    } catch (err) {
      // non-fatal: log and continue — we'll attempt to create customer
      console.error("customer search error:", err);
    }

    // 2) If not found, create a new customer
    if (!customer) {
      try {
        customer = await razorpay.customers.create({ name, email, contact });
      } catch (err) {
        console.error("Error creating Razorpay customer:", err);
        return sendError(res, 502, "Failed to create Razorpay customer", readableError(err));
      }
    }

    // 3) Check for an existing subscription for this customer and plan
    // We'll call subscriptions list with customer_id and plan_id filters.
    try {
      const subsList = await razorpay.subscriptions.all({
        customer_id: customer.id,
        plan_id,
        count: 10,
      });

      if (Array.isArray(subsList?.items) && subsList.items.length > 0) {
        // prefer a subscription in a reusable state
        const reusable = subsList.items.find((s) =>
          ["created", "pending", "authenticated"].includes(s.status)
        );
        if (reusable) {
          // Return existing subscription to frontend so it can reopen checkout
          return res.status(200).json({ subscription: reusable, reuse: true });
        }
      }
    } catch (err) {
      // Log but not fatal; proceed to create new subscription
      console.error("Error listing subscriptions:", err);
    }

    // 4) Build subscription payload (total_count or end_at or default)
    const subscriptionPayload = {
      plan_id,
      customer_notify: 1,
      customer_id: customer.id,
      notes: { name, email, contact },
    };

    if (body.total_count && Number(body.total_count) >= 1) {
      subscriptionPayload.total_count = Number(body.total_count);
    } else if (process.env.SUBSCRIPTION_END_YEARS) {
      const years = Number(process.env.SUBSCRIPTION_END_YEARS) || 10;
      const now = Math.floor(Date.now() / 1000);
      const endAt = now + years * 365 * 24 * 60 * 60;
      subscriptionPayload.end_at = endAt;
    } else {
      subscriptionPayload.total_count = 12; // default fallback
    }

    // 5) Create subscription
    let subscription;
    try {
      subscription = await razorpay.subscriptions.create(subscriptionPayload);
    } catch (err) {
      console.error("Error creating Razorpay subscription:", err);
      return sendError(res, 502, "Failed to create subscription. Check plan_id and Razorpay keys", readableError(err));
    }

    // 6) Success
    return res.status(200).json({ subscription, reuse: false });
  } catch (err) {
    console.error("start-subscription unexpected error:", err);
    return sendError(res, 500, "Unexpected server error", err?.message || String(err));
  }
}
