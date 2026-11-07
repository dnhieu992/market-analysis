import json, os, time, statistics as st, math
A = {}
for f in os.listdir('all'):
    r = json.load(open('all/'+f)); 
    if len(r) > 60: A[f[:-5]] = {x[0]: x for x in r}
days = sorted({t for v in A.values() for t in v if t >= 1777593600000})  # 2026-05-01
alts = [s for s in A if s not in ('BTC',)]
# equal-weight alt index (log mean of daily returns, coins with data both days)
idx = 1.0; prev = None; series = []
for t in days:
    if prev:
        rs = [math.log(A[s][t][4] / A[s][prev][4]) for s in alts if t in A[s] and prev in A[s] and A[s][prev][4] > 0]
        idx *= math.exp(st.median(rs)) if rs else 1
    series.append((t, idx, A['BTC'][t][4] if t in A['BTC'] else None, sum(1 for s in alts if t in A[s]))); prev = t
for t, v, b, n in series[::4]:
    print(time.strftime('%Y-%m-%d', time.gmtime(t/1000)), f'altIdx {v:6.3f}  BTC {b:8.0f}  n={n}')
