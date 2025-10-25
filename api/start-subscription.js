// api/start-subscription.js
import Razorpay from "razorpay";

function sendError(res, status = 500, message = "Server error", details = null) {
  const payload = { error: message };
  if (details !== undefined && details !== null) payload.details = details;
  res.status(status).json(payload);
}

export default async function handler(req, res) {
  const origin = process.env.ALLOW_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "OPTIONS,POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");

  try {
    const { name, email, contact, plan_id, total_count } = req.body || {};
    if (!email || !contact || !plan_id) {
      return sendError(res, 400, "Missing required fields (name, email, contact, plan_id)", { received: req.body });
    }
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return sendError(res, 500, "Razorpay keys not configured in environment variables");
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    // Helper to parse readable message
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

    // 1) Try to find existing customer by contact or email
    let customer = null;
    try {
      // try contact first (most reliable)
      const byContact = await razorpay.customers.all({ contact, count: 20 });
      if (Array.isArray(byContact?.items) && byContact.items.length > 0) {
        customer = byContact.items[0];
      } else {
        // fallback by email
        const byEmail = await razorpay.customers.all({ email, count: 20 });
        if (Array.isArray(byEmail?.items) && byEmail.items.length > 0) {
          customer = byEmail.items[0];
        }
      }
    } catch (err) {
      console.warn("customer search error (non-fatal):", err);
    }

    // 2) If found but email/name differ, update the customer record to the typed email/name
    if (customer) {
      const needsUpdate = (email && customer.email !== email) || (name && customer.name !== name) || (contact && customer.contact !== contact);
      if (needsUpdate) {
        try {
          // Razorpay edit endpoint uses 'id' and patch fields
          // Use the edit/update call available on the SDK:
          await razorpay.customers.edit(customer.id, { name, email, contact });
          // Refresh customer object
          const refreshed = await razorpay.customers.fetch(customer.id);
          customer = refreshed;
        } catch (err) {
          console.warn("Failed to update existing customer - continuing with original customer:", readableError(err));
          // continue - we will still create subscription with notes which is authoritative
        }
      }
    } else {
      // 3) Not found — create new customer
      try {
        customer = await razorpay.customers.create({ name, email, contact });
      } catch (err) {
        // If create fails because of duplicate/other reasons, we will continue and rely on notes later
        console.warn("Customer create failed (continuing):", readableError(err));
        customer = null;
      }
    }

    // 4) Build subscription payload and ensure notes include the typed email/name (source of truth)
    const subscriptionPayload = {
      plan_id,
      customer_notify: 1,
      notes: { name: name || "", email: email || "", contact: contact || "" },
    };

    // include customer_id if we have a valid customer
    if (customer && customer.id) subscriptionPayload.customer_id = customer.id;

    // total_count or end_at logic — use passed total_count or default 12
    if (total_count && Number(total_count) >= 1) {
      subscriptionPayload.total_count = Number(total_count);
    } else if (process.env.SUBSCRIPTION_END_YEARS) {
      const years = Number(process.env.SUBSCRIPTION_END_YEARS) || 10;
      const now = Math.floor(Date.now() / 1000);
      subscriptionPayload.end_at = now + years * 365 * 24 * 60 * 60;
    } else {
      subscriptionPayload.total_count = 12; // default fallback
    }

    // 5) Create subscription
    let subscription;
    try {
      subscription = await razorpay.subscriptions.create(subscriptionPayload);
    } catch (err) {
      console.error("Error creating subscription:", readableError(err), err);
      return sendError(res, 502, "Failed to create subscription. Check plan_id and Razorpay keys", readableError(err));
    }

    // 6) Return subscription to client to open checkout
    return res.status(200).json({ subscription });
  } catch (err) {
    console.error("start-subscription unexpected error:", err);
    return sendError(res, 500, "Unexpected server error", err?.message || String(err));
  }
}
