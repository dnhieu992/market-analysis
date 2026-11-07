import json, statistics as st
rows = [r for r in json.load(open('pump_rows.json')) if r['rsi_w'] is not None]
rows.sort(key=lambda x: -x['gain']); n = len(rows); q = n // 4
groups = [('Top 25% (tăng mạnh nhất)', rows[:q]), ('25-50%', rows[q:2*q]), ('50-75%', rows[2*q:3*q]), ('Bottom 25%', rows[3*q:])]
feats = [('gain', 'Mức tăng tối đa', 100), ('dd_ath', 'Cách ATH', 100), ('ch90', '90d trước pump', 100), ('ch30', '30d trước pump', 100), ('rsi_d', 'RSI D', 1), ('rsi_w', 'RSI W', 1), ('vratio', 'Vol 30d/90d', 1), ('vol30', 'Vol/ngày $M', 1e-6), ('cap', 'Vốn hoá $M', 1e-6), ('age', 'Tuổi (ngày)', 1)]
print(f"{'nhóm':<28}" + ''.join(f'{lab:>16}' for _, lab, _ in feats) + f"{'>EMA21W':>10}")
for name, g in groups:
    line = f'{name:<28}'
    for k, _, m in feats:
        line += f"{st.median(x[k] for x in g if x[k] is not None) * m:16.1f}"
    line += f"{sum(1 for x in g if x['above_e21w']) / len(g) * 100:9.0f}%"
    print(line)
# rank correlation
def rank(v):
    o = sorted(range(len(v)), key=lambda i: v[i]); r = [0]*len(v)
    for k, i in enumerate(o): r[i] = k
    return r
def spear(a, b):
    ra, rb = rank(a), rank(b); n = len(a); ma = mb = (n - 1) / 2
    cov = sum((x - ma) * (y - mb) for x, y in zip(ra, rb)); va = sum((x - ma) ** 2 for x in ra); vb = sum((y - mb) ** 2 for y in rb)
    return cov / (va * vb) ** 0.5
g = [x['gain'] for x in rows]
print('\nTương quan hạng với mức tăng (Spearman):')
for k, lab, _ in feats[1:]:
    print(f'  {lab:<16} {spear([x[k] or 0 for x in rows], g):+.2f}')
# sectors
from collections import defaultdict
sec = defaultdict(list)
for x in rows:
    for t in x['tags'] or ['(none)']: sec[t].append(x['gain'])
print('\nTheo tag Binance (median mức tăng, n≥8):')
for t, v in sorted(sec.items(), key=lambda kv: -st.median(kv[1])):
    if len(v) >= 8: print(f'  {t:<16} n={len(v):3d} median +{st.median(v)*100:4.0f}%  ≥+30%: {sum(1 for x in v if x>=0.3)/len(v)*100:3.0f}%')
# cap buckets
print('\nTheo vốn hoá:')
for lo, hi, lab in [(0, 30e6, '<30M'), (30e6, 100e6, '30-100M'), (100e6, 500e6, '100-500M'), (500e6, 2e9, '0.5-2B'), (2e9, 1e13, '>2B')]:
    v = [x['gain'] for x in rows if lo <= x['cap'] < hi]
    if v: print(f'  {lab:<10} n={len(v):3d} median +{st.median(v)*100:4.0f}%  ≥+30% {sum(1 for y in v if y>=.3)/len(v)*100:3.0f}%  ≥+100% {sum(1 for y in v if y>=1)/len(v)*100:3.0f}%')
print('\nTheo cách ATH:')
for lo, hi in [(-1.01, -0.95), (-0.95, -0.9), (-0.9, -0.8), (-0.8, -0.6), (-0.6, 0.01)]:
    v = [x['gain'] for x in rows if lo <= x['dd_ath'] < hi]
    if v: print(f'  {lo*100:4.0f}..{hi*100:4.0f}% n={len(v):3d} median +{st.median(v)*100:4.0f}%  ≥+100% {sum(1 for y in v if y>=1)/len(v)*100:3.0f}%')
print('\nTheo RSI tuần:')
for lo, hi in [(0, 30), (30, 35), (35, 40), (40, 50), (50, 100)]:
    v = [x['gain'] for x in rows if lo <= x['rsi_w'] < hi]
    if v: print(f'  W {lo}-{hi} n={len(v):3d} median +{st.median(v)*100:4.0f}%  ≥+30% {sum(1 for y in v if y>=.3)/len(v)*100:3.0f}%  ≥+100% {sum(1 for y in v if y>=1)/len(v)*100:3.0f}%')
