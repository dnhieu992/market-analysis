import datetime as dt
from altsim import *
f = lambda t: dt.datetime.utcfromtimestamp(t/1000).strftime('%Y-%m-%d')
W = SIG['RSI W<35']
print('breadth snapshots 2026:')
for t in sorted(BR):
    d = dt.datetime.utcfromtimestamp(t/1000)
    if d.year == 2026 and (d.day in (1, 15)): print(' ', f(t), f"W<35 {BR[t]['w35']*100:3.0f}%  alt dd180 med {BR[t]['dd']*100:4.0f}%  F&G {FNG.get(t)}")
for gn, topn in [('breadth≥25%', 100), ('breadth≥10%', 50)]:
    print(f'\n=== đợt pump: W<35, {gn}, top{topn}, rank wrsi, chạy từ 2026-05-01 ===')
    eq, tr, pos = run(W, GATE[gn], topn=topn, rank='wrsi', start=dt.datetime(2026, 5, 1))
    for s, t0, t1, r, why, k in tr: print(f'  {s:<8} mua {f(t0)} → {why} {f(t1)} ({(t1-t0)/DAY:3.0f}d) {r*100:+5.1f}% DCA {k}')
    for s, p in pos.items():
        x = C[s]; print(f'  {s:<8} MỞ từ {f(p["t0"])} DCA {p["k"]}  lãi/lỗ hiện {(p["q"]*x["c"][-1]/p["cost"]-1)*100:+5.1f}%')
    e = {f(x[0]): x[1] for x in eq}
    print('  equity:', ' '.join(f'{d}:{e[d]:.2f}' for d in ('2026-08-15', '2026-09-26', '2026-10-15') if d in e), 'cuối', f'{eq[-1][1]:.2f}')
# today's candidates
t = max(BR); print('\nHôm nay', f(t), f"breadth {BR[t]['w35']*100:.0f}% F&G {FNG.get(t)}")
vr = VR[t]; c = []
for s, k in vr.items():
    if k >= 100: continue
    x = C[s]; i = x['ix'][t]
    if i >= 365 and x['wrsi'][i] is not None and x['wrsi'][i] < 35: c.append((x['wrsi'][i], s, k, x['rsi'][i], x['c'][i]/x['hi180'][i]-1))
for w, s, k, d, dd in sorted(c)[:20]: print(f'  {s:<8} vol rank {k:3d}  RSI W {w:4.1f}  RSI D {d:4.1f}  cách đỉnh 180d {dd*100:4.0f}%')
