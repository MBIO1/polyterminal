import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.0.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

Deno.serve(async (req) => {
  try {
    const signature = req.headers.get('stripe-signature');
    const body = await req.text();

    if (!signature || !webhookSecret) {
      return Response.json({ error: 'Missing webhook signature or secret' }, { status: 400 });
    }

    // Verify webhook signature
    const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);

    // Handle checkout.session.completed
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userEmail = session.customer_email;
      const amountUsd = session.amount_total / 100; // Convert cents to dollars
      const amountUsdc = amountUsd; // 1:1 ratio for test

      if (!userEmail) {
        console.error('❌ No customer email in session:', session.id);
        return Response.json({ error: 'No customer email' }, { status: 400 });
      }

      // Initialize Base44 with service role (no user context for webhook)
      const base44 = createClientFromRequest(req);

      // Log transaction
      const transaction = await base44.asServiceRole.entities.Transaction.create({
        user_email: userEmail,
        type: 'deposit',
        amount_usdc: amountUsdc,
        stripe_session_id: session.id,
        status: 'completed',
        notes: `Stripe subscription payment · ${amountUsd.toFixed(2)} USD`,
      });

      console.log(`✅ Transaction recorded for ${userEmail}: ${amountUsdc} USDC`);

      // Send receipt email
      try {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: userEmail,
          subject: `✅ Payment Received - ${amountUsd.toFixed(2)} USDC Deposited`,
          body: `
Dear Trader,

Your payment has been successfully processed!

**Receipt Details:**
- Amount: $${amountUsd.toFixed(2)} USD
- USDC Deposited: ${amountUsdc} USDC
- Date: ${new Date().toISOString().split('T')[0]}
- Transaction ID: ${transaction.id}

The USDC has been credited to your trading account and is ready to use immediately.

**Next Steps:**
1. Log in to your trading dashboard
2. Start arbitrage trading on Polymarket
3. Monitor your positions in real-time

Happy trading!

---
PolyTrade
https://polytrade.base44.app
          `,
        });

        // Mark receipt as sent
        await base44.asServiceRole.entities.Transaction.update(transaction.id, {
          receipt_sent: true,
        });

        console.log(`📧 Receipt email sent to ${userEmail}`);
      } catch (emailError) {
        console.error(`⚠️ Failed to send receipt email: ${emailError.message}`);
      }

      return Response.json({ success: true, transactionId: transaction.id });
    }

    // Handle payment_intent.payment_failed
    if (event.type === 'charge.failed') {
      const charge = event.data.object;
      console.error(`❌ Payment failed for ${charge.billing_details?.email}: ${charge.failure_message}`);

      // You can optionally log failed attempts
      return Response.json({ success: true, status: 'payment_failed' });
    }

    return Response.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});