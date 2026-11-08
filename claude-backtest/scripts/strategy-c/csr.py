"""Strategy C study — support / resistance + volume on Binance spot alts (D1), 2022 → 2026-11.

Levels: swing pivots (k=5 bars each side, usable only k bars after the pivot = no look-ahead) of the
last 365 days, lows AND highs (role reversal), clustered into zones of width tol = clamp(0.5×ATR%, 1.5%, 5%).
Zone strength = number of pivots in it. Volume ratio = today's quote volume / SMA20 of the previous 20 days.

Usage: SPOT_DATA=<data root> python3 -I csr.py   (imports altsim from this script's own folder)
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.chdir(os.environ['SPOT_DATA'])
import random, statistics as st, datetime as dt
from altsim import C, BR, VR, DAY, FEE
from lib import atr

K = 5
LOOKBACK = 365
COOLDOWN = 10  # days before the same signal can fire again on a coin


def pivots(x):
    h, l = x['h'], x['l']; n = len(h); out = []  # (confirm_idx, idx, price)
    for j in range(K, n - K):
        if h[j] == max(h[j - K:j + K + 1]): out.append((j + K, j, h[j]))
        if l[j] == min(l[j - K:j + K + 1]): out.append((j + K, j, l[j]))
    return out


def zones_at(piv, i, tol):
    """Zones from pivots confirmed by day i (and inside the lookback): list of (price, strength, last_idx)."""
    ps = sorted((p, j) for ci, j, p in piv if ci <= i and j >= i - LOOKBACK)
    zs = []; cur = []
    for p, j in ps:
        if cur and p > cur[0][0] * (1 + tol):
            zs.append(cur); cur = []
        cur.append((p, j))
    if cur: zs.append(cur)
    return [(st.mean(p for p, _ in z), len(z), max(j for _, j in z)) for z in zs]


def prep(x):
    n = len(x['c']); a = atr(x['h'], x['l'], x['c'], 14)
    v = x['v']; vm = [None] * n; s = 0
    for i in range(n):
        if i >= 20: vm[i] = s / 20  # mean of the 20 days BEFORE i
        s += v[i]
        if i >= 20: s -= v[i - 20]
    x['atr'] = a; x['vm'] = vm; x['piv'] = pivots(x)


for x in C.values(): prep(x)


def vr(x, i):
    return x['v'][i] / x['vm'][i] if x['vm'][i] else 0


def tol_of(x, i):
    return min(max(0.5 * x['atr'][i] / x['c'][i], 0.015), 0.05) if x['atr'][i] else 0.03


_CTX = {}


def ctx(x, i):
    """Signal context at day i: tolerance + zones (cached per coin/day)."""
    key = (id(x), i)
    if key not in _CTX:
        tol = tol_of(x, i); _CTX[key] = (tol, zones_at(x['piv'], i, tol))
    return _CTX[key]


def next_res(zs, price, minstr=2, mingain=0.08):
    up = [z for z in zs if z[1] >= minstr and z[0] >= price * (1 + mingain)]
    return min(up)[0] if up else None


# ---- signals: return (fires: bool, info dict) -------------------------------------------------------
def sig_bounce(x, i, vmin=1.5, minstr=2):
    """Test of a support zone from above: low pierces into the zone, close back above it, close in the upper half."""
    tol, zs = ctx(x, i); h, l, c = x['h'][i], x['l'][i], x['c'][i]
    if h <= l or (c - l) / (h - l) < 0.5 or vr(x, i) < vmin: return None
    for p, s, last in zs:
        if s >= minstr and l <= p * (1 + tol) and c >= p and x['c'][i - 1] > p * (1 + tol) and l >= p * (1 - 2 * tol):
            return dict(level=p, str=s, zs=zs)
    return None


def sig_breakout(x, i, vmin=2.0, minstr=2):
    """Close above a resistance zone that capped the last 20 closes, on high volume."""
    if vr(x, i) < vmin: return None
    tol, zs = ctx(x, i); c = x['c'][i]
    prev_max = max(x['c'][i - 20:i])
    for p, s, last in zs:
        if s >= minstr and prev_max < p * (1 + tol) and c > p * (1 + tol) and c < p * (1 + 4 * tol):
            return dict(level=p, str=s, zs=zs)
    return None


BO = {}  # (coin) -> list of (idx, level) breakouts seen so far, filled by the scan in time order


def sig_retest(x, i, s_name):
    """Pull back to a level broken out of 3–20 days ago (high volume breakout), hold it on the close."""
    tol = tol_of(x, i); l, c = x['l'][i], x['c'][i]
    for bi, p in BO.get(s_name, []):
        if 3 <= i - bi <= 20 and l <= p * (1 + tol) and c >= p and l >= p * (1 - 2 * tol):
            if min(x['c'][bi + 1:i]) >= p * (1 - tol):  # never closed back below the level in between
                _, zs = ctx(x, i)
                return dict(level=p, str=0, zs=zs)
    return None


def sig_climax(x, i, vmin=3.0):
    """Selling climax at support: −15% in 7d, volume ≥3× avg, long lower wick (≥50% of range), near a zone."""
    h, l, c = x['h'][i], x['l'][i], x['c'][i]
    if h <= l or vr(x, i) < vmin or c > 0.85 * x['c'][i - 7]: return None
    if (min(x['o'][i], c) - l) / (h - l) < 0.5: return None
    tol, zs = ctx(x, i)
    for p, s, last in zs:
        if s >= 2 and abs(l / p - 1) <= 2 * tol:
            return dict(level=p, str=s, zs=zs)
    return None


# ---- forward outcome from the close of day i ----------------------------------------------------------
def fwd(x, i, tp, horizon, sl=None):
    """Return after fees: TP (high touch) / SL (low touch, counted first on the same bar) / close at horizon or delist."""
    e = x['c'][i]; end = min(len(x['c']) - 1, i + horizon)
    for j in range(i + 1, end + 1):
        if sl and x['l'][j] <= sl: return sl / e * (1 - FEE) ** 2 - 1, j - i, 'sl'
        if tp and x['h'][j] >= tp: return tp / e * (1 - FEE) ** 2 - 1, j - i, 'tp'
    return x['c'][end] / e * (1 - FEE) ** 2 - 1, end - i, 'time'


def hit(x, i, gain, horizon):
    e = x['c'][i]; end = min(len(x['c']) - 1, i + horizon)
    return any(x['h'][j] >= e * (1 + gain) for j in range(i + 1, end + 1))


def first(x, i, up, dn, horizon=180):
    e = x['c'][i]; end = min(len(x['c']) - 1, i + horizon)
    for j in range(i + 1, end + 1):
        if x['l'][j] <= e * (1 - dn): return False
        if x['h'][j] >= e * (1 + up): return True
    return None


def scan(topn=100, minage=365, start=dt.datetime(2022, 1, 1), gate=None):
    s0 = start.timestamp() * 1000
    ev = {k: [] for k in ('random', 'bounce', 'bounce_novol', 'bounce_v2', 'breakout', 'breakout_novol', 'retest', 'climax')}
    last = {}; rnd = random.Random(1); BO.clear()
    for t in sorted(t for t in BR if t >= s0):
        if gate and not gate(BR[t]): continue
        for s, k in VR[t].items():
            if k >= topn: continue
            x = C[s]; i = x['ix'][t]
            if i < minage or i >= len(x['c']) - 1 or x['vm'][i] is None or x['atr'][i] is None: continue
            if rnd.random() < 0.05: ev['random'].append((s, i, None))
            res = {
                'bounce': sig_bounce(x, i), 'bounce_novol': sig_bounce(x, i, vmin=0), 'bounce_v2': sig_bounce(x, i, vmin=2.0, minstr=3),
                'breakout': sig_breakout(x, i), 'breakout_novol': sig_breakout(x, i, vmin=0),
                'retest': sig_retest(x, i, s), 'climax': sig_climax(x, i),
            }
            if res['breakout']: BO.setdefault(s, []).append((i, res['breakout']['level']))
            for name, info in res.items():
                if info is None: continue
                if i - last.get((s, name), -999) < COOLDOWN: continue
                last[(s, name)] = i; ev[name].append((s, i, info))
    return ev


def report(ev, title):
    print(f'\n=== {title} ===')
    print(f"{'tín hiệu':<16}{'mẫu':>6}{'/năm':>6} | {'+10%≤30d':>9}{'+20%≤60d':>9}{'+30%≤90d':>9}{'+20 trước −15':>14} | "
          f"{'TP10/30d':>9}{'TP20/60d':>9}{'TPres/60d':>10}{'TP30/180d':>10}{'res≥8%':>7}{'SLzone':>8}")
    yrs = 4.85
    for name, rows in ev.items():
        if not rows: continue
        n = len(rows)
        h10 = sum(hit(C[s], i, .10, 30) for s, i, _ in rows) / n
        h20 = sum(hit(C[s], i, .20, 60) for s, i, _ in rows) / n
        h30 = sum(hit(C[s], i, .30, 90) for s, i, _ in rows) / n
        fr = [first(C[s], i, .20, .15) for s, i, _ in rows]; fr = [f for f in fr if f is not None]
        r10 = st.mean(fwd(C[s], i, C[s]['c'][i] * 1.10, 30)[0] for s, i, _ in rows)
        r20 = st.mean(fwd(C[s], i, C[s]['c'][i] * 1.20, 60)[0] for s, i, _ in rows)
        r30 = st.mean(fwd(C[s], i, C[s]['c'][i] * 1.30, 180)[0] for s, i, _ in rows)
        # TP at the next strong resistance zone (≥ +8%), else +20%; with/without SL just under the signal zone
        rres, rsl, nres = [], [], 0
        for s, i, info in rows:
            x = C[s]; e = x['c'][i]
            zs = info['zs'] if info else ctx(x, i)[1]
            r = next_res(zs, e); nres += r is not None
            tp = r if r else e * 1.20
            rres.append(fwd(x, i, tp, 60)[0])
            if info: rsl.append(fwd(x, i, tp, 60, sl=info['level'] * (1 - 2 * tol_of(x, i)))[0])
        print(f"{name:<16}{n:>6}{n / yrs:>6.0f} | {h10*100:>8.0f}%{h20*100:>8.0f}%{h30*100:>8.0f}%{(sum(fr)/len(fr) if fr else 0)*100:>13.0f}% | "
              f"{r10*100:>+8.1f}%{r20*100:>+8.1f}%{st.mean(rres)*100:>+9.1f}%{r30*100:>+9.1f}%{nres/n*100:>6.0f}%"
              f"{(st.mean(rsl)*100 if rsl else float('nan')):>+7.1f}%")


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'all'
    ev = scan()
    report(ev, 'Top 100 alt theo volume, niêm yết ≥ 1 năm, 2022-01 → 2026-11, mọi chế độ thị trường')
    for name in ('bounce', 'breakout', 'retest', 'climax'):
        rows = ev[name]; by = {}
        for s, i, _ in rows:
            y = dt.datetime.utcfromtimestamp(C[s]['t'][i] / 1000).year
            by.setdefault(y, []).append(fwd(C[s], i, C[s]['c'][i] * 1.20, 60)[0])
        print(f"  {name:<10} TP20/60d theo năm: " + ' '.join(f"{y}: {st.mean(v)*100:+.1f}% ({len(v)})" for y, v in sorted(by.items())))
    ev2 = scan(gate=lambda b: b['w35'] >= .25)
    report(ev2, 'Như trên nhưng chỉ khi breadth (alt RSI W<35) ≥ 25% — mùa mua của chiến lược A')
    ev3 = scan(gate=lambda b: b['w35'] < .10)
    report(ev3, 'Chỉ khi breadth < 10% (thị trường nóng)')
