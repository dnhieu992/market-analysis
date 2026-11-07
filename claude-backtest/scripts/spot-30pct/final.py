import datetime
exec(open('grid.py').read().split("print(f\"{'(CAGR")[0])
def sig_top(n, w=35, d=25):
    return lambda x, f, i, r: (W(f, i, w) or Dr(f, i, d)) and inTop(x, i, n)
print(f"{'(CAGR / maxDD)':<58}{'2019→2026':>14} | {'2019→2022':>12} | {'2023→2026':>12}")
print('-- độ nhạy: số coin top volume × số phần vốn (TP 30%, thang 0/-15/-30, không thoát thời gian)')
for n in (10, 15, 20, 25, 30):
    for slots in (5, 8):
        show(f'top{n} | {slots} phần', sig_top(n), slots=slots)
print('-- độ nhạy ngưỡng RSI (top20, 5 phần)')
for w, d in [(30, 20), (35, 25), (40, 30), (35, 0), (0, 25)]:
    show(f'RSI W<{w} | D<{d}', sig_top(20, w, d), slots=5)
print('-- nấc DCA (top20, 5 phần)')
for lad, ln in [(((1.0, 0),), 'mua 1 lần'), (((0.3, 0), (0.3, -0.10), (0.4, -0.20)), '0/-10/-20'), (L3, '0/-15/-30'), (((0.3, 0), (0.3, -0.20), (0.4, -0.40)), '0/-20/-40'), (((0.5, 0), (0.5, -0.25)), '50/50 @0/-25')]:
    show(f'thang {ln}', sig_top(20), slots=5, lad=lad)
print('-- ngẫu nhiên top20 5 phần (median 7 seed)')
show('NGẪU NHIÊN top20 | 5 phần', lambda x, f, i, r: r.random() < 0.02 and inTop(x, i, 20), slots=5, seeds=range(1, 8))
print('-- mục tiêu TP khác (top20, 5 phần)')
for tp in (0.2, 0.3, 0.4, 0.5):
    out = []
    for (s, e) in [(S0, None), (S0, S1), (S1, None)]:
        out.append(sim.cagr_of(sim.run(data, sig_top(20), 5, L3, tp, None, s, e, rank_rsi)[0]))
    print(f"{'TP +%d%%' % (tp*100):<58}" + ' | '.join(f'{c*100:6.1f}%/{d*100:4.0f}%' for c, d in out))
print('\n-- chi tiết phương án đề xuất: top20, 5 phần, thang 0/-15/-30, TP 30%')
eq, tr, pos = sim.run(data, sig_top(20), 5, L3, 0.30, None, S0, None, rank_rsi)
sim.stats(eq, tr, pos, 'đề xuất')
byy = {}
for e in eq: byy.setdefault(datetime.datetime.utcfromtimestamp(e[0]/1000).year, []).append(e[1])
bx = load('BTC'); bby = {}
for t, c in zip(bx['t'], bx['c']):
    if t >= S0.timestamp()*1000: bby.setdefault(datetime.datetime.utcfromtimestamp(t/1000).year, []).append(c)
prev = 1.0; pb = None
for y in sorted(byy):
    v = byy[y][-1]; b0 = bby[y][0] if pb is None else pb; b1 = bby[y][-1]
    print(f'  {y}: chiến lược {(v/prev-1)*100:+6.1f}%   BTC {(b1/b0-1)*100:+6.1f}%'); prev = v; pb = b1
print('  vị thế đang mở cuối kỳ:', [(s, round(p['cost']/p['qty'], 6), p['fills']) for s, p in pos.items()])
losers = sorted([t for t in tr if t[3] < 0], key=lambda t: t[3])[:8]
print('  lệnh lỗ tệ nhất:', [(t[0], datetime.datetime.utcfromtimestamp(t[1]/1000).strftime('%Y-%m'), f'{t[3]*100:.0f}%', t[4]) for t in losers])
