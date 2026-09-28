import numpy as np, pandas as pd
from engine import *
TF='15m'; D=load(TF); o,h,l,c,v,t=D['o'],D['h'],D['l'],D['c'],D['v'],D['t']
year=pd.to_datetime(t,unit='ms').year.to_numpy().astype(np.int32)
vr=v/sma(v,20); r=rsi_(c,7); rp=np.roll(r,1); r1h=htf_map(t,TF,'1h'); rd=htf_map(t,TF,'1d')
sw=(rollmin(l,3),rollmax(h,3))
base=(rp>=50)&(r<50)&(c<o)&(vr>=3)
for lbl,m in [('A: +1h RSI 60-70 +1D RSI 40-60',base&(r1h>60)&(r1h<=70)&(rd>40)&(rd<=60)),
              ('B: +1h RSI 60-70 only',base&(r1h>60)&(r1h<=70)),
              ('C: +1h RSI >60 only',base&(r1h>60)),
              ('D: no HTF filter',base)]:
    idx=np.nonzero(m)[0].astype(np.int64); idx=idx[idx>60]
    for rr in (1.0,1.25):
        Rs,W,Y=sim(idx,-1,o,h,l,c,0,0.0,sw[0],sw[1],rr,2000,year)
        yrs=' '.join(f"{y}:{W[Y==y].sum()}/{(Y==y).sum()}" for y in (2024,2025,2026))
        print(f"{lbl:34s} RR{rr}: n={len(W)} WR={W.mean()*100:.1f}% expR={Rs.mean():.3f} totR={Rs.sum():.1f} | {yrs}")
