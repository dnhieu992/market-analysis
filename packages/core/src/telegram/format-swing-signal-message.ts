export type SwingSignalInput = {
  symbol: string;
  rsi: number;
  currentPrice: number;
  tpPct?: number;
  slPct?: number;
};

export function formatSwingSignalMessage(input: SwingSignalInput): string {
  const { symbol, rsi, currentPrice, tpPct = 0.1, slPct = 0.1 } = input;
  const tp = currentPrice * (1 + tpPct);
  const sl = currentPrice * (1 - slPct);

  const fmt = (n: number) =>
    n >= 1000
      ? n.toLocaleString('en-US', { maximumFractionDigits: 2 })
      : n.toLocaleString('en-US', { maximumFractionDigits: 6 });

  return [
    `🔔 SWING SIGNAL — ${symbol} H4`,
    `RSI(14): ${rsi.toFixed(1)} — Oversold zone`,
    '',
    `💰 Current price: $${fmt(currentPrice)}`,
    `🎯 Take Profit:   $${fmt(tp)} (+${(tpPct * 100).toFixed(0)}%)`,
    `🛑 Stop Loss:     $${fmt(sl)} (-${(slPct * 100).toFixed(0)}%)`,
    '',
    '⚠️ Đây là tín hiệu tự động theo chiến lược RSI Reversal.'
  ].join('\n');
}
