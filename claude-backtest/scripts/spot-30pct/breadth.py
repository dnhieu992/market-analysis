"""Alt-market breadth (2018→2026) from all available alts (live 500 + 110-coin long history + dead coins)."""
import json, os, datetime as dt, statistics as st
from lib import rsi, rolling_max, fng_map
def load_any():
    out = {}
    for d in ('all', 'data', 'data_dead'):
        for f in os.listdir(d):
            if not f.endswith('.json') or f == 'fng.json': continue
            s = f[:-5]
            if s in ('BTC',): continue
            r = json.load(open(os.path.join(d, f)))
            if s in out and len(out[s]) >= len(r): continue
            out[s] = r
    return out
A = load_any()
FNG = fng_map()
per_day = {}
for s, r in A.items():
    t = [x[0] for x in r]; c = [x[4] for x in r]; h = [x[2] for x in r]
    if len(c) < 200: continue
    hi180 = rolling_max(h, 180)
    wk_i = [i for i in range(len(t)) if dt.datetime.utcfromtimestamp(t[i] / 1000).weekday() == 6]
    wr = rsi([c[i] for i in wk_i], 14)
    j = -1
    for i in range(180, len(t)):
        while j + 1 < len(wk_i) and wk_i[j + 1] <= i: j += 1
        w = wr[j] if j >= 0 else None
        d = per_day.setdefault(t[i], [[], []])
        if w is not None: d[0].append(w)
        d[1].append(c[i] / hi180[i] - 1)
B = {}
for t in sorted(per_day):
    w, dd = per_day[t]
    if len(w) < 25: continue
    B[t] = {'w35': sum(1 for x in w if x < 35) / len(w), 'w30': sum(1 for x in w if x < 30) / len(w), 'dd180': st.median(dd), 'n': len(w), 'fng': FNG.get(t)}
json.dump({str(k): v for k, v in B.items()}, open('breadth.json', 'w'))
# print monthly snapshots + recent weekly
for t, v in B.items():
    d = dt.datetime.utcfromtimestamp(t / 1000)
    if (d.day == 1) or (d >= dt.datetime(2026, 7, 1) and d.weekday() == 4):
        print(d.strftime('%Y-%m-%d'), f"alt RSI W<35: {v['w35']*100:3.0f}%  W<30: {v['w30']*100:3.0f}%  median cách đỉnh 180d: {v['dd180']*100:4.0f}%  F&G {v['fng']}  n={v['n']}")
