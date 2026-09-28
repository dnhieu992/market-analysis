import numpy as np, pandas as pd, sys, itertools, os, time
from multiprocessing import Pool
from engine import *

TF=sys.argv[1]; MINTR=int(sys.argv[2]) if len(sys.argv)>2 else 30
D=load(TF); o,h,l,c,v,t=D['o'],D['h'],D['l'],D['c'],D['v'],D['t']
n=len(c)
year=pd.to_datetime(t,unit='ms').year.to_numpy().astype(np.int32)
vr=v/sma(v,20)
bull=c>o; bear=c<o
R={p:rsi_(c,p) for p in (7,14,21)}
HT={}
for htf in ('4h','1d'):
    if TFMS[htf]>TFMS[TF]: HT[htf]=htf_map(t,TF,htf)
SW={k:(rollmin(l,k),rollmax(h,k)) for k in (3,5,10,20)}

def prev(x,fill):
    y=np.roll(x,1); y[0]=fill; return y

def signals():
    """yield (name, params, mask_long, mask_short)"""
    for p in (7,14,21):
        r=R[p]; rp=prev(r,50); rs=100-r; rsp=100-rp
        for os_ in (20,25,30,35):
            yield ('rsi_cross_back',dict(p=p,os=os_), (rp<os_)&(r>=os_)&bull, (rsp<os_)&(rs>=os_)&bear)
            yield ('rsi_extreme_bar',dict(p=p,os=os_), (r<os_), (rs<os_))
            m1=(prev(r,50)<os_)&prev(bear,False); s1=(prev(rs,50)<os_)&prev(bull,False)
            yield ('extreme_then_reversal_bar',dict(p=p,os=os_), m1&bull&(c>prev(h,np.inf)*0+ (prev(o,0)+prev(c,0))/2), s1&bear&(c<(prev(o,0)+prev(c,0))/2))
        for L in (50,55,60):
            yield ('rsi_momentum_cross',dict(p=p,L=L),(rp<L)&(r>=L)&bull,(rsp<L)&(rs>=L)&bear)
        for N in (10,20,50):
            hh=prev(rollmax(h,N),np.inf); ll=prev(rollmin(l,N),-np.inf)
            for L in (50,60):
                yield ('breakout',dict(p=p,N=N,L=L),(c>hh)&(r>L),(c<ll)&(rs>L))
            rmin=prev(rollmin(r,N),0); rmax=prev(rollmax(r,N),100)
            for os_ in (30,40):
                dl=(l<prev(rollmin(l,N),-np.inf))&(r>rmin+3)&(rmin<os_)
                ds=(h>prev(rollmax(h,N),np.inf))&(r<rmax-3)&(rmax>100-os_)
                dl2=dl|prev(dl,False); ds2=ds|prev(ds,False)
                yield ('rsi_divergence',dict(p=p,N=N,os=os_),dl2&bull,ds2&bear)

VC={'none':np.ones(n,bool),'v>=1':vr>=1,'v>=1.5':vr>=1.5,'v>=2':vr>=2,'v>=3':vr>=3,'v<1':vr<1}
EXITS=[('swing',k,b) for k in (3,5,10,20) for b in (0.0,0.002)]+[('pct',0,p) for p in (0.005,0.01,0.02,0.03,0.05)]
RRS=(1.0,1.25,1.5,2.0)

def jobs():
    for name,prm,ml,ms in signals():
        for vk,vm in VC.items():
            for hk in ['none']+list(HT):
                if hk=='none': fl=fs=True
                else: fl=HT[hk]>50; fs=HT[hk]<50
                for d,m in ((1,ml&vm&fl),(-1,ms&vm&fs)):
                    idx=np.nonzero(m)[0].astype(np.int64)
                    idx=idx[idx>60]
                    if len(idx)<MINTR: continue
                    yield (name,prm,vk,hk,d,idx)

def run(job):
    name,prm,vk,hk,d,idx=job; out=[]
    for (sm,k,b) in EXITS:
        lo,hi=SW[k] if sm=='swing' else SW[3]
        for rr in RRS:
            Rs,W,Y=sim(idx,d,o,h,l,c,0 if sm=='swing' else 1,b,lo,hi,rr,2000,year)
            nt=len(Rs)
            if nt<MINTR: continue
            wr=W.mean()
            if wr<0.5: continue
            yr={}
            for y in (2024,2025,2026):
                mk=Y==y; yr[y]=(int(mk.sum()), float(W[mk].mean()) if mk.any() else np.nan, float(Rs[mk].sum()))
            gp=Rs[Rs>0].sum(); gl=-Rs[Rs<0].sum()
            out.append(dict(tf=TF,family=name,params=str(prm),vol=vk,htf=hk,side='LONG' if d==1 else 'SHORT',
                sl=f"{sm}{k}+{b*100:.1f}%" if sm=='swing' else f"pct{b*100:.1f}%",rr=rr,trades=nt,wr=round(wr*100,1),
                expR=round(Rs.mean(),3),totR=round(Rs.sum(),1),pf=round(gp/max(gl,1e-9),2),
                n24=yr[2024][0],wr24=round(yr[2024][1]*100,1),n25=yr[2025][0],wr25=round(yr[2025][1]*100,1),
                n26=yr[2026][0],wr26=round(yr[2026][1]*100,1),R24=round(yr[2024][2],1),R25=round(yr[2025][2],1),R26=round(yr[2026][2],1)))
    return out

if __name__=='__main__':
    t0=time.time(); J=list(jobs()); print(TF,'signal sets',len(J),flush=True)
    with Pool(8) as P:
        res=[r for part in P.imap_unordered(run,J,chunksize=4) for r in part]
    df=pd.DataFrame(res); os.makedirs('out',exist_ok=True)
    df.to_csv(f'out/{TF}.csv',index=False)
    print(TF,'rows',len(df),'secs',round(time.time()-t0))
    if len(df):
        good=df[(df.expR>0)]
        print('WR>=60 & expR>0:',(good.wr>=60).sum(),' WR>=70:',(good.wr>=70).sum(),' WR>=80:',(good.wr>=80).sum())
        print(good.sort_values(['wr','trades'],ascending=False).head(15).to_string())
