import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { jsPDF } from 'npm:jspdf@4.0.0';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { weekStart, trades = [] } = body;

    if (!weekStart) {
      return Response.json({ error: 'weekStart is required' }, { status: 400 });
    }

    // Calculate metrics
    const settledTrades = trades.filter(t => t.outcome === 'pending' || t.outcome === 'cancelled');
    const wins = settledTrades.filter(t => t.outcome === 'win').length;
    const losses = settledTrades.filter(t => t.outcome === 'loss').length;
    const total = wins + losses;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : 0;
    const totalPnL = settledTrades.reduce((sum, t) => sum + (t.pnl_usdc || 0), 0);

    // Calculate max drawdown
    let maxDD = 0;
    let peak = 0;
    const startBalance = (await base44.asServiceRole.entities.BotConfig.list())?.[0]?.starting_balance || 1000;
    let runningBalance = startBalance;
    settledTrades.forEach(t => {
      runningBalance += t.pnl_usdc || 0;
      peak = Math.max(peak, runningBalance);
      const dd = peak > 0 ? ((peak - runningBalance) / peak) * 100 : 0;
      maxDD = Math.max(maxDD, dd);
    });

    // Create PDF
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    let y = 15;

    // Header
    pdf.setFontSize(24);
    pdf.setTextColor(30, 144, 255);
    pdf.text('Weekly Performance Report', pageWidth / 2, y, { align: 'center' });

    y += 12;
    pdf.setFontSize(10);
    pdf.setTextColor(100, 100, 100);
    const weekDate = new Date(weekStart);
    const weekEnd = new Date(weekDate);
    weekEnd.setDate(weekEnd.getDate() + 6);
    pdf.text(`Week of ${weekDate.toLocaleDateString('en-US')} - ${weekEnd.toLocaleDateString('en-US')}`, pageWidth / 2, y, { align: 'center' });

    // Summary metrics boxes
    y += 15;
    pdf.setFontSize(11);
    pdf.setTextColor(0, 0, 0);

    const metrics = [
      { label: 'Total Trades', value: total, color: [200, 200, 200] },
      { label: 'Win Rate', value: `${winRate}%`, color: [144, 238, 144] },
      { label: 'Realized P&L', value: `$${totalPnL.toFixed(2)}`, color: totalPnL >= 0 ? [144, 238, 144] : [255, 100, 100] },
      { label: 'Max Drawdown', value: `${maxDD.toFixed(1)}%`, color: [255, 165, 0] },
    ];

    const boxWidth = (pageWidth - 30) / 4;
    metrics.forEach((metric, i) => {
      const x = 15 + i * (boxWidth + 2);
      pdf.setFillColor(...metric.color);
      pdf.rect(x, y, boxWidth, 20, 'F');
      pdf.setFontSize(8);
      pdf.setTextColor(0, 0, 0);
      pdf.text(metric.label, x + boxWidth / 2, y + 6, { align: 'center' });
      pdf.setFontSize(12);
      pdf.setFont(undefined, 'bold');
      pdf.text(metric.value.toString(), x + boxWidth / 2, y + 16, { align: 'center' });
    });

    y += 30;

    // Breakdown section
    pdf.setFontSize(13);
    pdf.setFont(undefined, 'bold');
    pdf.setTextColor(0, 0, 0);
    pdf.text('Trade Breakdown', 15, y);

    y += 8;
    pdf.setFontSize(10);
    pdf.setFont(undefined, 'normal');
    pdf.text(`Wins: ${wins} | Losses: ${losses} | Win Rate: ${winRate}%`, 15, y);

    // Daily breakdown
    y += 12;
    const dailyMap = {};
    settledTrades.forEach(t => {
      const day = new Date(t.created_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      if (!dailyMap[day]) dailyMap[day] = { trades: 0, pnl: 0, wins: 0 };
      dailyMap[day].trades++;
      dailyMap[day].pnl += t.pnl_usdc || 0;
      if (t.outcome === 'win') dailyMap[day].wins++;
    });

    pdf.setFontSize(9);
    pdf.setFont(undefined, 'bold');
    pdf.text('Day', 15, y);
    pdf.text('Trades', 40, y);
    pdf.text('Wins', 65, y);
    pdf.text('P&L', 90, y);

    y += 6;
    pdf.setFont(undefined, 'normal');
    Object.entries(dailyMap)
      .sort(([aDay], [bDay]) => new Date(aDay) - new Date(bDay))
      .forEach(([day, data]) => {
        pdf.text(day, 15, y);
        pdf.text(data.trades.toString(), 40, y);
        pdf.text(`${data.wins}/${data.trades}`, 65, y);
        pdf.text(`$${data.pnl.toFixed(2)}`, 90, y);
        y += 6;
        if (y > pageHeight - 20) {
          pdf.addPage();
          y = 15;
        }
      });

    // Footer
    y = pageHeight - 10;
    pdf.setFontSize(8);
    pdf.setTextColor(150, 150, 150);
    pdf.text(`Generated on ${new Date().toLocaleString('en-US')}`, pageWidth / 2, y, { align: 'center' });

    // Convert PDF to base64
    const pdfData = pdf.output('arraybuffer');
    const base64PDF = btoa(String.fromCharCode(...new Uint8Array(pdfData)));

    // Upload to base44
    const uploadRes = await base44.integrations.Core.UploadFile({
      file: `data:application/pdf;base64,${base64PDF}`,
    });

    return Response.json({
      success: true,
      file_url: uploadRes.file_url,
      metrics: { total, wins, losses, winRate, totalPnL, maxDD },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});