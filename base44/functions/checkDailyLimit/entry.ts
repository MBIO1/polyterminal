import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get today's transactions for this user
    const today = new Date().toISOString().split('T')[0];
    const transactions = await base44.asServiceRole.entities.Transaction.filter({
      user_email: user.email,
      status: 'completed'
    });

    // Calculate today's total (filter by created_date)
    const todayTotal = transactions
      .filter(t => t.created_date.split('T')[0] === today)
      .reduce((sum, t) => sum + t.amount_usdc, 0);

    const dailyLimit = 1000;
    const remaining = Math.max(0, dailyLimit - todayTotal);

    return Response.json({
      todayTotal,
      remaining,
      dailyLimit,
      canDeposit: remaining > 0,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});