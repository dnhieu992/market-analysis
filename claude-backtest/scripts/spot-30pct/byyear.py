import scan, datetime
from collections import defaultdict
res = scan.run(None); scan.build_rand(res)
pick = ['RANDOM (mọi ngày)', 'RSI W<35', 'RSI W<30', 'RSI D<25', 'RSI D<30', 'dd180>=50%', 'Phá nền 60d + vol x2', 'Donchian 50 breakout', 'cắt lên EMA50']
print(f"{'signal':<24}" + ''.join(f'{y:>14}' for y in range(2018, 2026)))
for k in pick:
    by = defaultdict(list)
    for e in res[k]:
        if e[5] >= 365 or e[2] is not None:
            by[datetime.datetime.utcfromtimestamp(e[1]/1000).year].append(e)
    cells = []
    for y in range(2018, 2026):
        ev = by.get(y, [])
        if len(ev) < 8: cells.append(f"{'—':>14}"); continue
        h = sum(1 for e in ev if e[2] is not None and e[2] <= 180) / len(ev)
        b = scan.matched_base(ev)
        cells.append(f"{h*100:5.0f}%({(h-b)*100:+3.0f}) n{len(ev):<3}"[:14].rjust(14))
    print(f'{k:<24}' + ''.join(cells))
