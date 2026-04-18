import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { updates } = body;

    if (!updates || typeof updates !== 'object') {
      return Response.json({ error: 'Invalid updates object' }, { status: 400 });
    }

    const configs = await base44.asServiceRole.entities.BotConfig.list();
    if (configs.length === 0) {
      return Response.json({ error: 'No BotConfig found' }, { status: 400 });
    }

    const config = configs[0];
    const updated = await base44.asServiceRole.entities.BotConfig.update(config.id, updates);

    return Response.json({
      success: true,
      updated: updated,
      changes: Object.keys(updates),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});