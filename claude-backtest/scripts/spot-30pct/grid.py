import datetime, statistics as st
from lib import *
import sim
W = lambda f, i, th: f['wrsi'][i] is not None and f['wrsi'][i] < th
Dr = lambda f, i, th: f['rsi'][i] is not None and f['rsi'][i] < th
# liquidity rank proxy: top-N by 30d quote volume each day (computed once)
data = sim.prepare(coins())
vol30 = {}
for sym, (x, f, ix) in data.items():
    v = sma(x['v'], 30)
    for i, t in enumerate(x['t']):
        if v[i]: vol30.setdefault(t, []).append((v[i], sym))
topN = {}
for t, l in vol30.items():
    l.sort(reverse=True); topN[t] = {s: r for r, (_, s) in enumerate(l)}
inTop = lambda x, i, n: topN.get(x['t'][i], {}).get(x['sym'], 999) < n
for sym, (x, f, ix) in data.items(): x['sym'] = sym
btc = load('BTC'); bs = sma(btc['c'], 200); BTCUP = {t: btc['c'][i] > bs[i] for i, t in enumerate(btc['t']) if bs[i]}
core = lambda x, f, i: W(f, i, 35) or Dr(f, i, 25)
mom = lambda x, f, i: BTCUP.get(x['t'][i]) and x['c'][i] > f['hi50'][i-1] and f['v20'][i-1] and x['v'][i] > 2 * f['v20'][i-1]
rank_rsi = lambda x, f, i: min(f['rsi'][i] or 99, (f['wrsi'][i] or 99) - 10)
L3 = ((0.3, 0), (0.3, -0.15), (0.4, -0.30))
S0, S1, S2 = datetime.datetime(2019,1,1), datetime.datetime(2023,1,1), None
def show(label, sig, rank=rank_rsi, slots=10, lad=L3, tex=None, seeds=None):
    out = []
    for (s, e) in [(S0, None), (S0, S1), (S1, None)]:
        if seeds:
            cs = [sim.cagr_of(sim.run(data, sig, slots, lad, 0.30, tex, s, e, None, sd)[0]) for sd in seeds]
            out.append((st.median(c for c, _ in cs), st.median(d for _, d in cs)))
        else:
            eq, tr, pos = sim.run(data, sig, slots, lad, 0.30, tex, s, e, rank)
            out.append(sim.cagr_of(eq))
    print(f"{label:<58}" + ' | '.join(f'{c*100:6.1f}%/{d*100:4.0f}%' for c, d in out))
print(f"{'(CAGR / maxDD)':<58}{'2019→2026':>14} | {'2019→2022':>12} | {'2023→2026':>12}")
for (s,e) in []: pass
bh = [sim.cagr_of(sim.btc_hold(s, e)) for s, e in [(S0, None), (S0, S1), (S1, None)]]
print(f"{'Giữ BTC':<58}" + ' | '.join(f'{c*100:6.1f}%/{d*100:4.0f}%' for c, d in bh))
for tex in (None, 365, 180):
  for n in (999, 30, 15):
    for slots in (10, 5):
        sig = (lambda n: (lambda x, f, i, r: core(x, f, i) and (n == 999 or inTop(x, i, n))))(n)
        show(f"RSI dip | top{n if n<999 else 'all'} vol | {slots} phần | thoát {tex or 'không'}d", sig, slots=slots, tex=tex)
print('-- thêm tín hiệu mùa tăng (BTC>SMA200 & phá đỉnh 50d + vol x2)')
for n in (999, 30):
    for tex in (None, 365):
        sig = (lambda n: (lambda x, f, i, r: (core(x, f, i) or mom(x, f, i)) and (n == 999 or inTop(x, i, n))))(n)
        show(f"RSI dip + momentum | top{n if n<999 else 'all'} | 10 phần | thoát {tex or 'không'}d", sig, tex=tex)
print('-- ngẫu nhiên (median 7 seed)')
for n in (999, 30):
    for tex in (None, 365):
        sig = (lambda n: (lambda x, f, i, r: r.random() < 0.02 and (n == 999 or inTop(x, i, n))))(n)
        show(f"NGẪU NHIÊN | top{n if n<999 else 'all'} | 10 phần | thoát {tex or 'không'}d", sig, tex=tex, seeds=range(1, 8))
