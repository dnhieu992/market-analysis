import pickle, math, collections, sys
from lib import utc
rows=pickle.load(open('rows.pkl','rb'))
X=float(sys.argv[1]) if len(sys.argv)>1 else 2
X=int(X)
YRS=[2021,2022,2023,2024,2025,2026]
ok=[r for r in rows if r['out'][X] is not None]
base=sum(1 for r in ok if r['out'][X]==1)/len(ok)*100
by_y={y:[r for r in ok if utc(r['t']).year==y] for y in YRS}
base_y={y:(sum(1 for r in v if r['out'][X]==1)/len(v)*100 if v else 0) for y,v in by_y.items()}
print(f"±{X}% first-touch · samples {len(ok)} (H1 closes 2021→2026-10) · base SHORT-win {base:.1f}%  by year "+' '.join(f"{y}:{base_y[y]:.0f}%" for y in YRS))
print(f"{'tiêu chí':34} | {'vote SHORT: n, short thắng, edge':34} | {'vote LONG: n, long thắng, edge':32} | edge short theo năm 21..26 (điểm %)")
feats=list(rows[0]['v'].keys())
res=[]
for f in feats:
    s=[r for r in ok if r['v'][f]==1]; l=[r for r in ok if r['v'][f]==-1]
    sw=sum(1 for r in s if r['out'][X]==1)/len(s)*100 if s else float('nan')
    lw=sum(1 for r in l if r['out'][X]==-1)/len(l)*100 if l else float('nan')
    ys=[]
    for y in YRS:
        a=[r for r in by_y[y] if r['v'][f]==1]; b=[r for r in by_y[y] if r['v'][f]==-1]
        # year edge = short-win when voting short minus short-win when voting long (separation)
        if len(a)>=50 and len(b)>=50:
            ys.append(f"{(sum(1 for r in a if r['out'][X]==1)/len(a)-sum(1 for r in b if r['out'][X]==1)/len(b))*100:+4.0f}")
        elif len(a)>=50: ys.append(f"{sum(1 for r in a if r['out'][X]==1)/len(a)*100-base_y[y]:+4.0f}s")
        elif len(b)>=50: ys.append(f"{base_y[y]-sum(1 for r in b if r['out'][X]==1)/len(b)*100:+4.0f}l")
        else: ys.append('   ·')
    days_s=len({r['t']//86400000 for r in s}); days_l=len({r['t']//86400000 for r in l})
    res.append((f,len(s),days_s,sw,sw-base,len(l),days_l,lw,lw-(100-base),ys))
for f,ns,ds,sw,es,nl,dl,lw,el,ys in sorted(res,key=lambda x:-((x[4] if not math.isnan(x[4]) else 0)+(x[8] if not math.isnan(x[8]) else 0))):
    print(f"{f[:34]:34} | {ns:6} ({ds:4}d) {sw:5.1f}% {es:+5.1f} | {nl:6} ({dl:4}d) {lw:5.1f}% {el:+5.1f} | {' '.join(ys)}")
