import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.0.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { priceId, amount, isCustom } = await req.json();

    if (isCustom && !amount) {
      return Response.json({ error: 'amount is required for custom deposits' }, { status: 400 });
    }

    if (!isCustom && !priceId) {
      return Response.json({ error: 'priceId is required' }, { status: 400 });
    }

    let sessionConfig = {
      mode: isCustom ? 'payment' : 'subscription',
      payment_method_types: ['card'],
    };

    if (isCustom) {
      sessionConfig.line_items = [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Trading Investment (USDC Deposit)',
              description: `${amount / 100} USDC deposit to your trading wallet`,
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ];
    } else {
      sessionConfig.line_items = [
        {
          price: priceId,
          quantity: 1,
        },
      ];
    }

    const session = await stripe.checkout.sessions.create({
      ...sessionConfig,
      success_url: `${Deno.env.get('BASE44_APP_URL')}/overview?payment=success`,
      cancel_url: `${Deno.env.get('BASE44_APP_URL')}/overview?payment=cancelled`,
      customer_email: user.email,
      metadata: {
        base44_app_id: Deno.env.get('BASE44_APP_ID'),
        user_email: user.email,
      },
    });

    return Response.json({ sessionUrl: session.url });
  } catch (error) {
    console.error('Stripe checkout error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});