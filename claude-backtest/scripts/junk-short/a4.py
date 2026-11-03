from a2 import *
from a3 import slsim
import datetime
ev=events(lambda c: r3(c,3)>=.5, cool=10, mc=(0,100e6))
print('base n',len(ev))
def feats(k,j,c):
    i=c['i'];C=c['C'];r=k[i]
    hi90=max(x[2] for x in k[max(0,i-90):i-3]) if i>10 else r[2]
    return {
     'btc_bear': btc_bear.get(r[0]),
     'volx>5': volx(c)>5,
     'wick>0.4': wick(c)>.4,
     'red_signal_day': r[4]<r[1],
     'age<90d': i<90,
     'age<180d': i<180,
     'monitoring': 'Monitoring' in (c['v']['tags'] or []),
     'below_90dHigh': C[i]<hi90,
     'mc<20M': c['v']['mc']<20e6,
     'below_ema50_before': C[i-4]<c['e50'][i-4],
     'year>=2025': datetime.datetime.utcfromtimestamp(r[0]/1000).year>=2025,
     'pump>=100%': r3(c,3)>=1.0,
    }
rows=[(k,j,c,feats(k,j,c)) for k,j,c in ev]
def m(sub,lab):
    T=[t for t in (trade(k,j,14) for k,j,c,f in sub) if t]
    if len(T)<20: print(f'{lab:28s} n={len(T)}');return
    R=[t['ret'] for t in T];M=[t['mae'] for t in T]
    print(f'{lab:28s} n={len(T):4d} win14={sum(x>0 for x in R)/len(R):5.1%} avg14={st.mean(R):+6.1%} med14={st.median(R):+6.1%} MAEp90={pct(M,.9):5.0%} MAE>100%={sum(x>1 for x in M)/len(M):5.1%}')
m(rows,'ALL')
for key in rows[0][3]:
    m([r for r in rows if r[3][key]],f'{key}=Y'); m([r for r in rows if not r[3][key]],f'{key}=N')
