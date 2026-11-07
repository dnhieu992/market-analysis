"""Shared data + indicators for the spot +30% study (pure python)."""
import json, os, math, datetime

D = os.path.join(os.path.dirname(__file__), 'data')
DAY = 86400000


DD_ = os.path.join(os.path.dirname(__file__), 'data_dead')
DEAD = set(f[:-5] for f in os.listdir(DD_)) if os.path.isdir(DD_) else set()


def load(sym):
    path = os.path.join(DD_, f'{sym}.json') if sym in DEAD else os.path.join(D, f'{sym}.json')
    rows = json.load(open(path))
    return {
        't': [r[0] for r in rows], 'o': [r[1] for r in rows], 'h': [r[2] for r in rows],
        'l': [r[3] for r in rows], 'c': [r[4] for r in rows], 'v': [r[5] for r in rows],
        'dead': sym in DEAD,
    }


def coins(include_dead=True):
    live = [f[:-5] for f in os.listdir(D) if f.endswith('.json') and f != 'fng.json']
    return sorted(set(live) | (DEAD if include_dead else set()))


def ema(xs, n):
    out = [None] * len(xs)
    if len(xs) < n:
        return out
    k = 2 / (n + 1)
    e = sum(xs[:n]) / n
    out[n - 1] = e
    for i in range(n, len(xs)):
        e = xs[i] * k + e * (1 - k)
        out[i] = e
    return out


def sma(xs, n):
    out = [None] * len(xs)
    s = 0
    for i, x in enumerate(xs):
        s += x
        if i >= n:
            s -= xs[i - n]
        if i >= n - 1:
            out[i] = s / n
    return out


def rsi(xs, n=14):
    out = [None] * len(xs)
    if len(xs) <= n:
        return out
    g = l = 0
    for i in range(1, n + 1):
        d = xs[i] - xs[i - 1]
        g += max(d, 0); l += max(-d, 0)
    g /= n; l /= n
    out[n] = 100 - 100 / (1 + g / l) if l else 100
    for i in range(n + 1, len(xs)):
        d = xs[i] - xs[i - 1]
        g = (g * (n - 1) + max(d, 0)) / n
        l = (l * (n - 1) + max(-d, 0)) / n
        out[i] = 100 - 100 / (1 + g / l) if l else 100
    return out


def stdev(xs, n):
    out = [None] * len(xs)
    for i in range(n - 1, len(xs)):
        w = xs[i - n + 1:i + 1]
        m = sum(w) / n
        out[i] = math.sqrt(sum((x - m) ** 2 for x in w) / n)
    return out


def rolling_max(xs, n):
    from collections import deque
    out = [None] * len(xs); dq = deque()
    for i, x in enumerate(xs):
        while dq and xs[dq[-1]] <= x: dq.pop()
        dq.append(i)
        if dq[0] <= i - n: dq.popleft()
        out[i] = xs[dq[0]]
    return out


def rolling_min(xs, n):
    return [(-v if v is not None else None) for v in rolling_max([-x for x in xs], n)]


def atr(h, l, c, n):
    tr = [h[0] - l[0]] + [max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1])) for i in range(1, len(c))]
    out = [None] * len(c)
    if len(c) < n: return out
    a = sum(tr[:n]) / n; out[n - 1] = a
    for i in range(n, len(c)):
        a = (a * (n - 1) + tr[i]) / n; out[i] = a
    return out


def supertrend_bull(h, l, c, n=10, m=3):
    a = atr(h, l, c, n)
    out = [None] * len(c)
    up = dn = None; bull = True
    for i in range(len(c)):
        if a[i] is None: continue
        hl2 = (h[i] + l[i]) / 2
        bu = hl2 + m * a[i]; bl = hl2 - m * a[i]
        if up is None:
            up, dn = bu, bl
        else:
            up = bu if (bu < up or c[i - 1] > up) else up
            dn = bl if (bl > dn or c[i - 1] < dn) else dn
        if bull and c[i] < dn: bull = False
        elif not bull and c[i] > up: bull = True
        out[i] = bull
    return out


def weekly_rsi_daily(t, c, n=14):
    """RSI of weekly closes (weeks end Sunday UTC), mapped to each day = last COMPLETED week."""
    wk_close, wk_idx = [], []
    for i, ts in enumerate(t):
        d = datetime.datetime.utcfromtimestamp(ts / 1000)
        if d.weekday() == 6:  # Sunday close = week close
            wk_close.append(c[i]); wk_idx.append(i)
    wr = rsi(wk_close, n)
    we = ema(wk_close, 21)
    out_r = [None] * len(c); out_e = [None] * len(c); out_wc = [None] * len(c)
    j = -1
    for i in range(len(c)):
        while j + 1 < len(wk_idx) and wk_idx[j + 1] <= i: j += 1
        if j >= 0:
            out_r[i] = wr[j]; out_e[i] = we[j]; out_wc[i] = wk_close[j]
    return out_r, out_e, out_wc


def fng_map():
    d = json.load(open(os.path.join(D, 'fng.json')))['data']
    return {int(x['timestamp']) * 1000: int(x['value']) for x in d}


def outcome(x, i, target=1.30, horizon=365):
    """Entry at close i. Returns (days_to_hit or None, mdd_before_exit, ret_at_horizon_or_last, days_available).
    A delisted coin whose data ends inside the horizon counts as resolved (sold at its last close)."""
    c, h, l = x['c'], x['h'], x['l']
    e = c[i]; tp = e * target; mn = e
    end = min(len(c) - 1, i + horizon)
    for j in range(i + 1, end + 1):
        if l[j] < mn: mn = l[j]
        if h[j] >= tp:
            return j - i, mn / e - 1, target - 1, end - i
    avail = end - i
    if x.get('dead') and end == len(c) - 1: avail = horizon  # delisted: forced exit at last price
    return None, mn / e - 1, c[end] / e - 1, avail
