import numpy as np, pandas as pd, glob, ast, sys
from engine import *
MID={'5m':'1h','15m':'1h','30m':'4h','1h':'4h','2h':'1d','4h':'1d'}
cache={}
def ctx(tf):
    if tf in cache: return cache[tf]
    D=load(tf); o,h,l,c,v,t=D['o'],D['h'],D['l'],D['c'],D['v'],D['t']
    X=dict(o=o,h=h,l=l,c=c,t=t,year=pd.to_datetime(t,unit='ms').year.to_numpy().astype(np.int32),
      vr=v/sma(v,20),bull=c>o,bear=c<o,R={p:rsi_(c,p) for p in (7,14,21)},mid=htf_map(t,tf,MID[tf]),
      day=htf_map(t,tf,'1d') if MID[tf]!='1d' else None,SW={k:(rollmin(l,k),rollmax(h,k)) for k in (3,5,10,20)})
    cache[tf]=X; return X
def prev(x,f): y=np.roll(x,1); y[0]=f; return y
def mask(r):
    X=ctx(r.tf); p=ast.literal_eval(r.params); d=1 if r.side=='LONG' else -1
    R=X['R'][p['p']]; rr_=R if d==1 else 100-R; rp=prev(rr_,50); l,h=X['l'],X['h']
    cand=X['bull'] if d==1 else X['bear']
    if r.family=='rsi_cross_back': m=(rp<p['os'])&(rr_>=p['os'])&cand
    elif r.family=='rsi_momentum_cross': m=(rp<p['L'])&(rr_>=p['L'])&cand
    else:
        N=p['N']
        if d==1:
            rmin=prev(rollmin(R,N),0); dv=(l<prev(rollmin(l,N),-np.inf))&(R>rmin+3)&(rmin<p['os'])
        else:
            rmax=prev(rollmax(R,N),100); dv=(h>prev(rollmax(h,N),np.inf))&(R<rmax-3)&(rmax>100-p['os'])
        m=(dv|prev(dv,False))&cand
    vr=X['vr']; vc={'none':True,'v>=1':vr>=1,'v>=1.5':vr>=1.5,'v>=2':vr>=2,'v>=3':vr>=3,'v<1':vr<1}[r.vol]
    m=m&vc
    for key,z in (('mid',r.midZone),('day',r.dayZone)):
        a,b=map(int,z.split('-'))
        if (a,b)==(0,100) or X[key] is None: continue
        x=X[key] if d==1 else 100-X[key]; m=m&(x>=a)&(x<b)
    return m,d
def trades(r):
    X=ctx(r.tf); m,d=mask(r); idx=np.nonzero(m)[0].astype(np.int64); idx=idx[idx>60]
    sl=r.sl; 
    if sl.startswith('swing'):
        k=int(sl[5:sl.index('+')]); b=float(sl[sl.index('+')+1:-1])/100; mode=0
    else: k=3; b=float(sl[3:-1])/100; mode=1
    lo,hi=X['SW'][k]
    Rs,W,Y=sim(idx,d,X['o'],X['h'],X['l'],X['c'],mode,b,lo,hi,float(r.rr),2000,X['year'])
    # recover entry times: re-run cheaply by replicating busy logic isn't exposed; approximate with signal times of taken trades
    return Rs,W,Y
if __name__=='__main__':
    th=float(sys.argv[1]); maxk=int(sys.argv[2])
    df=pd.concat([pd.read_csv(f) for f in glob.glob('out/wf_*.csv')])
    df['nIS']=df.n24+df.n25; df['wrIS']=(df.wr24.fillna(0)*df.n24+df.wr25.fillna(0)*df.n25)/df.nIS
    s=df[(df.wrIS>=th)&(df.nIS>=20)].sort_values(['wrIS','nIS'],ascending=False)
    # de-duplicate: keep one exit per signal definition
    s=s.drop_duplicates(['tf','family','params','vol','midZone','dayZone','side']).head(maxk)
    allW=[];allY=[];allR=[]
    for r in s.itertuples():
        Rs,W,Y=trades(r); allW.append(W); allY.append(Y); allR.append(Rs)
    W=np.concatenate(allW);Y=np.concatenate(allY);Rs=np.concatenate(allR)
    days={2024:366,2025:365,2026:271}
    print(f'IS WR>={th}: {len(s)} strategies (selected on 2024-25 only)')
    for y in (2024,2025,2026):
        mk=Y==y; print(f'  {y}: trades={mk.sum()} ({mk.sum()/days[y]:.2f}/day) WR={W[mk].mean()*100:.1f}% totR={Rs[mk].sum():.1f}')
