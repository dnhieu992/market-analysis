"""Path-independent view: every signal is traded on its own (ladder + TP, no SL), scanned up to 180 days."""
import json, multiprocessing as mp
import strategies as S
from sim import FEE, BASE
from lib import START_2024, utc
M=S.D['15m']; T,O,H,Lo,C=M['t'],M['o'],M['h'],M['l'],M['c']; IDX=M['_idx']
CAPB=180*96
LAD={'không DCA':[], 'DCA +3/+6/+10 (1-1-2)':[(3,1),(6,1),(10,2)], 'DCA +5/+10/+15 (1-1-2)':[(5,1),(10,1),(15,2)]}
def one(i,tp,lad):
    first=O[i]; coins=BASE/first; cost=BASE; avg=first; lv=0; fees=BASE*FEE; maxh=first
    end=min(len(T),i+CAPB)
    for k in range(i,end):
        if H[k]>maxh: maxh=H[k]
        filled=False
        while lv<len(lad):
            p,m=lad[lv]; lvl=first*(1+p/100)
            if H[k]<lvl: break
            px=max(lvl,O[k]) if k!=i else lvl; a=BASE*m; coins+=a/px; cost+=a; avg=cost/coins; fees+=a*FEE; lv+=1; filled=True
        if not filled and Lo[k]<=avg*(1-tp/100):
            ex=min(avg*(1-tp/100),O[k]) if k!=i else avg*(1-tp/100)
            return {'ok':1,'days':(k+1-i)/96,'mae':(maxh/first-1)*100,'net':coins*(avg-ex)-fees-coins*ex*FEE,'fills':lv+1,'notl':cost}
    last=C[end-1]
    return {'ok':0,'days':(end-i)/96,'mae':(maxh/first-1)*100,'net':coins*(avg-last)-fees-coins*last*FEE,'fills':lv+1,'notl':cost,'cens':end==len(T)}
def pct(a,q): a=sorted(a); return a[min(len(a)-1,int(q*(len(a)-1)))] if a else 0
def job(a):
    name,fk,tp,lad,sig=a
    xs=[(i,one(i,tp,LAD[lad])) for i in sig]
    if not xs: return None
    r=[x for _,x in xs]; ok=[x for x in r if x['ok']]
    res={'strategy':name,'filter':fk,'tp':tp,'ladder':lad,'n':len(r),
         'per_week':len(r)/((T[-1]-START_2024)/604800000),
         'tp_1d':sum(1 for x in ok if x['days']<=1)/len(r)*100,'tp_3d':sum(1 for x in ok if x['days']<=3)/len(r)*100,
         'tp_7d':sum(1 for x in ok if x['days']<=7)/len(r)*100,'tp_30d':sum(1 for x in ok if x['days']<=30)/len(r)*100,
         'stuck':sum(1 for x in r if not x['ok'] and not x.get('cens')),'open_end':sum(1 for x in r if x.get('cens')),
         'mae_p50':pct([x['mae'] for x in r],.5),'mae_p90':pct([x['mae'] for x in r],.9),'mae_p99':pct([x['mae'] for x in r],.99),'mae_max':max(x['mae'] for x in r),
         'mae20':sum(1 for x in r if x['mae']>=20),'full_ladder':sum(1 for x in r if x['fills']==len(LAD[lad])+1) if LAD[lad] else 0,
         'days_p90':pct([x['days'] for x in r],.9),
         'avg_net':sum(x['net'] for x in r)/len(r),
         'worst':[(utc(T[i]).strftime('%Y-%m-%d %H:%M'),round(x['mae'],1),round(x['days'],1),x['ok']) for i,x in sorted(xs,key=lambda z:-z[1]['mae'])[:3]],
         'years':{}}
    for y in (2024,2025,2026):
        ys=[x for i,x in xs if utc(T[i]).year==y]
        res['years'][y]=(len(ys), round(sum(1 for x in ys if x['ok'] and x['days']<=7)/len(ys)*100,0) if ys else 0, round(max([x['mae'] for x in ys]+[0]),1))
    return res
if __name__=='__main__':
    GEN=dict((k,f()) for k,f in S.STRATS.items() if not k.startswith('['))
    GEN['Pump +2.5%/4h rồi short']=S.pump_fade('1h',4,2.5)
    GEN['Pump +4%/12h rồi short']=S.pump_fade('1h',12,4.0)
    jobs=[]
    for k,v in GEN.items():
        for fk,f in S.FILTERS.items():
            es=[e for e in v if e>=START_2024 and (f is None or f(e))]
            # one signal per 4h cluster (the first one)
            sig=[]; last=-1
            for e in sorted(es):
                if e in IDX and e-last>=4*3600000: sig.append(IDX[e]); last=e
            for tp in (1.0,1.5,2.0,3.0):
                for lad in LAD: jobs.append((k,fk,tp,lad,sig))
    with mp.get_context('fork').Pool(8) as p: res=[x for x in p.map(job,jobs,chunksize=2) if x]
    json.dump(res,open('per_signal.json','w'),ensure_ascii=False,default=str); print(len(res))
