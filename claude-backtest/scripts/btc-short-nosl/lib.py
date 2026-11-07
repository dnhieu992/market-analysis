import csv, math, os
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
NAN = float('nan')
MS = {'15m': 900_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000}
START_2024 = 1704067200000


def load(iv):
    rows = []
    with open(os.path.join(HERE, 'data', f'{iv}.csv')) as f:
        r = csv.reader(f); next(r)
        for t, o, h, l, c, v in r:
            rows.append((int(t), float(o), float(h), float(l), float(c), float(v)))
    return {
        't': [x[0] for x in rows], 'o': [x[1] for x in rows], 'h': [x[2] for x in rows],
        'l': [x[3] for x in rows], 'c': [x[4] for x in rows], 'v': [x[5] for x in rows], 'iv': iv,
    }


def utc(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)


# ---------- indicators (lists aligned with bars, NaN until warm) ----------
def sma(src, n):
    out = [NAN] * len(src); s = 0.0
    for i, x in enumerate(src):
        s += x
        if i >= n: s -= src[i - n]
        if i >= n - 1: out[i] = s / n
    return out


def ema(src, n, seed_sma=True):
    out = [NAN] * len(src); k = 2 / (n + 1); prev = NAN; start = None
    for i, x in enumerate(src):
        if math.isnan(x): continue
        if start is None: start = i
        if math.isnan(prev):
            if i - start + 1 == n:
                prev = sum(src[start:i + 1]) / n; out[i] = prev
            continue
        prev = x * k + prev * (1 - k); out[i] = prev
    return out


def rma(src, n):
    out = [NAN] * len(src); prev = NAN; start = None
    for i, x in enumerate(src):
        if math.isnan(x): continue
        if start is None: start = i
        if math.isnan(prev):
            if i - start + 1 == n:
                prev = sum(src[start:i + 1]) / n; out[i] = prev
            continue
        prev = (prev * (n - 1) + x) / n; out[i] = prev
    return out


def rsi(c, n=14):
    g = [NAN] + [max(c[i] - c[i - 1], 0) for i in range(1, len(c))]
    d = [NAN] + [max(c[i - 1] - c[i], 0) for i in range(1, len(c))]
    ag, ad = rma(g, n), rma(d, n)
    out = [NAN] * len(c)
    for i in range(len(c)):
        if math.isnan(ag[i]): continue
        out[i] = 100.0 if ad[i] == 0 else 100 - 100 / (1 + ag[i] / ad[i])
    return out


def stdev(src, n):
    out = [NAN] * len(src)
    for i in range(n - 1, len(src)):
        w = src[i - n + 1:i + 1]; m = sum(w) / n
        out[i] = math.sqrt(sum((x - m) ** 2 for x in w) / n)
    return out


def atr(b, n=14):
    tr = [b['h'][0] - b['l'][0]] + [
        max(b['h'][i] - b['l'][i], abs(b['h'][i] - b['c'][i - 1]), abs(b['l'][i] - b['c'][i - 1]))
        for i in range(1, len(b['c']))]
    return rma(tr, n)


def stoch_rsi(c, rsi_n=14, st_n=14, k=3, d=3):
    r = rsi(c, rsi_n); raw = [NAN] * len(c)
    for i in range(len(c)):
        w = r[max(0, i - st_n + 1):i + 1]
        if i < st_n - 1 or any(math.isnan(x) for x in w): continue
        lo, hi = min(w), max(w)
        raw[i] = 0 if hi == lo else (r[i] - lo) / (hi - lo) * 100
    K = sma_nan(raw, k); D = sma_nan(K, d)
    return K, D


def sma_nan(src, n):
    out = [NAN] * len(src)
    for i in range(n - 1, len(src)):
        w = src[i - n + 1:i + 1]
        if any(math.isnan(x) for x in w): continue
        out[i] = sum(w) / n
    return out


def macd(c, f=12, s=26, sig=9):
    ef, es = ema(c, f), ema(c, s)
    m = [a - b if not (math.isnan(a) or math.isnan(b)) else NAN for a, b in zip(ef, es)]
    sg = ema(m, sig)
    return m, sg


def supertrend(b, n=10, mult=3.0):
    a = atr(b, n); L = len(b['c']); bull = [None] * L
    up = dn = NAN; trend = 1
    for i in range(L):
        if math.isnan(a[i]): continue
        hl2 = (b['h'][i] + b['l'][i]) / 2
        bu, bd = hl2 - mult * a[i], hl2 + mult * a[i]
        if not math.isnan(up) and b['c'][i - 1] > up: bu = max(bu, up)
        if not math.isnan(dn) and b['c'][i - 1] < dn: bd = min(bd, dn)
        if trend == 1 and b['c'][i] < bu: trend = -1
        elif trend == -1 and b['c'][i] > bd: trend = 1
        up, dn = bu, bd; bull[i] = trend == 1
    return bull


def qqe(c, rsi_n=10, smooth=4, factor=3.2):
    """Standard QQE: RSI smoothed by EMA, Wilder-ATR of RSI-MA as a trailing band. cross: 'short' when rsiMa crosses below the trail."""
    r = rsi(c, rsi_n); rm = ema(r, smooth); wl = rsi_n * 2 - 1
    d = [NAN] + [abs(rm[i] - rm[i - 1]) if not (math.isnan(rm[i]) or math.isnan(rm[i - 1])) else NAN for i in range(1, len(c))]
    ma1 = ema(d, wl); dar = ema(ma1, wl)
    L = len(c); trail = [NAN] * L; cross = [None] * L
    long_b = short_b = NAN; tr = 0
    for i in range(L):
        if math.isnan(dar[i]) or math.isnan(rm[i]): continue
        dv = dar[i] * factor; nl, ns = rm[i] - dv, rm[i] + dv
        pr = rm[i - 1]
        if not math.isnan(long_b) and pr > long_b and rm[i] > long_b: nl = max(nl, long_b)
        if not math.isnan(short_b) and pr < short_b and rm[i] < short_b: ns = min(ns, short_b)
        prev_tr = tr
        if not math.isnan(short_b) and rm[i] > short_b: tr = 1
        elif not math.isnan(long_b) and rm[i] < long_b: tr = -1
        elif tr == 0: tr = 1
        long_b, short_b = nl, ns
        trail[i] = nl if tr == 1 else ns
        if prev_tr == 1 and tr == -1: cross[i] = 'short'
        elif prev_tr == -1 and tr == 1: cross[i] = 'long'
    return rm, trail, cross


def last_closed_idx(bars_t, ms_iv, t_ms):
    """index of last bar of a TF whose close (t+ms) <= t_ms — binary search."""
    lo, hi, ans = 0, len(bars_t) - 1, -1
    while lo <= hi:
        mid = (lo + hi) // 2
        if bars_t[mid] + ms_iv <= t_ms: ans = mid; lo = mid + 1
        else: hi = mid - 1
    return ans
