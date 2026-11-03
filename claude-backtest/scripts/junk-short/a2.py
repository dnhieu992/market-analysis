from lib import *
def events(cond,entry_delay=1,mc=(0,100e6),cool=5):
    out=[]
    for b,v,k in coins(*mc):
        C=[r[4] for r in k]; e20=ema(C,20); e50=ema(C,50); last=-99
        vol=[r[5] for r in k]
        for i in range(30,len(k)-1):
            if i-last<cool: continue
            ctx=dict(k=k,i=i,C=C,e20=e20,e50=e50,vol=vol,b=b,v=v)
            if cond(ctx):
                j=i+entry_delay
                if j<len(k): out.append((k,j,ctx)); last=i
    return out
def report(name,ev):
    for H in [3,7,14,30]: summ(f'{name} hold{H}d',[t for t in (trade(k,j,H) for k,j,c in ev) if t])
    for tp in [.1,.2,.3]: tpsumm(f'{name} TP{tp:.0%}/30d',[tp_hit(k,j,tp,30) for k,j,c in ev])
r3=lambda c,n: c['C'][c['i']]/c['C'][c['i']-n]-1
volx=lambda c: c['vol'][c['i']]/(sum(c['vol'][c['i']-20:c['i']])/20+1e-9)
def wick(c):
    r=c['k'][c['i']]; rng=r[2]-r[3]; return (r[2]-max(r[1],r[4]))/rng if rng else 0
print('=== 3. Pump fade (vào open ngày sau)')
for th in [.3,.5,1.0]:
    report(f'pump3d>={th:.0%}',events(lambda c,th=th: r3(c,3)>=th))
print('=== 3b. Pump 1d>=30%')
report('pump1d>=30%',events(lambda c: r3(c,1)>=.3))
