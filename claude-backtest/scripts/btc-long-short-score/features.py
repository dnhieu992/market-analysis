"""Per-H1-close votes (+1 short / -1 long / 0) and first-touch outcomes for BTC."""
import csv, math, os, pickle, bisect
from lib import load, ema, sma, rsi, stoch_rsi, supertrend, stdev, MS, NAN, utc
HERE=os.path.dirname(os.path.abspath(__file__))
D={iv:load(iv) for iv in ('15m','1h','4h','1d')}
H1,H4,D1,M15=D['1h'],D['4h'],D['1d'],D['15m']
T0=1609459200000  # 2021-01-01
DAY=86_400_000

def lastc(b,iv,t):  # last bar of b closed at or before t
    return bisect.bisect_right(b['t'], t-MS[iv])-1

# ---------- outcomes: first touch ±X% from the H1 close ----------
m15_idx={t:i for i,t in enumerate(M15['t'])}
def outcome(i,x,maxd=30):
    p=H1['c'][i]; up,dn=p*(1+x/100),p*(1-x/100); n=len(H1['t'])
    for k in range(i+1,min(n,i+1+maxd*24)):
        hu,hd=H1['h'][k]>=up,H1['l'][k]<=dn
        if hu and hd:
            j=m15_idx.get(H1['t'][k])
            if j is None: return None
            for q in range(j,j+4):
                a,b=M15['h'][q]>=up,M15['l'][q]<=dn
                if a and b: return None
                if a: return -1
                if b: return 1
            return None
        if hd: return 1
        if hu: return -1
    return None

# ---------- helpers ----------
def pivots(b,left,right):
    hs,ls=[],[]
    h,l=b['h'],b['l']
    for p in range(left,len(h)-right):
        if h[p]==max(h[p-left:p+right+1]): hs.append(p)
        if l[p]==min(l[p-left:p+right+1]): ls.append(p)
    return hs,ls

def confirmed(piv,right,j):  # pivots confirmed by bar j (p+right<=j)
    k=bisect.bisect_right(piv,j-right); return piv[:k]

ind={}
for name,b in (('d1',D1),('h4',H4),('h1',H1)):
    c=b['c']
    ind[name]={'e20':ema(c,20),'e50':ema(c,50),'e200':ema(c,200),'rsi':rsi(c,14)}
ind['d1']['sma140']=sma(D1['c'],140)
K4,_=stoch_rsi(H4['c']); ind['h4']['k']=K4
st4=supertrend(H4,10,3.0)
m4=sma(H4['c'],20); s4=stdev(H4['c'],20)
PH4,PL4=pivots(H4,5,5); PD1,LD1=pivots(D1,3,3)

fng_t,fng_v=[],[]
for r in list(csv.reader(open(os.path.join(HERE,'data/fng.csv'))))[1:]: fng_t.append(int(r[0])); fng_v.append(int(r[1]))
fu_t,fu_r=[],[]
for r in list(csv.reader(open(os.path.join(HERE,'data/funding.csv'))))[1:]: fu_t.append(int(r[0])); fu_r.append(float(r[1]))

def sgn_lt(a,b): return 0 if (isinstance(a,float) and math.isnan(a)) or (isinstance(b,float) and math.isnan(b)) else (1 if a<b else -1)

def structure(hs,ls,b,j,right):
    ch,cl=confirmed(hs,right,j),confirmed(ls,right,j)
    if len(ch)<2 or len(cl)<2: return 0
    lh=b['h'][ch[-1]]<b['h'][ch[-2]]; ll=b['l'][cl[-1]]<b['l'][cl[-2]]
    if lh and ll: return 1
    if not lh and not ll: return -1
    return 0

def near_level(hs,ls,b,j,right,price,pct,lookback):
    res=[b['h'][p] for p in confirmed(hs,right,j) if p>=j-lookback and b['h'][p]>=price]
    sup=[b['l'][p] for p in confirmed(ls,right,j) if p>=j-lookback and b['l'][p]<=price]
    s=bool(res) and min(res)/price-1<=pct/100
    l=bool(sup) and 1-max(sup)/price<=pct/100
    return 1 if s and not l else (-1 if l and not s else 0)

def trendline(hs,ls,b,j,right,price,pct):
    v=0
    ch=[p for p in confirmed(hs,right,j) if p>=j-150]
    if len(ch)>=2:
        a,c=ch[-2],ch[-1]
        if b['h'][c]<b['h'][a]:
            line=b['h'][a]+(b['h'][c]-b['h'][a])/(c-a)*(j-a)
            if 0<=line/price-1<=pct/100: v+=1
    cl=[p for p in confirmed(ls,right,j) if p>=j-150]
    if len(cl)>=2:
        a,c=cl[-2],cl[-1]
        if b['l'][c]>b['l'][a]:
            line=b['l'][a]+(b['l'][c]-b['l'][a])/(c-a)*(j-a)
            if 0<=1-line/price<=pct/100: v-=1
    return v

def band(x,hi,lo):  # x>=hi -> short, x<=lo -> long
    if x is None or (isinstance(x,float) and math.isnan(x)): return 0
    return 1 if x>=hi else (-1 if x<=lo else 0)

FEATS={}
def feat(name):
    def deco(f): FEATS[name]=f; return f
    return deco

def votes(i):
    t=H1['t'][i]+MS['1h']; price=H1['c'][i]
    d=lastc(D1,'1d',t); h4=lastc(H4,'4h',t)
    I,J=ind['d1'],ind['h4']; c1,c4=D1['c'][d],H4['c'][h4]
    v={}
    v['D1 close<EMA50']=sgn_lt(c1,I['e50'][d])
    v['D1 close<EMA200']=sgn_lt(c1,I['e200'][d])
    v['D1 EMA20<EMA50']=sgn_lt(I['e20'][d],I['e50'][d])
    v['W close<SMA20W']=sgn_lt(c1,I['sma140'][d])
    v['D1 cấu trúc LH+LL']=structure(PD1,LD1,D1,d,3)
    v['H4 close<EMA200']=sgn_lt(c4,J['e200'][h4])
    v['H4 close<EMA50']=sgn_lt(c4,J['e50'][h4])
    v['H4 EMA20<EMA50']=sgn_lt(J['e20'][h4],J['e50'][h4])
    v['H4 cấu trúc LH+LL']=structure(PH4,PL4,H4,h4,5)
    v['H4 Supertrend giảm']=0 if st4[h4] is None else (-1 if st4[h4] else 1)
    v['H1 EMA50<EMA200']=sgn_lt(ind['h1']['e50'][i],ind['h1']['e200'][i])
    v['Gần kháng cự/hỗ trợ H4 (1%)']=near_level(PH4,PL4,H4,h4,5,price,1.0,180)
    v['Gần kháng cự/hỗ trợ D1 (2%)']=near_level(PD1,LD1,D1,d,3,price,2.0,120)
    v['Gần trendline H4 (1%)']=trendline(PH4,PL4,H4,h4,5,price,1.0)
    v['RSI H1 >70 / <30']=band(ind['h1']['rsi'][i],70,30)
    v['RSI H4 >70 / <30']=band(J['rsi'][h4],70,30)
    v['RSI D1 >70 / <30']=band(I['rsi'][d],70,30)
    v['StochRSI H4 >80 / <20']=band(J['k'][h4],80,20)
    up=m4[h4]+2*s4[h4] if not math.isnan(m4[h4]) else NAN; lo=m4[h4]-2*s4[h4] if not math.isnan(m4[h4]) else NAN
    v['H4 ngoài BB(20,2)']=0 if math.isnan(up) else (1 if c4>up else (-1 if c4<lo else 0))
    v['Cách EMA50 D1 >+10% / <−10%']=band(c1/I['e50'][d]-1 if not math.isnan(I['e50'][d]) else NAN,0.10,-0.10)
    v['Pump/dump ±3% trong 6h']=band(price/H1['c'][i-6]-1,0.03,-0.03)
    v['Biến động 7 ngày ±10%']=band(price/H1['c'][i-168]-1,0.10,-0.10)
    k=bisect.bisect_right(fng_t,t-DAY)-1   # yesterday's index value (no look-ahead)
    f=fng_v[k] if k>=0 else None; f7=fng_v[k-7] if k>=7 else None
    v['F&G ≥75 / ≤25 (cực đoan)']=band(f,75,25)
    v['F&G ≥60 / ≤40']=band(f,60,40)
    v['F&G tăng/giảm ≥15 điểm/7 ngày']=band(None if f is None or f7 is None else f-f7,15,-15)
    q=bisect.bisect_right(fu_t,t)-1
    fr=fu_r[q] if q>=0 else None
    v['Funding ≥0.02% / <0']=0 if fr is None else (1 if fr>=0.0002 else (-1 if fr<0 else 0))
    avg3=sum(fu_r[q-8:q+1])/9 if q>=8 else None
    v['Funding TB 3 ngày ≥0.015% / ≤0']=0 if avg3 is None else (1 if avg3>=0.00015 else (-1 if avg3<=0 else 0))
    v['Cuối tuần (T7/CN)']=1 if utc(t).weekday()>=5 else 0
    return v

if __name__=='__main__':
    rows=[]
    start=bisect.bisect_left(H1['t'],T0)
    end=len(H1['t'])-30*24
    for i in range(start,len(H1['t'])):
        o={x:(outcome(i,x) if i<end else None) for x in (1,2,3)}
        rows.append({'t':H1['t'][i]+MS['1h'],'i':i,'price':H1['c'][i],'out':o,'v':votes(i)})
    pickle.dump(rows,open(os.path.join(HERE,'rows.pkl'),'wb'))
    print(len(rows),'rows; features',len(rows[0]['v']))
