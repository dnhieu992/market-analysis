import json, sys, multiprocessing as mp
import strategies as S
from sim import summarize
from sim_multi import simulate_multi
L={'none':[], 'A':[(3,1),(6,1),(10,2)], 'B':[(5,1),(10,1),(15,2)]}
GEN={}
for bars in (3,4,6,12):
    for pct in (2.0,2.5,3.0,4.0):
        GEN[f'pump {pct}%/{bars}h']=S.pump_fade('1h',bars,pct)
for lr in ((5,3),(3,2),(8,4)):
    for mr in (55,60,65):
        GEN[f'div H1 L{lr[0]}R{lr[1]} rsi>={mr}']=S.rsi_bear_div('1h',lr[0],lr[1],60,mr)
GEN['div H4 L5R3 rsi>=60']=S.rsi_bear_div('4h',5,3,60,60)
GEN['div 15m L5R3 rsi>=60']=S.rsi_bear_div('15m',5,3,60,60)
SIG={}
for k,v in GEN.items():
    for fk in ('none','D1<EMA50','H4<EMA200'):
        f=S.FILTERS[fk]; SIG[(k,fk)]=v if f is None else [e for e in v if f(e)]
def job(a):
    k,fk,tp,lad,mp_=a
    r=simulate_multi(S.D['15m'],SIG[(k,fk)],tp,L[lad],max_pos=mp_)
    if r is None: return None
    s=summarize(r); s.update(strategy=k,filter=fk,tp=tp,ladder=lad,max_pos=mp_); s['by_year']={str(a):b for a,b in s['by_year'].items()}; return s
if __name__=='__main__':
    jobs=[(k,fk,tp,lad,m) for (k,fk) in SIG for tp in (1.0,1.5,2.0) for lad in L for m in (1,2,3)]
    with mp.get_context('fork').Pool(8) as p: res=[x for x in p.map(job,jobs,chunksize=8) if x]
    json.dump(res,open('robust.json','w'),ensure_ascii=False,default=str); print(len(res))
