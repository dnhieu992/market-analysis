import json, os, time, statistics as st, datetime as dt
from lib import rsi, ema, sma
ms = lambda s: int(dt.datetime.strptime(s, '%Y-%m-%d').replace(tzinfo=dt.timezone.utc).timestamp() * 1000)
P = {p['b']: p for p in json.load(open('all_products.json'))['data'] if p['q'] == 'USDT'}
T0, W1, W2 = ms('2026-08-15'), ms('2026-10-15'), ms('2026-08-01')
rows = []
for f in os.listdir('all'):
    s = f[:-5]
    if s == 'BTC': continue
    r = json.load(open('all/' + f))
    t = [x[0] for x in r]; c = [x[4] for x in r]; h = [x[2] for x in r]; l = [x[3] for x in r]; v = [x[5] for x in r]
    if T0 not in t: continue
    i0 = t.index(T0)
    if i0 < 120: continue  # need ~4 months history before
    # pump: max high between Aug 15 and Oct 15 vs close on Aug 15 (entry before the pump)
    iw = max(j for j in range(len(t)) if t[j] <= W1)
    jmax = max(range(i0, iw + 1), key=lambda j: h[j])
    gain = h[jmax] / c[i0] - 1
    now = c[-1] / c[i0] - 1
    # features at Aug 15 (known then)
    ath = max(h[:i0 + 1]); dd_ath = c[i0] / ath - 1
    ch90 = c[i0] / c[i0 - 90] - 1; ch30 = c[i0] / c[i0 - 30] - 1
    r_d = rsi(c[:i0 + 1], 14)[-1]
    wk = [c[j] for j in range(i0 + 1) if dt.datetime.utcfromtimestamp(t[j] / 1000).weekday() == 6]
    r_w = rsi(wk, 14)[-1] if len(wk) > 15 else None
    e21w = ema(wk, 21)[-1] if len(wk) > 21 else None
    vol30 = sum(v[i0 - 30:i0]) / 30; vol90 = sum(v[i0 - 120:i0 - 30]) / 90
    age = (t[i0] - t[0]) / 86400000
    p = P.get(s, {}); cap = (p.get('cs') or 0) * c[i0]
    rows.append(dict(s=s, gain=gain, peak=time.strftime('%m-%d', time.gmtime(t[jmax] / 1000)), now=now, dd_ath=dd_ath, ch90=ch90, ch30=ch30, rsi_d=r_d, rsi_w=r_w,
                     above_e21w=(wk[-1] > e21w) if e21w else None, vratio=vol30 / vol90 if vol90 else None, vol30=vol30, age=age, cap=cap, tags=p.get('tags') or []))
json.dump(rows, open('pump_rows.json', 'w'))
rows.sort(key=lambda x: -x['gain'])
n = len(rows); print('coins', n, 'median gain', round(st.median(x['gain'] for x in rows) * 100), '%')
for q in (0.5, 0.3, 1.0):
    print(f'≥{q*100:.0f}%:', sum(1 for x in rows if x['gain'] >= q))
print('\nTOP 40')
for x in rows[:40]:
    print(f"{x['s']:<10} +{x['gain']*100:5.0f}% đỉnh {x['peak']} | nay {x['now']*100:+5.0f}% | trước pump: ATH {x['dd_ath']*100:4.0f}% 90d {x['ch90']*100:+4.0f}% 30d {x['ch30']*100:+4.0f}% RSI D {x['rsi_d']:3.0f} W {x['rsi_w'] or 0:3.0f} >EMA21W {x['above_e21w']} vol30/90 {x['vratio'] or 0:4.1f} vol {x['vol30']/1e6:6.1f}M cap {x['cap']/1e6:7.0f}M age {x['age']:4.0f}d {','.join(x['tags'][:3])}")
