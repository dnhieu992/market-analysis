# Round 2: LTF trigger + volume + two higher-TF RSI "zone" filters (confluence)
import numpy as np, pandas as pd, sys, os, time
from multiprocessing import Pool
from engine import *
TF=sys.argv[1]; MINTR=int(sys.argv[2]) if len(sys.argv)>2 else 30
D=load(TF); o,h,l,c,v,t=D['o'],D['h'],D['l'],D['c'],D['v'],D['t']; n=len(c)
year=pd.to_datetime(t,unit='ms').year.to_numpy().astype(np.int32)
vr=v/sma(v,20); bull=c>o; bear=c<o
R={p:rsi_(c,p) for p in (7,14,21)}
order=['5m','15m','30m','1h','2h','4h','1d']
highers=[x for x in order if TFMS[x]>TFMS[TF]]
H1=highers[1] if len(highers)>2 else highers[0]  # a mid HTF
H1={'5m':'1h','15m':'1h','30m':'4h','1h':'4h','2h':'1d','4h':'1d'}[TF]
HT={'mid':htf_map(t,TF,H1)}
if H1!='1d': HT['day']=htf_map(t,TF,'1d')
SW={k:(rollmin(l,k),rollmax(h,k)) for k in (3,5,10,20)}
def prev(x,f): y=np.roll(x,1); y[0]=f; return y
def triggers():
    for p in (7,14,21):
        r=R[p]; rp=prev(r,50); rs=100-r; rsp=100-rp
        for os_ in (20,25,30,35,40):
            yield ('rsi_cross_back',dict(p=p,os=os_),(rp<os_)&(r>=os_)&bull,(rsp<os_)&(rs>=os_)&bear)
        for L in (50,55,60):
            yield ('rsi_momentum_cross',dict(p=p,L=L),(rp<L)&(r>=L)&bull,(rsp<L)&(rs>=L)&bear)
        for N in (10,20):
            rmin=prev(rollmin(r,N),0); rmax=prev(rollmax(r,N),100)
            for os_ in (30,40):
                dl=(l<prev(rollmin(l,N),-np.inf))&(r>rmin+3)&(rmin<os_)
                ds=(h>prev(rollmax(h,N),np.inf))&(r<rmax-3)&(rmax>100-os_)
                yield ('rsi_divergence',dict(p=p,N=N,os=os_),(dl|prev(dl,False))&bull,(ds|prev(ds,False))&bear)
VC={'none':np.ones(n,bool),'v>=1':vr>=1,'v>=1.5':vr>=1.5,'v>=2':vr>=2,'v>=3':vr>=3,'v<1':vr<1}
ZONES=[(0,100)]+[(a,b) for a in (0,30,40,50,60) for b in (40,50,60,70,100) if a<b and (a,b)!=(0,100)]
EXITS=[('swing',k,b) for k in (3,10) for b in (0.0,0.002)]+[('pct',0,p) for p in (0.003,0.005,0.0075,0.01,0.015,0.02,0.03)]
RRS=(1.0,1.25,1.5,2.0)
def zm(key,z,d):
    if key not in HT or z==(0,100): return True
    x=HT[key] if d==1 else 100-HT[key]   # mirrored for shorts
    return (x>=z[0])&(x<z[1])
def jobs():
    for name,prm,ml,ms in triggers():
        for vk,vm in VC.items():
            for d,base in ((1,ml&vm),(-1,ms&vm)):
                if base.sum()<MINTR: continue
                for z1 in ZONES:
                    m1=base&zm('mid',z1,d)
                    if np.sum(m1)<MINTR: continue
                    for z2 in (ZONES if 'day' in HT else [(0,100)]):
                        m=m1&zm('day',z2,d); idx=np.nonzero(m)[0].astype(np.int64); idx=idx[idx>60]
                        if len(idx)>=MINTR: yield (name,prm,vk,z1,z2,d,idx)
def run(job):
    name,prm,vk,z1,z2,d,idx=job; out=[]
    for (sm,k,b) in EXITS:
        lo,hi=SW[k] if sm=='swing' else SW[3]
        for rr in RRS:
            Rs,W,Y=sim(idx,d,o,h,l,c,0 if sm=='swing' else 1,b,lo,hi,rr,2000,year)
            nt=len(Rs)
            if nt<MINTR: continue
            wr=W.mean()
            if wr<0.5: continue

            row=dict(tf=TF,family=name,params=str(prm),vol=vk,midTF=H1,midZone=f"{z1[0]}-{z1[1]}",dayZone=f"{z2[0]}-{z2[1]}",
                side='LONG' if d==1 else 'SHORT',sl=f"{sm}{k}+{b*100:.1f}%" if sm=='swing' else f"pct{b*100:.1f}%",rr=rr,
                trades=nt,wr=round(wr*100,1),expR=round(Rs.mean(),3),totR=round(Rs.sum(),1))
            for y in (2024,2025,2026):
                mk=Y==y; row[f'n{y%100}']=int(mk.sum()); row[f'wr{y%100}']=round(W[mk].mean()*100,1) if mk.any() else np.nan
            out.append(row)
    return out
if __name__=='__main__':
    t0=time.time(); J=list(jobs()); print(TF,'signal sets',len(J),flush=True)
    with Pool(8) as P: res=[r for part in P.imap_unordered(run,J,chunksize=16) for r in part]
    df=pd.DataFrame(res); df.to_csv(f'out/hf_{TF}.csv',index=False)
    print(TF,'rows(WR>=60,exp>0)',len(df),'secs',round(time.time()-t0))
    if len(df):
        df['minyr']=df[['wr24','wr25','wr26']].min(axis=1)
        print(' WR>=70:',(df.wr>=70).sum(),' WR>=80:',(df.wr>=80).sum(), ' WR>=80 & each yr>=70 & n26>=8:',((df.wr>=80)&(df.minyr>=70)&(df.n26>=8)).sum())
