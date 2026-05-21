import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Check order server connectivity
    const DROPLET_IP = Deno.env.get('DROPLET_IP');
    const ORDER_SERVER_PORT = Deno.env.get('ORDER_SERVER_PORT') || '4001';
    
    if (!DROPLET_IP) {
      return Response.json({ error: 'DROPLET_IP secret not set' }, { status: 500 });
    }

    const orderServerUrl = `http://${DROPLET_IP}:${ORDER_SERVER_PORT}/health`;
    
    let orderServerStatus = 'offline';
    let orderServerData = null;
    
    try {
      const response = await fetch(orderServerUrl, { 
        method: 'GET',
        timeout: 5000 
      });
      if (response.ok) {
        orderServerData = await response.json();
        orderServerStatus = 'online';
      }
    } catch (error) {
      orderServerStatus = 'offline';
    }

    // Get last heartbeat to determine downtime duration
    const heartbeats = await base44.entities.ArbHeartbeat.list('-snapshot_time', 1);
    const lastHeartbeat = heartbeats?.[0];
    
    let downtimeMinutes = 0;
    let isOffline = false;
    
    if (orderServerStatus === 'offline') {
      isOffline = true;
      if (lastHeartbeat?.snapshot_time) {
        const lastSeen = new Date(lastHeartbeat.snapshot_time).getTime();
        const now = Date.now();
        downtimeMinutes = Math.floor((now - lastSeen) / 60000);
      }
    }

    // Check if we should send an alert (avoid spam - only alert if newly offline or >30 min)
    const alertCooldownKey = 'order_server_alert_last_sent';
    const lastAlert = await base44.entities.ArbConfig.filter({}).then(configs => {
      // Use a simple entity to track last alert time - we'll store in a dedicated entity
      return null;
    });
    
    // Get last alert from a dedicated tracking entity
    const alerts = await base44.entities.ArbException.filter({ 
      type: 'Execution',
      description: 'Order Server Offline'
    }, '-created_date', 1);
    
    const lastAlertTime = alerts?.[0]?.created_date ? new Date(alerts[0].created_date).getTime() : 0;
    const now = Date.now();
    const minutesSinceLastAlert = Math.floor((now - lastAlertTime) / 60000);
    
    // Only alert if:
    // 1. Server is offline AND
    // 2. Either no previous alert OR last alert was >30 minutes ago
    if (isOffline && (lastAlertTime === 0 || minutesSinceLastAlert >= 30)) {
      const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
      const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
      
      if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
        const downtimeText = downtimeMinutes > 0 
          ? `⏱️ <b>Downtime:</b> ${downtimeMinutes} minutes`
          : `⏱️ <b>Status:</b> Just went offline`;
        
        const message = `
🚨 <b>ORDER SERVER OFFLINE</b> 🚨

${downtimeText}
🖥️ <b>Droplet:</b> ${DROPLET_IP}
🔌 <b>Port:</b> ${ORDER_SERVER_PORT}
🕐 <b>Detected:</b> ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}

<b>Action Required:</b>
1. SSH into droplet
2. Run: pm2 logs arb-order-server --lines 50
3. Restart if needed: pm2 restart arb-order-server
`;

        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: message.trim(),
            parse_mode: 'HTML'
          })
        });

        // Log the alert
        await base44.entities.ArbException.create({
          exception_id: `OS-${Date.now()}`,
          exception_date: new Date().toISOString(),
          type: 'Execution',
          exchange: 'Order Server',
          asset: 'ALL',
          status: 'Open',
          severity: 'Critical',
          description: 'Order Server Offline',
          action_taken: `Alert sent via Telegram. Downtime: ${downtimeMinutes} minutes`,
          owner: 'System'
        });
      }
    }

    return Response.json({
      order_server_status: orderServerStatus,
      order_server_data: orderServerData,
      is_offline: isOffline,
      downtime_minutes: downtimeMinutes,
      alert_sent: isOffline && (lastAlertTime === 0 || minutesSinceLastAlert >= 30)
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});