from a5 import ladder, events, r3, trade
from lib import *
import a2
def allcoins():
    for b,v in U.items():
        k=load(v['fsym'])
        if k and len(k)>100 and v['mc']>0:
            v=dict(v); v['cs']=v['mc']/k[-1][4]; yield b,v,k
a2.coins=lambda *a,**kw: allcoins()   # events() uses coins()
def stats(sub,lab,steps,tp,stop,maxd):
    R=[x for x in (ladder(k,j,steps=steps,tp=tp,stop=stop,maxd=maxd) for k,j,c,f in sub) if x is not None]
    T=[t for t in (trade(k,j,14) for k,j,c,f in sub) if t]
    if len(R)<15: print(f'{lab:26s} n={len(R)}'); return
    W=[x for x in R if x>0];L=[x for x in R if x<=0]
    H=[t['ret'] for t in T]
    print(f'{lab:26s} n={len(R):4d} | giữ14d win={sum(x>0 for x in H)/len(H):4.0%} avg={st.mean(H):+5.1%} | 3 tầng win={len(W)/len(R):4.0%} avg={st.mean(R):+5.1%} PF={sum(W)/max(1e-9,-sum(L)):.2f}')
def feat(k,j,c):
    i=c['i'];cs=c['v']['cs']
    hist=max(r[2] for r in k[:i-3])
    vol20=sum(r[5] for r in k[i-23:i-3])/20
    return {'mc_pre':cs*k[i-3][4],'mc_now':c['v']['mc'],'vol20':vol20,'ddATH':1-k[i-3][4]/hist,'age':i}
evA=[(k,j,c,feat(k,j,c)) for k,j,c in events(lambda c: r3(c,3)>=.5,cool=10)]
evA=[e for e in evA if e[3]['age']>=90]
A=dict(steps=(0,.3,.6),tp=.2,stop=1.0,maxd=30)
B=[(0,20e6),(20e6,50e6),(50e6,100e6),(100e6,200e6),(200e6,500e6),(500e6,2e9),(2e9,1e13)]
lab=lambda lo,hi:f'{lo/1e6:.0f}-{hi/1e6:.0f}M' if hi<1e13 else f'>{lo/1e9:.0f}B'
print('=== SETUP A theo vốn hoá TRƯỚC pump (lúc tín hiệu, cs × giá 3 ngày trước)')
for lo,hi in B: stats([e for e in evA if lo<=e[3]['mc_pre']<hi],lab(lo,hi),**A)
print('=== SETUP A theo vốn hoá HIỆN TẠI (cách skill đang lọc)')
for lo,hi in B: stats([e for e in evA if lo<=e[3]['mc_now']<hi],lab(lo,hi),**A)
print('=== SETUP A theo volume TB 20 ngày trước pump (USDT/ngày, futures)')
for lo,hi in [(0,2e6),(2e6,5e6),(5e6,15e6),(15e6,50e6),(50e6,1e13)]: stats([e for e in evA if lo<=e[3]['vol20']<hi],f'vol {lo/1e6:.0f}-{hi/1e6:.0f}M',**A)
print('=== SETUP A theo % giảm từ đỉnh lịch sử trước pump')
for lo,hi in [(0,.5),(.5,.75),(.75,.9),(.9,.97),(.97,1)]: stats([e for e in evA if lo<=e[3]['ddATH']<hi],f'ddATH {lo:.0%}-{hi:.0%}',**A)
import pickle; pickle.dump([(c['b'],j,f) for k,j,c,f in evA],open('evA.pkl','wb'))
