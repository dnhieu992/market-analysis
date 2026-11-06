/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
/**
 * The program that runs INSIDE the backtest container (node:22-alpine, no network, no env, uid 65534).
 * It is never called in the API process: `RUNNER_SOURCE` serialises this function with
 * `Function.prototype.toString()` and hands it to `node -e`, so the body must be fully
 * self-contained — no imports, no closures over module scope.
 *
 * Protocol: stdin = one JSON object { code, ctx: { data, symbols, intervals, params, fromMs, toMs,
 * feePctPerSide, capitalUsd }, timeoutMs }. stdout = one JSON object
 * { ok: true, result, logs } | { ok: false, error, stack, logs }.
 *
 * `@app/core`'s compiled dist is bind-mounted read-only at /sandbox/core so the strategy uses the
 * exact QQE / Supertrend / UT Bot the app uses.
 */
function sandboxMain(): void {
  const vm = require('node:vm');
  const chunks: Buffer[] = [];
  const logs: string[] = [];
  const write = (o: unknown) => process.stdout.write(JSON.stringify(o));

  const log = (...args: unknown[]) => {
    if (logs.length >= 300) return;
    logs.push(
      args
        .map((a) => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()))
        .join(' ')
        .slice(0, 600),
    );
  };

  let core: any = null;
  let coreError: string | null = null;
  try {
    core = require('/sandbox/core/index.js');
  } catch (e: any) {
    coreError = String(e?.message ?? e);
  }

  // ---------------- ta: series helpers, every output aligned 1:1 with its input (NaN in warm-up) ----------------
  const nan = (n: number) => new Array(n).fill(NaN);
  const src = (s: any): number[] => {
    if (!Array.isArray(s)) throw new Error('ta: expected an array');
    return s.length && typeof s[0] === 'object' ? s.map((c: any) => c.close) : s;
  };
  const ta: Record<string, any> = {
    closes: (c: any[]) => c.map((x) => x.close),
    opens: (c: any[]) => c.map((x) => x.open),
    highs: (c: any[]) => c.map((x) => x.high),
    lows: (c: any[]) => c.map((x) => x.low),
    volumes: (c: any[]) => c.map((x) => x.volume),
    sma(s: any, n: number) {
      const v = src(s);
      const out = nan(v.length);
      let sum = 0;
      for (let i = 0; i < v.length; i++) {
        sum += v[i]!;
        if (i >= n) sum -= v[i - n]!;
        if (i >= n - 1) out[i] = sum / n;
      }
      return out;
    },
    /** Pine `ta.ema`: seeded with the SMA of the first n values. */
    ema(s: any, n: number) {
      const v = src(s);
      const out = nan(v.length);
      const k = 2 / (n + 1);
      let start = v.findIndex((x) => Number.isFinite(x));
      if (start < 0 || v.length - start < n) return out;
      let e = 0;
      for (let i = start; i < start + n; i++) e += v[i]!;
      e /= n;
      out[start + n - 1] = e;
      for (let i = start + n; i < v.length; i++) {
        e = v[i]! * k + e * (1 - k);
        out[i] = e;
      }
      return out;
    },
    /** Wilder's RMA (Pine `ta.rma`), seeded with an SMA. */
    rma(s: any, n: number) {
      const v = src(s);
      const out = nan(v.length);
      let start = v.findIndex((x) => Number.isFinite(x));
      if (start < 0 || v.length - start < n) return out;
      let r = 0;
      for (let i = start; i < start + n; i++) r += v[i]!;
      r /= n;
      out[start + n - 1] = r;
      for (let i = start + n; i < v.length; i++) {
        r = (r * (n - 1) + v[i]!) / n;
        out[i] = r;
      }
      return out;
    },
    /** Wilder RSI (TradingView's). */
    rsi(s: any, n = 14) {
      const v = src(s);
      const out = nan(v.length);
      if (v.length <= n) return out;
      let g = 0;
      let l = 0;
      for (let i = 1; i <= n; i++) {
        const d = v[i]! - v[i - 1]!;
        if (d >= 0) g += d;
        else l -= d;
      }
      g /= n;
      l /= n;
      out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
      for (let i = n + 1; i < v.length; i++) {
        const d = v[i]! - v[i - 1]!;
        g = (g * (n - 1) + Math.max(d, 0)) / n;
        l = (l * (n - 1) + Math.max(-d, 0)) / n;
        out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
      }
      return out;
    },
    tr(c: any[]) {
      return c.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close))));
    },
    atr(c: any[], n = 14) {
      return ta.rma(ta.tr(c), n);
    },
    stdev(s: any, n: number) {
      const v = src(s);
      const m = ta.sma(v, n);
      return v.map((_, i) => {
        if (i < n - 1) return NaN;
        let acc = 0;
        for (let j = i - n + 1; j <= i; j++) acc += (v[j]! - m[i]!) ** 2;
        return Math.sqrt(acc / n);
      });
    },
    bb(s: any, n = 20, mult = 2) {
      const mid = ta.sma(s, n);
      const sd = ta.stdev(s, n);
      return { mid, upper: mid.map((m: number, i: number) => m + mult * sd[i]), lower: mid.map((m: number, i: number) => m - mult * sd[i]) };
    },
    macd(s: any, fast = 12, slow = 26, signal = 9) {
      const f = ta.ema(s, fast);
      const sl = ta.ema(s, slow);
      const line = f.map((x: number, i: number) => x - sl[i]);
      const first = line.findIndex((x: number) => Number.isFinite(x));
      const sig = nan(line.length);
      if (first >= 0) ta.ema(line.slice(first), signal).forEach((x: number, i: number) => (sig[first + i] = x));
      return { macd: line, signal: sig, hist: line.map((x: number, i: number) => x - sig[i]!) };
    },
    highest(s: any, n: number) {
      const v = src(s);
      return v.map((_, i) => (i < n - 1 ? NaN : Math.max(...v.slice(i - n + 1, i + 1))));
    },
    lowest(s: any, n: number) {
      const v = src(s);
      return v.map((_, i) => (i < n - 1 ? NaN : Math.min(...v.slice(i - n + 1, i + 1))));
    },
    crossover: (a: number[], b: number[] | number, i: number) => {
      const b0 = typeof b === 'number' ? b : b[i]!;
      const b1 = typeof b === 'number' ? b : b[i - 1]!;
      return i > 0 && a[i - 1]! <= b1 && a[i]! > b0;
    },
    crossunder: (a: number[], b: number[] | number, i: number) => {
      const b0 = typeof b === 'number' ? b : b[i]!;
      const b1 = typeof b === 'number' ? b : b[i - 1]!;
      return i > 0 && a[i - 1]! >= b1 && a[i]! < b0;
    },
    pct: (from: number, to: number) => ((to - from) / from) * 100,
    /** Pivot highs/lows with `left`/`right` bars each side. A pivot is only KNOWN at `confirmedIndex` (= index + right). */
    pivots(c: any[], left = 3, right = 3) {
      const highs: any[] = [];
      const lows: any[] = [];
      for (let i = left; i < c.length - right; i++) {
        let isH = true;
        let isL = true;
        for (let j = i - left; j <= i + right; j++) {
          if (j === i) continue;
          if (c[j].high >= c[i].high) isH = false;
          if (c[j].low <= c[i].low) isL = false;
        }
        if (isH) highs.push({ index: i, price: c[i].high, time: c[i].time, confirmedIndex: i + right });
        if (isL) lows.push({ index: i, price: c[i].low, time: c[i].time, confirmedIndex: i + right });
      }
      return { highs, lows };
    },
    /** Index of the last candle of `c` that had CLOSED at `timeMs` (−1 if none) — use it to read a higher timeframe without look-ahead. */
    lastClosedIndex(c: any[], timeMs: number) {
      let lo = 0;
      let hi = c.length - 1;
      let ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (c[mid].closeTime <= timeMs) {
          ans = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      return ans;
    },
    /** Index of the first candle opening at/after `timeMs` (c.length if none). */
    indexAtOrAfter(c: any[], timeMs: number) {
      let lo = 0;
      let hi = c.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (c[mid].time < timeMs) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    },
    // ---- the app's own indicators (@app/core) ----
    /** colinmck QQE with the app's params (RSI 10 / smoothing 4 / factor 3.2). → { rsiMa, signal, cross: 'long'|'short'|null } */
    qqe(s: any, rsiPeriod = 10, smoothing = 4, factor = 3.2) {
      if (!core) throw new Error(`@app/core unavailable: ${coreError}`);
      return core.calculateQqe(src(s), rsiPeriod, smoothing, factor);
    },
    /** Pine ta.supertrend. → [{ value, bullish, upperBand, lowerBand }] */
    supertrend(c: any[], period = 10, mult = 3) {
      if (!core) throw new Error(`@app/core unavailable: ${coreError}`);
      return core.calcSupertrend(c, period, mult);
    },
    /** UT Bot (ATR trailing stop). → [{ uptrend, buySignal, sellSignal, stopLevel }] */
    utbot(c: any[], atrPeriod = 10, keyValue = 1) {
      if (!core) throw new Error(`@app/core unavailable: ${coreError}`);
      return core.calcUtBotSignals(c, atrPeriod, keyValue);
    },
    /** → { k, d } */
    stochRsi(s: any, rsiLen = 14, stochLen = 14, smoothK = 3, smoothD = 3) {
      if (!core) throw new Error(`@app/core unavailable: ${coreError}`);
      return core.calculateStochRsi(src(s), rsiLen, stochLen, smoothK, smoothD);
    },
  };

  process.stdin.on('data', (c: Buffer) => chunks.push(c));
  process.stdin.on('end', () => {
    let input: any;
    try {
      input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (e: any) {
      write({ ok: false, error: `Bad sandbox input: ${e?.message}`, logs });
      return;
    }
    const ctx = Object.freeze({ ...input.ctx, log });
    const sandbox = vm.createContext(
      { __ctx: ctx, __ta: ta, __core: core, console: { log } },
      { codeGeneration: { strings: false, wasm: false } },
    );
    const wrapped = `"use strict";\n(function (ctx, ta, core) {\n${input.code}\n})(__ctx, __ta, __core);`;
    try {
      const script = new vm.Script(wrapped, { filename: 'strategy.js', lineOffset: -2 });
      const result = script.runInContext(sandbox, { timeout: input.timeoutMs ?? 60_000 });
      if (result && typeof result.then === 'function') throw new Error('Code phải chạy đồng bộ (không async/Promise).');
      const trades = Array.isArray(result?.trades) ? result.trades.slice(0, 20_000) : null;
      write({
        ok: true,
        result: { trades, tradesTotal: Array.isArray(result?.trades) ? result.trades.length : null, summary: result?.summary ?? null },
        logs,
      });
    } catch (e: any) {
      const stack = String(e?.stack ?? '')
        .split('\n')
        .filter((l) => l.includes('strategy.js'))
        .slice(0, 5)
        .join('\n');
      write({ ok: false, error: String(e?.message ?? e), stack, logs });
    }
  });
}

/** The container's `node -e` program. */
export const RUNNER_SOURCE = `(${sandboxMain.toString()})();`;
