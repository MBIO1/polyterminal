import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const configs = await base44.asServiceRole.entities.BotConfig.list();
    const config = configs[0];
    
    if (!config) {
      return Response.json({ error: 'BotConfig not found' }, { status: 404 });
    }

    const newPaperTrading = !config.paper_trading;
    
    await base44.asServiceRole.entities.BotConfig.update(config.id, {
      paper_trading: newPaperTrading,
    });

    return Response.json({
      success: true,
      paper_trading: newPaperTrading,
      mode: newPaperTrading ? 'PAPER' : 'LIVE',
      message: newPaperTrading ? '📄 Switched to Paper Trading' : '🔴 LIVE TRADING ENABLED',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});