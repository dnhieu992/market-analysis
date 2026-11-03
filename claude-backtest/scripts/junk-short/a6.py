from a5 import *
def bounce_ema(c):
    i=c['i'];k=c['k'];C=c['C'];e20=c['e20'];e50=c['e50']
    if i<60: return False
    down = e20[i]<e50[i] and e50[i]<e50[i-10] and C[i-5]<e20[i-5]
    touch = k[i][2]>=e20[i] and C[i]<e50[i]
    return down and touch and k[i][4]<k[i][1]
for mc,lab in [((0,50e6),'<50M'),((0,100e6),'<100M')]:
    ev=events(bounce_ema,cool=7,mc=mc)
    rs=[(k,j,c,{'btc_bear':btc_bear.get(k[c['i']][0]),'age':c['i']>=90}) for k,j,c in ev]
    rs=[r for r in rs if r[3]['age']]
    for sub,l in [(rs,lab),([r for r in rs if r[3]['btc_bear']],lab+' BTCbear')]:
        summ('EMA bounce '+l+' hold14',[t for t in (trade(k,j,14) for k,j,c,f in sub) if t])
        run(sub,'EMA bounce '+l,steps=(0,),tp=.1,stop=.3,maxd=20)
        run(sub,'EMA bounce '+l,steps=(0,.15,.3),tp=.1,stop=.5,maxd=20)
        run(sub,'EMA bounce '+l,steps=(0,.15,.3),tp=.15,stop=.5,maxd=30)
    # signals per month
    import collections; mo=collections.Counter(datetime.datetime.utcfromtimestamp(k[j][0]/1000).strftime('%Y-%m') for k,j,c,f in rs)
    print(lab,'signals/month median',st.median(mo.values()))
