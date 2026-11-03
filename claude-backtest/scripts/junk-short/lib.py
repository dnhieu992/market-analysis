import json,os,statistics as st
U=json.load(open('universe.json'))
def load(sym):
    p=f'kl/{sym}_1d.json'
    return json.load(open(p)) if os.path.exists(p) else None
BTC=load('BTCUSDT'); 
def ema(xs,n):
    k=2/(n+1);o=[];e=None
    for x in xs: e=x if e is None else e+k*(x-e); o.append(e)
    return o
btc_close={r[0]:r[4] for r in BTC}; be=ema([r[4] for r in BTC],50); btc_bear={r[0]:(r[4]<be[i]) for i,r in enumerate(BTC)}
def coins(lo=0,hi=100e6):
    for b,v in U.items():
        if lo<v['mc']<=hi:
            k=load(v['fsym'])
            if k and len(k)>40: yield b,v,k
FEE=0.001
def trade(k,i,hold):
    """short at open of bar i; return dict of metrics over hold bars"""
    e=k[i][1]; j=min(len(k)-1,i+hold-1)
    if i+hold-1>=len(k): return None
    hi=max(r[2] for r in k[i:j+1]); 
    ret=1-k[j][4]/e-FEE
    return {'ret':ret,'mae':hi/e-1}
def tp_hit(k,i,tp,maxd):
    e=k[i][1]; mx=e
    for d in range(maxd):
        if i+d>=len(k): return None
        r=k[i+d]; mx=max(mx,r[2])
        if r[3]<=e*(1-tp): return {'hit':True,'days':d+1,'mae':mx/e-1}
    return {'hit':False,'days':maxd,'mae':mx/e-1,'end':1-k[i+maxd-1][4]/e}
def pct(xs,q): xs=sorted(xs); return xs[min(len(xs)-1,int(q*len(xs)))] if xs else float('nan')
def summ(name,rs):
    if not rs: print(name,'n=0');return
    R=[r['ret'] for r in rs];M=[r['mae'] for r in rs]
    print(f"{name:42s} n={len(rs):5d} win={sum(x>0 for x in R)/len(R):5.1%} med={st.median(R):+6.1%} avg={st.mean(R):+6.1%} | MAE med={st.median(M):5.1%} p90={pct(M,.9):6.1%} max={max(M):6.0%}")
def tpsumm(name,rs):
    rs=[r for r in rs if r]
    if not rs: return
    h=[r for r in rs if r['hit']];M=[r['mae'] for r in rs]
    print(f"{name:42s} n={len(rs):5d} hit={len(h)/len(rs):5.1%} days_med={st.median([r['days'] for r in h]) if h else 0:4.1f} | MAE med={st.median(M):5.1%} p90={pct(M,.9):6.1%} max={max(M):6.0%} | miss end med={st.median([r['end'] for r in rs if not r['hit']]) if len(h)<len(rs) else 0:+.1%}")
