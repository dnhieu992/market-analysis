from lib import *
print('== 1. Drift: short ngẫu nhiên mỗi 7 ngày, giữ N ngày (theo vốn hoá)')
for lo,hi,lab in [(0,20e6,'<20M'),(20e6,50e6,'20-50M'),(50e6,100e6,'50-100M'),(100e6,300e6,'100-300M')]:
    for H in [7,30,90]:
        rs=[]
        for b,v,k in coins(lo,hi):
            for i in range(1,len(k),7):
                t=trade(k,i,H); 
                if t: rs.append(t)
        summ(f'{lab} hold {H}d',rs)
print('== 1b. Monitoring tag vs không')
for flag in [True,False]:
    rs=[]
    for b,v,k in coins(0,100e6):
        if ('Monitoring' in (v['tags'] or []))!=flag: continue
        for i in range(1,len(k),7):
            t=trade(k,i,30)
            if t: rs.append(t)
    summ(f'Monitoring={flag} hold 30d',rs)
print('== 2. Sau khi list futures: short open ngày 2, giữ N')
for H in [7,14,30,60,90,180]:
    rs=[trade(k,1,H) for b,v,k in coins(0,300e6)]; summ(f'listing short hold {H}d',[r for r in rs if r])
print('== 2b. listing: TP hit')
for tp in [.2,.3,.5]:
    tpsumm(f'listing TP{tp:.0%} trong 60d',[tp_hit(k,1,tp,60) for b,v,k in coins(0,300e6)])
