"""Alt-only portfolio sim, 2022→2026, with market-regime gates (breadth / F&G) and the user's ladder.
Universe: every Binance USDT alt we have (live 500 + long-history 70 + delisted 200), minus BTC/ETH/stables/wrapped."""
import json, os, datetime as dt, random, statistics as st, sys
from lib import rsi, sma, rolling_max, fng_map
DAY = 86400000; FEE = 0.001
EXCL = {'BTC','ETH','USDC','FDUSD','TUSD','USDP','DAI','BUSD','EUR','AEUR','USDE','PAX','USDS','USD1','EURI','BFUSD','WBTC','WBETH','BETH','BNSOL','BCC','BCHSV','PAXG','XUSD','RLUSD','BKRW','SUSD','UST','USTC','ERD','NPXS','VEN','BTCST'}
def load_all():
    out = {}
    for d in ('all', 'data', 'data_dead', 'dead2'):
        for f in os.listdir(d):
            if not f.endswith('.json') or f == 'fng.json': continue
            s = f[:-5]
            if s in EXCL or s.endswith(('UP', 'DOWN', 'BULL', 'BEAR')): continue
            r = json.load(open(os.path.join(d, f)))
            # keep the last segment after any >8x one-day jump (redenomination / ticker reuse)
            cut = 0
            for i in range(1, len(r)):
                q = r[i][4] / r[i-1][4] if r[i-1][4] else 1
                if q > 8 or q < 1/8: cut = i
            r = r[cut:]
            if s in out and len(out[s][0]) >= len(r): continue
            out[s] = (r, d in ('data_dead', 'dead2'))
    return out
A = load_all()
LIVE_LAST = max(r[-1][0] for r, _ in A.values())
FNG = fng_map()
C = {}
for s, (r, dead) in A.items():
    if len(r) < 200: continue
    t = [x[0] for x in r]; c = [x[4] for x in r]
    wk = [i for i in range(len(t)) if dt.datetime.utcfromtimestamp(t[i]/1000).weekday() == 6]
    wr_ = rsi([c[i] for i in wk], 14); wr = [None]*len(c); j = -1
    for i in range(len(c)):
        while j+1 < len(wk) and wk[j+1] <= i: j += 1
        if j >= 0: wr[i] = wr_[j]
    C[s] = dict(t=t, o=[x[1] for x in r], h=[x[2] for x in r], l=[x[3] for x in r], c=c, v30=sma([x[5] for x in r], 30),
                rsi=rsi(c, 14), wrsi=wr, hi180=rolling_max([x[2] for x in r], 180), ix={tt: i for i, tt in enumerate(t)},
                dead=dead or t[-1] < LIVE_LAST - 5*DAY)
# breadth (alts listed ≥200d), incl. dead coins
pd = {}
for s, x in C.items():
    for i in range(200, len(x['t'])):
        if x['wrsi'][i] is None: continue
        d = pd.setdefault(x['t'][i], [0, 0, []]); d[1] += 1; d[0] += x['wrsi'][i] < 35; d[2].append(x['c'][i]/x['hi180'][i]-1)
BR = {t: dict(w35=a/n, dd=st.median(dd), n=n) for t, (a, n, dd) in pd.items() if n >= 40}
# daily liquidity rank among alts
VR = {}
for t in BR:
    vs = sorted(((x['v30'][x['ix'][t]] or 0), s) for s, x in C.items() if t in x['ix'] and x['ix'][t] >= 365)
    vs.reverse(); VR[t] = {s: k for k, (v, s) in enumerate(vs)}

def run(sig, gate=lambda b, f: True, slots=8, topn=50, ladder=((.3, 0), (.3, -.15), (.4, -.30)), tp=.30, rank='rand',
        start=dt.datetime(2022, 1, 1), end=None, seed=0, time_exit=None, minage=365, log=None):
    rnd = random.Random(seed); s0 = start.timestamp()*1000; e0 = end.timestamp()*1000 if end else 1e20
    days = sorted(t for t in BR if s0 <= t < e0)
    cash = 1.0; pos = {}; eq = []; tr = []
    for t in days:
        for s in list(pos):
            x = C[s]; i = x['ix'].get(t); p = pos[s]
            if i is None:
                if x['t'][-1] < t:
                    pr = p['q']*x['c'][-1]*(1-FEE); cash += pr+p['res']; tr.append((s, p['t0'], t, pr/p['cost']-1, 'delist', p['k'])); del pos[s]
                continue
            while p['k'] < len(ladder) and x['l'][i] <= p['p0']*(1+ladder[p['k']][1]):
                px = p['p0']*(1+ladder[p['k']][1]); a = p['size']*ladder[p['k']][0]
                p['q'] += a*(1-FEE)/px; p['cost'] += a; p['res'] -= a; p['k'] += 1
            tg = p['cost']/p['q']*(1+tp)
            if x['h'][i] >= tg:
                pr = p['q']*tg*(1-FEE); cash += pr+p['res']; tr.append((s, p['t0'], t, pr/p['cost']-1, 'tp', p['k'])); del pos[s]
            elif time_exit and (t-p['t0'])/DAY >= time_exit:
                pr = p['q']*x['c'][i]*(1-FEE); cash += pr+p['res']; tr.append((s, p['t0'], t, pr/p['cost']-1, 'time', p['k'])); del pos[s]
        m = cash + sum(p['q']*C[s]['c'][C[s]['ix'][t]] if t in C[s]['ix'] else p['q']*C[s]['c'][-1] for s, p in pos.items()) + sum(p['res'] for p in pos.values())
        eq.append((t, m, cash, len(pos)))
        if log is not None: log[t] = set(pos)
        free = slots-len(pos)
        if free <= 0 or not gate(BR[t], FNG.get(t, 50)): continue
        vr = VR[t]; cand = []
        for s, k in vr.items():
            if k >= topn or s in pos: continue
            x = C[s]; i = x['ix'][t]
            if i < minage or i >= len(x['c'])-1 or x['wrsi'][i] is None or x['rsi'][i] is None: continue
            if sig(x, i):
                key = rnd.random() if rank == 'rand' else (x['wrsi'][i] if rank == 'wrsi' else x['c'][i]/x['hi180'][i])
                cand.append((key, s, i))
        cand.sort()
        for _, s, i in cand[:free]:
            size = m/slots
            if cash < size*0.999: break
            cash -= size; a = size*ladder[0][0]; x = C[s]
            pos[s] = dict(t0=t, p0=x['c'][i], size=size, q=a*(1-FEE)/x['c'][i], cost=a, res=size-a, k=1)
    return eq, tr, pos

def summ(eq, tr, pos, label):
    yrs = (eq[-1][0]-eq[0][0])/DAY/365; cagr = eq[-1][1]**(1/yrs)-1
    pk = 0; mdd = 0
    for e in eq: pk = max(pk, e[1]); mdd = min(mdd, e[1]/pk-1)
    expo = sum(1-e[2]/e[1] for e in eq)/len(eq); n = len(tr)
    tp = sum(1 for x in tr if x[4] == 'tp'); hold = sorted((x[2]-x[1])/DAY for x in tr)
    los = [x for x in tr if x[3] < 0]
    yr = {}
    for e in eq:
        y = dt.datetime.utcfromtimestamp(e[0]/1000).year; yr.setdefault(y, [e[1], e[1]]); yr[y][1] = e[1]
    ys = ' '.join(f"{y%100}:{(b/a-1)*100:+4.0f}" for y, (a, b) in yr.items())
    print(f"{label:<44} CAGR {cagr*100:5.1f}% DD {mdd*100:4.0f}% vốn {expo*100:3.0f}% | lệnh {n/yrs:3.0f}/năm TP {tp/max(n,1)*100:3.0f}% giữ {hold[len(hold)//2] if hold else 0:3.0f}d p90 {hold[int(len(hold)*.9)] if hold else 0:3.0f}d | lỗ {len(los):3d} | mở {len(pos)} | {ys}")
    return cagr, mdd

SIG = {
  'mọi ngày (ngẫu nhiên)': lambda x, i: True,
  'RSI W<35 hoặc D<25': lambda x, i: x['wrsi'][i] < 35 or x['rsi'][i] < 25,
  'RSI W<35': lambda x, i: x['wrsi'][i] < 35,
  'dd180≤-50% & RSI D<35': lambda x, i: x['c'][i] <= .5*x['hi180'][i] and x['rsi'][i] < 35,
}
GATE = {
  'không lọc': lambda b, f: True,
  'breadth≥10%': lambda b, f: b['w35'] >= .10,
  'breadth≥25%': lambda b, f: b['w35'] >= .25,
  'F&G<50': lambda b, f: f < 50,
  'breadth≥10% & F&G<50': lambda b, f: b['w35'] >= .10 and f < 50,
  'alt dd180 median≤-50%': lambda b, f: b['dd'] <= -.5,
}
if __name__ == '__main__':
    print('coins', len(C), 'dead', sum(1 for x in C.values() if x['dead']))
    for topn in (30, 50, 100):
        print(f'\n===== top {topn} alt theo volume, 8 phần vốn, 2022-01 → 2026-11 =====')
        for sn, sf in SIG.items():
            for gn, gf in GATE.items():
                if sn.startswith('mọi') and gn not in ('không lọc', 'breadth≥10% & F&G<50', 'breadth≥25%'): continue
                r = [run(sf, gf, topn=topn, seed=k) for k in range(3)]
                for k, (eq, tr, pos) in enumerate(r[:1]): summ(eq, tr, pos, f'{sn} | {gn}')
