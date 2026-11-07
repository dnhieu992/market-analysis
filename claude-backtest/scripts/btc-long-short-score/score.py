import pickle, math, random
from lib import utc
rows=pickle.load(open('rows.pkl','rb'))
TEST_FROM=1735689600000  # 2025-01-01
def comb(v,*ks):
    s=sum(1 for k in ks if v[k]==1); l=sum(1 for k in ks if v[k]==-1); return s,l
def near_any(v):
    a,b=v['Gần kháng cự/hỗ trợ H4 (1%)'],v['Gần kháng cự/hỗ trợ D1 (2%)']
    return 1 if (a==1 or b==1) and not (a==-1 or b==-1) else (-1 if (a==-1 or b==-1) and not (a==1 or b==1) else 0)
def score_user(v):
    vv=[v['D1 close<EMA50'],v['H4 close<EMA200'],near_any(v),v['Gần trendline H4 (1%)'],v['RSI H4 >70 / <30']]
    return sum(1 for x in vv if x==1),sum(1 for x in vv if x==-1)
TREND=['H4 close<EMA200','H4 Supertrend giảm','H4 close<EMA50','H1 EMA50<EMA200']
def score_data(v):
    s,l=comb(v,*TREND)
    f=v['Funding ≥0.02% / <0']; s+=f==1; l+=f==-1
    if v['F&G ≥75 / ≤25 (cực đoan)']==1: s+=1   # greed -> short; fear gave no long edge
    return s,l
def calib(name,fn,X,period):
    rs=[r for r in rows if r['out'][X] is not None and (period=='all' or (period=='train')==(r['t']<TEST_FROM))]
    B={}
    for r in rs:
        s,l=fn(r['v']); p=50.0 if s+l==0 else s/(s+l)*100
        b=min(4,int(p//20)) if p!=50 or s+l>0 else 2
        B.setdefault(b,[0,0,set()]); B[b][0]+=1; B[b][1]+=r['out'][X]==1; B[b][2].add(r['t']//86400000)
    lab=['0–19%','20–39%','40–59%','60–79%','80–100%']
    print(f"  {name} · ±{X}% · {period}: "+' | '.join(f"short%{lab[b]}: n={B[b][0]} ({len(B[b][2])}d) thực tế {B[b][1]/B[b][0]*100:.1f}%" for b in sorted(B)))
for X in (1,2,3):
    for per in ('train','test'):
        calib('A. Điểm của bạn (D1 EMA50, H4 EMA200, gần S/R, trendline, RSI)',score_user,X,per)
        calib('B. Theo dữ liệu (4 xu hướng + funding + F&G≥75)',score_data,X,per)
    print()
