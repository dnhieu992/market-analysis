import statistics as st, datetime as dt
from altsim import *
def multi(sig, gate, n=10, **kw):
    out = []
    for k in range(n):
        eq, tr, pos = run(sig, gate, seed=k, **kw)
        yrs = (eq[-1][0]-eq[0][0])/DAY/365; pk = 0; mdd = 0
        for e in eq: pk = max(pk, e[1]); mdd = min(mdd, e[1]/pk-1)
        out.append((eq[-1][1]**(1/yrs)-1, mdd))
    c = sorted(o[0] for o in out); d = sorted(o[1] for o in out)
    return f"CAGR med {st.median(c)*100:5.1f}% [min {c[0]*100:5.1f} max {c[-1]*100:5.1f}] DD med {st.median(d)*100:4.0f}% tệ {d[0]*100:4.0f}%"
W = SIG['RSI W<35']; WD = SIG['RSI W<35 hoặc D<25']; R = SIG['mọi ngày (ngẫu nhiên)']
print('--- 10 seed, 8 phần, ladder 0/-15/-30, TP 30% ---')
for topn in (30, 50, 100):
    for sn, sf in [('ngẫu nhiên', R), ('RSI W<35', W), ('W<35|D<25', WD)]:
        for gn in ('không lọc', 'breadth≥10%', 'breadth≥25%', 'F&G<50'):
            print(f'top{topn:<4}{sn:<12}{gn:<14}', multi(sf, GATE[gn], topn=topn))
print('--- xếp hạng: RSI tuần thấp nhất trước ---')
for topn in (30, 50, 100):
    for gn in ('không lọc', 'breadth≥25%'):
        eq, tr, pos = run(W, GATE[gn], topn=topn, rank='wrsi'); summ(eq, tr, pos, f'top{topn} W<35 {gn} rank=wrsi')
print('--- số phần vốn (top50, W<35, breadth≥10%) ---')
for sl in (5, 8, 12, 16):
    print(f'slots {sl:<3}', multi(W, GATE['breadth≥10%'], topn=50, slots=sl))
print('--- thang DCA (top50, W<35, breadth≥10%) ---')
for lad in [((1, 0),), ((.3, 0), (.3, -.15), (.4, -.30)), ((.3, 0), (.3, -.20), (.4, -.40)), ((.25, 0), (.25, -.15), (.5, -.35))]:
    print(f'{str([l[1] for l in lad]):<22}', multi(W, GATE['breadth≥10%'], topn=50, ladder=lad))
print('--- TP (top50, W<35, breadth≥10%) ---')
for tp in (.2, .3, .4, .5):
    print(f'TP {tp:<5}', multi(W, GATE['breadth≥10%'], topn=50, tp=tp))
print('--- time exit ---')
for te in (None, 180, 365):
    print(f'time {te}', multi(W, GATE['breadth≥10%'], topn=50, time_exit=te))
