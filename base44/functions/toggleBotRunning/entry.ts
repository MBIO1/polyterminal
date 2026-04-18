import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { running } = await req.json();
    const configs = await base44.asServiceRole.entities.BotConfig.list();
    const config = configs[0];
    
    if (!config) {
      return Response.json({ error: 'BotConfig not found' }, { status: 404 });
    }

    await base44.asServiceRole.entities.BotConfig.update(config.id, {
      bot_running: running,
      kill_switch_active: false,
    });

    return Response.json({
      success: true,
      bot_running: running,
      message: running ? '🚀 Bot started — scanning for trades' : '⏹️ Bot stopped',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});