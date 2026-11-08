"""Strategy C portfolio sim: volume climax at support (D1 spot alts, top-N by volume, 2022-01 → 2026-11).
Buy at the signal close, one entry, TP on high, time exit at close, optional SL under the support zone.
Fee 0.1%/side (spot). Delisted coin = sold at its last close."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import datetime as dt, statistics as st
from csr import C, BR, VR, FEE, DAY, tol_of, next_res, ctx
from csr2 import climax


def sim(vmin=2.5, drop=.15, wick=.4, slots=5, tp=.20, hold=60, sl=False, topn=100, tpres=False, start=dt.datetime(2022, 1, 1), gate=None):
    s0 = start.timestamp() * 1000; days = sorted(t for t in BR if t >= s0)
    cash = 1.0; pos = {}; eq = []; tr = []
    for t in days:
        for s in list(pos):
            x = C[s]; p = pos[s]; i = x['ix'].get(t)
            if i is None:
                if x['t'][-1] < t:
                    cash += p['q'] * x['c'][-1] * (1 - FEE); tr.append((s, p['t0'], t, x['c'][-1] / p['e'] - 1, 'delist')); del pos[s]
                continue
            px = why = None
            if p['sl'] and x['l'][i] <= p['sl']: px, why = p['sl'], 'sl'
            elif x['h'][i] >= p['tp']: px, why = p['tp'], 'tp'
            elif (t - p['t0']) / DAY >= hold: px, why = x['c'][i], 'time'
            if px:
                cash += p['q'] * px * (1 - FEE); tr.append((s, p['t0'], t, px * (1 - FEE) ** 2 / p['e'] - 1, why)); del pos[s]
        m = cash + sum(p['q'] * (C[s]['c'][C[s]['ix'][t]] if t in C[s]['ix'] else C[s]['c'][-1]) for s, p in pos.items())
        eq.append((t, m, cash))
        if len(pos) >= slots or (gate and not gate(BR[t])): continue
        cand = []
        for s, k in VR[t].items():
            if k >= topn or s in pos: continue
            x = C[s]; i = x['ix'][t]
            if i < 365 or i >= len(x['c']) - 1 or x['vm'][i] is None or x['atr'][i] is None: continue
            info = climax(x, i, vmin, drop, wick)
            if info: cand.append((x['c'][i] / x['c'][i - 7], s, i, info))  # deepest 7d drop first
        for _, s, i, info in sorted(cand)[:slots - len(pos)]:
            size = m / slots
            if cash < size * .999: break
            x = C[s]; e = x['c'][i]; cash -= size
            tgt = e * (1 + tp)
            if tpres:
                r = next_res(info['zs'], e, mingain=.08); tgt = min(r, e * 1.40) if r else tgt
            pos[s] = dict(t0=t, e=e, q=size * (1 - FEE) / e, tp=tgt, sl=info['level'] * (1 - 2 * tol_of(x, i)) if sl else None)
    return eq, tr, pos


def summ(eq, tr, label):
    yrs = (eq[-1][0] - eq[0][0]) / DAY / 365; cagr = eq[-1][1] ** (1 / yrs) - 1
    pk = 0; mdd = 0
    for e in eq: pk = max(pk, e[1]); mdd = min(mdd, e[1] / pk - 1)
    expo = sum(1 - e[2] / e[1] for e in eq) / len(eq); n = len(tr)
    w = sum(1 for x in tr if x[3] > 0); why = {}
    for x in tr: why[x[4]] = why.get(x[4], 0) + 1
    yr = {}
    for e in eq:
        y = dt.datetime.fromtimestamp(e[0] / 1000, dt.UTC).year; yr.setdefault(y, [e[1], e[1]]); yr[y][1] = e[1]
    ys = ' '.join(f"{y % 100}:{(b / a - 1) * 100:+4.0f}%" for y, (a, b) in yr.items())
    avg = st.mean(x[3] for x in tr) if tr else 0
    print(f"{label:<40} CAGR {cagr*100:+5.1f}% DD {mdd*100:4.0f}% vốn dùng {expo*100:3.0f}% | {n/yrs:4.0f} lệnh/năm thắng {w/max(n,1)*100:3.0f}% TB {avg*100:+5.1f}% "
          f"{' '.join(f'{k}:{v}' for k, v in sorted(why.items()))} | {ys}")


if __name__ == '__main__':
    print('=== Chiến lược C — volume climax tại hỗ trợ, mô phỏng danh mục 2022-01 → 2026-11 (top 100 alt vol) ===')
    for cfg in [
        dict(vmin=2.5, drop=.15, wick=.4),
        dict(vmin=2.0, drop=.15, wick=.4),
        dict(vmin=2.0, drop=.20, wick=.4),
        dict(vmin=2.5, drop=.20, wick=.4),
    ]:
        name = f"v≥{cfg['vmin']} 7d≤−{int(cfg['drop']*100)}% wick≥{cfg['wick']}"
        print(f'\n-- {name}')
        for ex in [dict(tp=.10, hold=30), dict(tp=.20, hold=60), dict(tp=.30, hold=180), dict(tpres=True, hold=60),
                   dict(tp=.20, hold=60, sl=True), dict(tp=.20, hold=60, slots=10), dict(tp=.20, hold=60, slots=3)]:
            lab = ('TP kháng cự kế' if ex.get('tpres') else f"TP +{int(ex.get('tp', .2)*100)}%") + f" / {ex['hold']}d" + (' + SL dưới vùng' if ex.get('sl') else '') + f" · {ex.get('slots', 5)} slot"
            eq, tr, pos = sim(**cfg, **ex); summ(eq, tr, lab)
    print('\n-- v≥2.5 −15% wick.4, TP +20%/60d, 5 slot, theo chế độ breadth')
    for gn, g in [('breadth ≥ 25%', lambda b: b['w35'] >= .25), ('breadth 10–25%', lambda b: .10 <= b['w35'] < .25), ('breadth < 10%', lambda b: b['w35'] < .10), ('breadth ≥ 10%', lambda b: b['w35'] >= .10)]:
        eq, tr, pos = sim(gate=g); summ(eq, tr, gn)
    print('\n-- v≥2.5 −15% wick.4, TP +20%/60d, 5 slot, top 50 vol')
    eq, tr, pos = sim(topn=50); summ(eq, tr, 'top 50')
    eq, tr, pos = sim(); print('\nLệnh gần nhất:')
    f = lambda t: dt.datetime.fromtimestamp(t / 1000, dt.UTC).strftime('%Y-%m-%d')
    for s, t0, t1, r, why in tr[-15:]: print(f'  {s:<8} {f(t0)} → {f(t1)} {why:<5} {r*100:+6.1f}%')
    for s, p in pos.items(): print(f'  {s:<8} MỞ từ {f(p["t0"])}')
