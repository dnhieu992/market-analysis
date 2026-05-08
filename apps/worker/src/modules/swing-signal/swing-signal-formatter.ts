import type { SwingSignalAiResponse, BuySetup, Recommendation } from './swing-signal-validator';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmt(price: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  }).format(price);
}

function recommendationEmoji(rec: Recommendation): string {
  const map: Record<Recommendation, string> = {
    BUY_NOW: '🟢',
    WAIT_FOR_PULLBACK: '🟡',
    WAIT_FOR_BREAKOUT: '🔵',
    SKIP: ''
  };
  return map[rec] ?? '';
}

function formatSetup(setup: BuySetup, index: number): string {
  const tpLines = setup.take_profit
    .map((tp) => `   • $${fmt(tp.price)} (${tp.size_pct}%) — ${esc(tp.reason)}`)
    .join('\n');

  const warningLine =
    setup.warnings && setup.warnings.length > 0
      ? `\n⚠️ <i>${setup.warnings.map(esc).join(' | ')}</i>`
      : '';

  return [
    `<b>Setup ${index}: ${esc(setup.type)}</b> (${setup.confidence}/10)`,
    `📌 Entry: $${fmt(setup.entry_target)}`,
    `   Zone: $${fmt(setup.entry_zone[0])} – $${fmt(setup.entry_zone[1])}`,
    `🛑 SL: $${fmt(setup.stop_loss)}`,
    `   <i>${esc(setup.stop_loss_reason)}</i>`,
    `🎯 TP:`,
    tpLines,
    `📊 R:R: 1:${setup.risk_reward}`,
    `✨ Confluence: ${setup.confluence_factors.map(esc).join(', ')}`,
    `💭 ${esc(setup.reasoning)}`,
    warningLine
  ]
    .filter((line) => line !== '')
    .join('\n');
}

// ─── Main Formatter ───────────────────────────────────────────────────────────

export function formatSwingSignalBreakoutMessage(analysis: SwingSignalAiResponse): string {
  const emoji = recommendationEmoji(analysis.recommendation);

  const patternLines =
    analysis.patterns_detected.length > 0
      ? analysis.patterns_detected
          .map(
            (p) =>
              `• ${esc(p.name)} (${p.timeframe}) — Q:${p.quality_score}/10 — ${p.breakout_status}`
          )
          .join('\n')
      : '• No pattern detected';

  const trendAligned = analysis.trend_alignment.aligned ? '✅ Aligned' : '⚠️ Not aligned';
  const trendLine = [
    `W: ${esc(analysis.trend_alignment.weekly)}`,
    `D: ${esc(analysis.trend_alignment.daily)}`,
    `4H: ${esc(analysis.trend_alignment.fourHour)}`
  ].join(' | ');

  const setupSections = analysis.buy_setups
    .map((setup, i) => formatSetup(setup, i + 1))
    .join('\n\n');

  const riskLines =
    analysis.risk_factors.length > 0
      ? analysis.risk_factors.map((r) => `• ${esc(r)}`).join('\n')
      : '• Không có risk factor cụ thể';

  return [
    `${emoji} <b>${analysis.symbol}</b> — ${analysis.recommendation}`,
    '',
    `💰 Current: $${fmt(analysis.current_price)}`,
    `📊 Assessment: ${analysis.overall_assessment}`,
    '',
    `📈 <b>Trend Alignment:</b>`,
    trendLine,
    trendAligned,
    '',
    `🎯 <b>Patterns Detected:</b>`,
    patternLines,
    '',
    '═══════════════════════',
    '',
    setupSections,
    '',
    '═══════════════════════',
    '',
    `⚠️ <b>Risks:</b>`,
    riskLines,
    '',
    `📝 ${esc(analysis.summary)}`,
    '',
    `<i>DYOR. Not financial advice.</i>`
  ].join('\n');
}
