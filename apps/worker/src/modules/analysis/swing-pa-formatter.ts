import type { SwingPaAnalysis, SwingTrend, SwingSetup } from './swing-pa-analyzer';

function fmtPrice(n: number): string {
  return n >= 1000
    ? n.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : n.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function trendIcon(trend: SwingTrend): string {
  if (trend === 'uptrend')   return '📈 UPTREND (HH + HL)';
  if (trend === 'downtrend') return '📉 DOWNTREND (LH + LL)';
  return '↔️ SIDEWAY — no clear structure';
}

function setupLabel(type: SwingSetup['type']): string {
  if (type === 'break-retest')     return 'Break &amp; Retest';
  if (type === 'pullback-hl')      return 'Pullback to HL/LH';
  if (type === 'liquidity-sweep')  return 'Liquidity Sweep';
  return 'None';
}

function confidenceBadge(c: 'high' | 'medium' | 'low'): string {
  if (c === 'high')   return '🔥 HIGH';
  if (c === 'medium') return '🟡 MEDIUM';
  return '⚪ LOW';
}

export function formatSwingPaMessage(a: SwingPaAnalysis): string {
  const sep = '━━━━━━━━━━━━━━━━━━━━';
  const lines: string[] = [];

  // ── Header ──────────────────────────────────────────────────────────────
  lines.push(`<b>📊 SWING PA — ${a.symbol}</b>  |  Daily  |  Pure Price Action`);
  lines.push(sep);

  // ── Trend ───────────────────────────────────────────────────────────────
  lines.push(`<b>TREND</b>: ${trendIcon(a.trend)}`);
  if (a.swingHighs.length >= 2) {
    lines.push(`  Highs: ${a.swingHighs.map(fmtPrice).join(' → ')}`);
  }
  if (a.swingLows.length >= 2) {
    lines.push(`  Lows:  ${a.swingLows.map(fmtPrice).join(' → ')}`);
  }
  if (a.trend !== 'sideway') {
    lines.push(`  Consecutive: ${a.consecutiveHhCount} HH / ${a.consecutiveHlCount} HL`);
  }

  // ── CHoCH ────────────────────────────────────────────────────────────────
  lines.push('');
  if (a.choch.detected) {
    lines.push(`⚠️ <b>CHoCH DETECTED</b>: ${a.choch.from.toUpperCase()} → ${a.choch.to.toUpperCase()}`);
    lines.push(`  Broken level: ${fmtPrice(a.choch.brokenLevel ?? 0)}`);
  } else {
    lines.push('🔵 CHoCH: Not detected');
  }

  // ── S/R Zones ────────────────────────────────────────────────────────────
  lines.push('');
  lines.push(`<b>KEY ZONES</b> (Weekly S/R):`);
  if (a.srZones.length === 0) {
    lines.push('  No significant zones found near price');
  } else {
    for (const z of a.srZones) {
      const icon  = z.role === 'resistance' ? '🔴' : '🟢';
      const label = z.role === 'resistance' ? 'R' : 'S';
      lines.push(`  ${icon} ${label}: ${fmtPrice(z.low)} – ${fmtPrice(z.high)}  (${z.touches}x tested)`);
    }
  }

  // ── Setup ────────────────────────────────────────────────────────────────
  lines.push('');
  lines.push(sep);
  if (a.setup.type === null) {
    lines.push('⚪ <b>NO ACTIVE SETUP</b>');
    for (const note of a.setup.notes) lines.push(`  ${note}`);
  } else {
    const dirIcon = a.setup.direction === 'long' ? '🟢 LONG' : '🔴 SHORT';
    lines.push(`⚡ <b>SETUP: ${setupLabel(a.setup.type)}</b>`);
    lines.push(`  Direction: ${dirIcon}   Confidence: ${confidenceBadge(a.setup.confidence)}`);
    lines.push('');
    for (const note of a.setup.notes) {
      lines.push(`  • ${note}`);
    }

    // Trade plan
    if (a.setup.entryZone ?? a.setup.stopLoss ?? a.setup.tp1) {
      lines.push('');
      lines.push('<b>TRADE PLAN:</b>');
      if (a.setup.entryZone) {
        lines.push(`  Entry:  ${fmtPrice(a.setup.entryZone[0])} – ${fmtPrice(a.setup.entryZone[1])}`);
      }
      if (a.setup.stopLoss !== null) {
        lines.push(`  SL:     ${fmtPrice(a.setup.stopLoss)}`);
      }
      if (a.setup.tp1 !== null) {
        lines.push(`  TP1:    ${fmtPrice(a.setup.tp1)}`);
      }
      if (a.setup.tp2 !== null) {
        lines.push(`  TP2:    ${fmtPrice(a.setup.tp2)}`);
      }
    }
  }

  // ── Footer ───────────────────────────────────────────────────────────────
  lines.push('');
  lines.push(sep);
  lines.push(`💰 Price: <b>$${fmtPrice(a.currentPrice)}</b>`);
  lines.push(`⚠️ Tín hiệu tự động — xác nhận trước khi vào lệnh`);

  return lines.join('\n');
}
