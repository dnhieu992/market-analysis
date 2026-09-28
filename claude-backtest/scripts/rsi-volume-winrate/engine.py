import numpy as np, pandas as pd, numba as nb
TFMS={'5m':3e5,'15m':9e5,'30m':1.8e6,'1h':3.6e6,'2h':7.2e6,'4h':1.44e7,'1d':8.64e7}
FEE=0.0005  # per side

def load(tf):
    d=pd.read_csv(f"data/{tf}.csv")
    return {k:d[k].to_numpy(np.float64) for k in d.columns}

@nb.njit(cache=True)
def rsi_(c,p):
    n=len(c); ru=0.0; rd=0.0; r=np.full(n,50.0); a=1.0/p
    for i in range(1,n):
        d=c[i]-c[i-1]; u=d if d>0 else 0.0; w=-d if d<0 else 0.0
        if i<=p: ru+=u/p; rd+=w/p
        else: ru=ru*(1-a)+u*a; rd=rd*(1-a)+w*a
        if i>=p: r[i]=100.0 if rd==0 else 100-100/(1+ru/rd)
    return r

def sma(x,p):
    s=pd.Series(x).rolling(p,min_periods=p).mean().to_numpy(); return np.nan_to_num(s,nan=np.inf)

def rollmax(x,p): return pd.Series(x).rolling(p,min_periods=1).max().to_numpy()
def rollmin(x,p): return pd.Series(x).rolling(p,min_periods=1).min().to_numpy()

def htf_map(ltf_t, tf, htf, p=14):
    H=load(htf); r=rsi_(H['c'],p)
    hclose=H['t']+TFMS[htf]; lclose=ltf_t+TFMS[tf]
    idx=np.searchsorted(hclose,lclose,side='right')-1
    out=np.where(idx>=0,r[np.maximum(idx,0)],50.0); return out

@nb.njit(cache=True)
def sim(sig_idx, direction, o,h,l,c, slmode, slpar, swing_lo, swing_hi, rr, maxhold, t_year):
    # returns arrays of per-trade (R_net, win, year)
    n=len(o); m=len(sig_idx)
    Rs=np.empty(m); W=np.empty(m,np.int8); Y=np.empty(m,np.int32); k=0
    busy=-1
    for s in range(m):
        i=sig_idx[s]
        if i<=busy or i+1>=n: continue
        e=o[i+1]
        if direction==1:
            sl = swing_lo[i]*(1-slpar) if slmode==0 else e*(1-slpar)
            risk=e-sl
        else:
            sl = swing_hi[i]*(1+slpar) if slmode==0 else e*(1+slpar)
            risk=sl-e
        if risk<=e*0.001: continue   # min 0.1% stop so fees don't dominate
        if risk>e*0.08: continue
        tp = e+direction*rr*risk
        res=0.0; win=0; j=i+1; done=False
        while j<n and j<=i+maxhold:
            if direction==1:
                if l[j]<=sl: res=-1.0; done=True; break
                if h[j]>=tp: res=rr; win=1; done=True; break
            else:
                if h[j]>=sl: res=-1.0; done=True; break
                if l[j]<=tp: res=rr; win=1; done=True; break
            j+=1
        if not done:
            j=min(j,n-1); res=direction*(c[j]-e)/risk; win=1 if res>0 else 0
        feeR=2*FEE*e/risk
        Rs[k]=res-feeR; W[k]=win; Y[k]=t_year[i]; k+=1
        busy=j
    return Rs[:k],W[:k],Y[:k]
