from a4 import *
import datetime
def ladder(k,j,steps=(0,.3,.6),tp=.2,stop=1.0,maxd=30):
    E=k[j][1]; levels=[E*(1+s) for s in steps]; filled=[]; 
    for d in range(maxd):
        if j+d>=len(k): return None
        r=k[j+d]
        for L in levels:
            if L not in filled and (r[2]>=L or L==E): filled.append(L)
        avg=sum(filled)/len(filled); frac=len(filled)/len(levels)
        if r[2]>=E*(1+stop): return (-(E*(1+stop)/avg-1)-FEE)*frac
        if r[3]<=avg*(1-tp): return (tp-FEE)*frac
    avg=sum(filled)/len(filled); return (1-k[j+maxd-1][4]/avg-FEE)*len(filled)/len(levels)
def run(sub,lab,**kw):
    R=[x for x in (ladder(k,j,**kw) for k,j,c,f in sub) if x is not None]
    W=[x for x in R if x>0];L=[x for x in R if x<=0]
    # equity: risk 5% of account notional per trade (size=5% equity), sequential
    eq=1;peak=1;dd=0
    for x in R: eq*=1+0.05*x*3; peak=max(peak,eq); dd=max(dd,1-eq/peak)  # 3x lev on 5% margin
    print(f'{lab:34s} {str(kw):55s} n={len(R)} win={len(W)/len(R):5.1%} avg={st.mean(R):+5.1%} worst={min(R):+5.0%} PF={sum(W)/max(1e-9,-sum(L)):.2f} | eq(5%margin x3)={eq:5.2f} maxDD={dd:4.0%}')
base=[r for r in rows if not r[3]['age<90d']]
bear=[r for r in base if r[3]['btc_bear']]
for sub,lab in [(rows,'ALL pump50'),(base,'pump50 age>=90d'),(bear,'pump50 age>=90d BTCbear')]:
    run(sub,lab,steps=(0,),tp=.2,stop=1.0)
    run(sub,lab,steps=(0,),tp=.2,stop=.5)
    run(sub,lab,steps=(0,.3,.6),tp=.2,stop=1.0)
    run(sub,lab,steps=(0,.3,.6),tp=.15,stop=1.0)
    run(sub,lab,steps=(0,.25,.5),tp=.2,stop=.8)
print('-- theo năm (pump50 age>=90d, ladder 0/30/60 TP20 stop100)')
for y in range(2020,2027):
    sub=[r for r in base if datetime.datetime.utcfromtimestamp(r[0][r[1]][0]/1000).year==y]
    if len(sub)>=10: run(sub,f'year {y}',steps=(0,.3,.6),tp=.2,stop=1.0)
