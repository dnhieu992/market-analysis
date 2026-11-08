"""Strategy C study, part 2: climax robustness grid, low-volume pullback, 180d volume profile (VAL/POC),
and S/R timing of Strategy A candidates (weekly RSI < 35). Same data / conventions as csr.py."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import random, statistics as st, datetime as dt
from csr import C, BR, VR, FEE, ctx, tol_of, vr, fwd, hit, first, next_res, sig_bounce, sig_breakout
from lib import sma

for x in C.values():
    x['sma50'] = sma(x['c'], 50); x['sma200'] = sma(x['c'], 200)


def climax(x, i, vmin, drop, wick, near=2.0, need_zone=True):
    h, l, c = x['h'][i], x['l'][i], x['c'][i]
    if h <= l or vr(x, i) < vmin or c > (1 - drop) * x['c'][i - 7]: return None
    if (min(x['o'][i], c) - l) / (h - l) < wick: return None
    if not need_zone: return dict(level=l, zs=ctx(x, i)[1])
    tol, zs = ctx(x, i)
    for p, s, _ in zs:
        if s >= 2 and abs(l / p - 1) <= near * tol: return dict(level=p, zs=zs)
    return None


def dryup(x, i):
    """Uptrend (close > SMA200, SMA50 > SMA200) pulls back to a support zone on LOW volume (≤0.7× avg), holds the close."""
    if not x['sma200'][i] or not x['sma50'][i] or x['c'][i] < x['sma200'][i] or x['sma50'][i] < x['sma200'][i]: return None
    if vr(x, i) > 0.7: return None
    tol, zs = ctx(x, i); l, c = x['l'][i], x['c'][i]
    for p, s, _ in zs:
        if s >= 2 and l <= p * (1 + tol) and c >= p and x['c'][i - 1] > p * (1 + tol): return dict(level=p, zs=zs)
    return None


VP = {}


def profile(x, i, days=180, bins=40):
    """Volume profile of the last `days` (typical price, quote volume) → (VAL, POC, VAH). Recomputed weekly."""
    key = (id(x), i - i % 7)
    if key in VP: return VP[key]
    j0 = max(0, i - days); lo = min(x['l'][j0:i + 1]); hi = max(x['h'][j0:i + 1])
    if hi <= lo: VP[key] = None; return None
    w = (hi - lo) / bins; vol = [0.0] * bins
    for j in range(j0, i + 1):
        tp = (x['h'][j] + x['l'][j] + x['c'][j]) / 3
        vol[min(int((tp - lo) / w), bins - 1)] += x['v'][j]
    poc = max(range(bins), key=lambda b: vol[b]); tot = sum(vol); a = b = poc; acc = vol[poc]
    while acc < 0.7 * tot and (a > 0 or b < bins - 1):
        va = vol[a - 1] if a > 0 else -1; vb = vol[b + 1] if b < bins - 1 else -1
        if va >= vb: a -= 1; acc += va
        else: b += 1; acc += vb
    VP[key] = (lo + a * w, lo + (poc + .5) * w, lo + (b + 1) * w)
    return VP[key]


def val_reclaim(x, i):
    """Low trades below the 180d value-area low, close back above it (failed breakdown), volume ≥ 1.5×."""
    p = profile(x, i)
    if not p or vr(x, i) < 1.5: return None
    val = p[0]
    if x['l'][i] < val <= x['c'][i] and x['c'][i - 1] > val: return dict(level=val, zs=ctx(x, i)[1])
    return None


def poc_test(x, i):
    p = profile(x, i)
    if not p: return None
    poc = p[1]; tol = tol_of(x, i)
    if x['l'][i] <= poc * (1 + tol) and x['c'][i] >= poc and x['c'][i - 1] > poc * (1 + tol): return dict(level=poc, zs=ctx(x, i)[1])
    return None


def scan(sigs, topn=100, minage=365, cooldown=10, filt=None):
    ev = {k: [] for k in sigs}; last = {}
    for t in sorted(BR):
        for s, k in VR[t].items():
            if k >= topn: continue
            x = C[s]; i = x['ix'][t]
            if i < minage or i >= len(x['c']) - 1 or x['vm'][i] is None or x['atr'][i] is None: continue
            if filt and not filt(x, i): continue
            for name, f in sigs.items():
                info = f(x, i)
                if info is None or i - last.get((s, name), -999) < cooldown: continue
                last[(s, name)] = i; ev[name].append((s, i, info))
    return ev


def line(name, rows):
    n = len(rows)
    if n == 0: print(f'{name:<34} 0'); return
    h10 = sum(hit(C[s], i, .10, 30) for s, i, _ in rows) / n
    h20 = sum(hit(C[s], i, .20, 60) for s, i, _ in rows) / n
    fr = [f for f in (first(C[s], i, .20, .15) for s, i, _ in rows) if f is not None]
    r10 = st.mean(fwd(C[s], i, C[s]['c'][i] * 1.10, 30)[0] for s, i, _ in rows)
    r20 = st.mean(fwd(C[s], i, C[s]['c'][i] * 1.20, 60)[0] for s, i, _ in rows)
    r30 = st.mean(fwd(C[s], i, C[s]['c'][i] * 1.30, 180)[0] for s, i, _ in rows)
    med = st.median(fwd(C[s], i, C[s]['c'][i] * 1.20, 60)[0] for s, i, _ in rows)
    yrs = {}
    for s, i, _ in rows: yrs.setdefault(dt.datetime.fromtimestamp(C[s]['t'][i] / 1000, dt.UTC).year, []).append(fwd(C[s], i, C[s]['c'][i] * 1.20, 60)[0])
    ys = ' '.join(f"{y % 100}:{st.mean(v) * 100:+.0f}({len(v)})" for y, v in sorted(yrs.items()))
    print(f"{name:<34}{n:>5} | {h10*100:4.0f}% {h20*100:4.0f}% {sum(fr)/max(len(fr),1)*100:4.0f}% | {r10*100:+5.1f}% {r20*100:+5.1f}% (med {med*100:+5.1f}%) {r30*100:+5.1f}% | {ys}")


HDR = f"{'tín hiệu':<34}{'mẫu':>5} | +10≤30 +20≤60 +20trước−15 | TP10/30 TP20/60 (median) TP30/180 | TP20/60 theo năm"

if __name__ == '__main__':
    rnd = random.Random(1)
    print('=== 1. Volume climax — độ bền khi nới ngưỡng (top 100 vol) ===\n' + HDR)
    grid = {}
    for vmin in (2.0, 2.5, 3.0):
        for drop in (0.10, 0.15, 0.20):
            for wick in (0.4, 0.5):
                grid[f'climax v≥{vmin} 7d≤−{int(drop*100)}% wick≥{wick}'] = (lambda vm, d, w: lambda x, i: climax(x, i, vm, d, w))(vmin, drop, wick)
    grid['climax v≥3 −15% wick.5 KHÔNG cần vùng HT'] = lambda x, i: climax(x, i, 3.0, .15, .5, need_zone=False)
    grid['sập −15%/7d, KHÔNG volume/râu (đối chứng)'] = lambda x, i: dict(level=0, zs=ctx(x, i)[1]) if x['c'][i] <= .85 * x['c'][i - 7] else None
    grid['ngẫu nhiên'] = lambda x, i: dict(level=0, zs=None) if rnd.random() < .05 else None
    ev = scan(grid)
    for k, rows in ev.items(): line(k, rows)

    print('\n=== 2. Các tín hiệu S/R + volume khác (top 100 vol) ===\n' + HDR)
    ev = scan({'pullback volume cạn (uptrend)': dryup, 'quét VAL 180d rồi đóng lại trên': val_reclaim, 'test POC 180d từ trên': poc_test})
    for k, rows in ev.items(): line(k, rows)

    print('\n=== 3. Timing cho coin chiến lược A (RSI tuần < 35), top 100 vol ===\n' + HDR)
    a_only = lambda x, i: x['wrsi'][i] is not None and x['wrsi'][i] < 35
    ev = scan({
        'A: mua ngay (ngày bất kỳ RSI W<35)': lambda x, i: dict(level=0, zs=None) if rnd.random() < .1 else None,
        'A + bật hỗ trợ có volume': sig_bounce,
        'A + bật hỗ trợ không cần volume': lambda x, i: sig_bounce(x, i, vmin=0),
        'A + breakout kháng cự volume': sig_breakout,
        'A + volume climax (v≥2.5, −10%)': lambda x, i: climax(x, i, 2.5, .10, .4),
    }, filt=a_only, cooldown=20)
    for k, rows in ev.items(): line(k, rows)
