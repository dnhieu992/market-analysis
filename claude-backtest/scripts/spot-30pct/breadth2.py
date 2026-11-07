import json, os, datetime as dt, statistics as st
from lib import rsi, rolling_max, sma
B = {int(k): v for k, v in json.load(open('breadth.json')).items()}
def load_any():
    out = {}
    for d in ('all', 'data', 'data_dead'):
        for f in os.listdir(d):
            if not f.endswith('.json') or f == 'fng.json': continue
            s = f[:-5]
            if s in ('BTC', 'ETH'): continue   # altcoins only
            r = json.load(open(os.path.join(d, f)))
            if s in out and len(out[s]) >= len(r): continue
            out[s] = (r, d == 'data_dead')
    return out
A = load_any()
ev = []
for s, (r, dead) in A.items():
    t = [x[0] for x in r]; c = [x[4] for x in r]; h = [x[2] for x in r]; l = [x[3] for x in r]; v = [x[5] for x in r]
    if len(c) < 400: continue   # listed > ~1 year before any signal
    dr = rsi(c, 14); v30 = sma(v, 30)
    wk_i = [i for i in range(len(t)) if dt.datetime.utcfromtimestamp(t[i] / 1000).weekday() == 6]
    wr = rsi([c[i] for i in wk_i], 14); j = -1; last = -999
    for i in range(365, len(c) - 1):
        while j + 1 < len(wk_i) and wk_i[j + 1] <= i: j += 1
        w = wr[j] if j >= 0 else None
        b = B.get(t[i])
        if not b or w is None or dr[i] is None: continue
        if i - last < 30: continue
        if not (w < 35 or dr[i] < 25): continue
        last = i
        e = c[i]; mn = e; hit = None; end = min(len(c) - 1, i + 365)
        for k in range(i + 1, end + 1):
            mn = min(mn, l[k])
            if h[k] >= e * 1.3: hit = k - i; break
        resolved = hit is not None or end - i >= 365 or dead
        if not resolved: continue
        ev.append(dict(s=s, t=t[i], hit=hit, mdd=mn / e - 1, ret=c[end] / e - 1, b=b, v30=v30[i] or 0, w=w, d=dr[i]))
print('events', len(ev))
def show(name, sub):
    if len(sub) < 20: print(f'{name:<40} (ít mẫu {len(sub)})'); return
    n = len(sub); h = lambda H: sum(1 for e in sub if e['hit'] is not None and e['hit'] <= H) / n
    stuck = [e for e in sub if e['hit'] is None]
    print(f"{name:<40} n={n:5d} | +30% ≤60d {h(60)*100:3.0f}% ≤180d {h(180)*100:3.0f}% ≤365d {h(365)*100:3.0f}% | DD med {st.median(e['mdd'] for e in sub)*100:4.0f}% p10 {sorted(e['mdd'] for e in sub)[n//10]*100:4.0f}% | kẹt {len(stuck)/n*100:3.0f}%")
show('Tất cả tín hiệu RSI (alt)', ev)
print('-- theo % alt có RSI tuần <35 (breadth)')
for lo, hi in [(0, .1), (.1, .25), (.25, .4), (.4, .6), (.6, 1.01)]:
    show(f'breadth W<35 {lo*100:.0f}-{hi*100:.0f}%', [e for e in ev if lo <= e['b']['w35'] < hi])
print('-- theo median alt cách đỉnh 180d')
for lo, hi in [(-1, -.7), (-.7, -.6), (-.6, -.5), (-.5, -.4), (-.4, 0.01)]:
    show(f'median dd180 {lo*100:.0f}..{hi*100:.0f}%', [e for e in ev if lo <= e['b']['dd180'] < hi])
print('-- theo F&G')
for lo, hi in [(0, 20), (20, 30), (30, 50), (50, 75), (75, 101)]:
    show(f'F&G {lo}-{hi}', [e for e in ev if e['b'].get('fng') is not None and lo <= e['b']['fng'] < hi])
print('-- theo thanh khoản coin (vol 30d)')
for lo, hi in [(0, 1e6), (1e6, 5e6), (5e6, 20e6), (20e6, 1e12)]:
    show(f'vol {lo/1e6:.0f}-{hi/1e6:.0f}M$/ngày', [e for e in ev if lo <= e['v30'] < hi])
print('-- theo năm')
for y in range(2019, 2027):
    show(f'năm {y}', [e for e in ev if dt.datetime.utcfromtimestamp(e['t']/1000).year == y])
json.dump(ev, open('alt_events.json', 'w'))
