from a2 import *
import a2
def red(c): r=c['k'][c['i']]; return r[4]<r[1]
def pumped(c,th=.5,look=5):
    i=c['i'];C=c['C'];k=c['k']
    lo=min(r[3] for r in k[i-look-3:i-1]); hi=max(r[2] for r in k[i-look:i+1])
    return hi/lo-1>=th
def first_red_after_pump(c,th=.5):
    # pump >=th within last 5 bars (low-of-8 to high-of-5), today red and closes below yesterday's low? (looser: red + close<prev close)
    i=c['i'];k=c['k']
    return pumped(c,th) and red(c) and k[i][4]<k[i-1][4]
def lower_high(c,th=.5):
    i=c['i'];k=c['k'];
    hi_idx=max(range(i-6,i+1),key=lambda j:k[j][2])
    return pumped(c,th,6) and hi_idx<=i-2 and k[i][2]<k[hi_idx][2] and red(c) and k[i][4]<k[i-1][3]
def slsim(ev,sl_buf=.03,tp=.3,maxd=30,lev_note=''):
    # SL = highest high since pump top up to signal +buf; TP fixed; result in R and %
    res=[]
    for k,j,c in ev:
        i=c['i'];top=max(r[2] for r in k[i-6:i+1]);e=k[j][1];sl=top*(1+sl_buf)
        if sl<=e: continue
        out=None
        for d in range(maxd):
            if j+d>=len(k): break
            r=k[j+d]
            if r[2]>=sl: out=-(sl/e-1)-FEE;break
            if r[3]<=e*(1-tp): out=tp-FEE;break
        if out is None:
            if j+maxd-1>=len(k): continue
            out=1-k[j+maxd-1][4]/e-FEE
        res.append((out,sl/e-1))
    if not res: return
    W=[x for x,_ in res if x>0]; risk=st.median([r for _,r in res])
    print(f'   SL top+{sl_buf:.0%} TP{tp:.0%}: n={len(res)} win={len(W)/len(res):.1%} avg/trade={st.mean(x for x,_ in res):+.1%} risk_med={risk:.1%} sumPF={sum(W)/max(1e-9,-sum(x for x,_ in res if x<=0)):.2f}')
for th in [.3,.5,1.0]:
    ev=events(lambda c,th=th: first_red_after_pump(c,th),cool=10); report(f'1stRed pump{th:.0%}',ev[:]) 
    for tp in [.2,.3]: slsim(ev,tp=tp)
    ev=events(lambda c,th=th: lower_high(c,th),cool=10); report(f'LowerHigh pump{th:.0%}',ev)
    for tp in [.2,.3]: slsim(ev,tp=tp)
