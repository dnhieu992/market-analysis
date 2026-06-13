// Quick script to verify UT Bot formula against TradingView
// Run: node verify-utbot.js

const https = require('https');

function fetchKlines(symbol, interval, limit) {
  return new Promise((resolve, reject) => {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

function calcRmaAtr(candles, period) {
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prev = candles[i - 1];
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
  });

  const atr = new Array(candles.length).fill(0);
  if (candles.length < period) return atr;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  atr[period - 1] = sum / period;

  for (let i = period; i < candles.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  return atr;
}

function calcUtBotTrailingStop(candles, period, multiplier) {
  const atr = calcRmaAtr(candles, period);
  const stop = new Array(candles.length).fill(0);

  for (let i = 0; i < candles.length; i++) {
    const close = candles[i].close;
    const nLoss = atr[i] * multiplier;
    if (nLoss === 0) continue;

    const prevStop = i > 0 ? stop[i - 1] : 0;
    const prevClose = i > 0 ? candles[i - 1].close : 0;

    if (close > prevStop && prevClose > prevStop) {
      stop[i] = Math.max(prevStop, close - nLoss);
    } else if (close < prevStop && prevClose < prevStop) {
      stop[i] = Math.min(prevStop, close + nLoss);
    } else if (close > prevStop) {
      stop[i] = close - nLoss;
    } else {
      stop[i] = close + nLoss;
    }
  }
  return stop;
}

async function verify(symbol, interval, period, multiplier) {
  console.log(`\n=== ${symbol} ${interval} (ATR period=${period}, mult=${multiplier}) ===`);
  const klines = await fetchKlines(symbol, interval, 220);

  const candles = klines.map(k => ({
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    openTime: new Date(k[0]).toISOString(),
  }));

  const stop = calcUtBotTrailingStop(candles, period, multiplier);

  // Show last 5 bars
  const last = candles.length - 1;
  console.log('Last 5 bars (newest last):');
  for (let i = last - 4; i <= last; i++) {
    const c = candles[i];
    const s = stop[i];
    const trend = c.close > s ? 'BULL ↑' : 'BEAR ↓';
    const isLast = i === last ? ' ← CURRENT (may be incomplete)' : '';
    console.log(`  [${i === last - 1 ? 'PREV CLOSED' : i === last ? 'CURRENT    ' : '           '}] ${c.openTime.slice(0,16)} | close=${c.close.toFixed(2)} | stop=${s.toFixed(2)} | ${trend}${isLast}`);
  }

  // Result based on last CLOSED candle (index last-1) vs last candle
  const closedIdx = last - 1; // last confirmed closed candle
  const closedTrend = candles[closedIdx].close > stop[closedIdx] ? 'BULL' : 'BEAR';
  const currentTrend = candles[last].close > stop[last] ? 'BULL' : 'BEAR';
  console.log(`\n  Using CURRENT bar  (last in array): ${currentTrend}  close=${candles[last].close.toFixed(2)} stop=${stop[last].toFixed(2)}`);
  console.log(`  Using CLOSED bar (second-to-last): ${closedTrend}  close=${candles[closedIdx].close.toFixed(2)} stop=${stop[closedIdx].toFixed(2)}`);
}

(async () => {
  // Test with HPotter defaults: ATR=10, mult=1
  await verify('BTCUSDT', '1d', 10, 1);
  await verify('BTCUSDT', '4h', 10, 1);
  await verify('ETHUSDT', '1d', 10, 1);
  await verify('ETHUSDT', '4h', 10, 1);

  // Also test with QuantNomad defaults: ATR=1, mult=3
  console.log('\n\n=== QuantNomad version (ATR=1, Key=3) ===');
  await verify('BTCUSDT', '1d', 1, 3);
  await verify('BTCUSDT', '4h', 1, 3);
  await verify('ETHUSDT', '1d', 1, 3);
  await verify('ETHUSDT', '4h', 1, 3);
})();
