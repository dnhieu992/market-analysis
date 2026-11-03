import sys,io,contextlib,datetime
with contextlib.redirect_stdout(io.StringIO()):
    import b1
from b1 import *
yr=lambda e: datetime.datetime.utcfromtimestamp(e[0][e[1]][0]/1000).year
D={
 'D0 hiện tại: cap NOW ≤100M': lambda f: f['mc_now']<=100e6,
 'D1 cap trước pump ≤100M': lambda f: f['mc_pre']<=100e6,
 'D2 cap trước pump ≤500M': lambda f: f['mc_pre']<=500e6,
 'D3 cap trước pump 20–500M': lambda f: 20e6<=f['mc_pre']<=500e6,
 'D4 ≤500M + giảm ≥50% từ ATH': lambda f: f['mc_pre']<=500e6 and f['ddATH']>=.5,
 'D5 20–500M + giảm ≥50% ATH': lambda f: 20e6<=f['mc_pre']<=500e6 and f['ddATH']>=.5,
 'D6 chỉ giảm ≥75% ATH, ≤2B': lambda f: f['mc_pre']<=2e9 and f['ddATH']>=.75,
}
for name,fn in D.items():
    sub=[e for e in evA if fn(e[3])]
    stats(sub,name,**A)
    bear=[e for e in sub if btc_bear.get(e[0][e[2]['i']][0])]
    stats(bear,'   + BTC bear',**A)
    ys=[]
    for y in range(2021,2027):
        s=[e for e in sub if yr(e)==y]
        R=[x for x in (ladder(k,j,**A) for k,j,c,f in s) if x is not None]
        W=sum(x for x in R if x>0);L=-sum(x for x in R if x<=0)
        ys.append(f"{y%100}:{W/L if L else 99:.1f}({len(R)})")
    print('   PF theo năm',' '.join(ys))
