import io,contextlib
with contextlib.redirect_stdout(io.StringIO()):
    import b1
    from a6 import bounce_ema
from b1 import *
ev=events(bounce_ema,cool=7)
rows=[]
for k,j,c in ev:
    i=c['i']
    if i<90 or not btc_bear.get(k[i][0]): continue
    hist=max(r[2] for r in k[:i]); rows.append((k,j,c,{'mc_sig':c['v']['cs']*k[i][4],'mc_now':c['v']['mc'],'dd':1-k[i][4]/hist}))
Bp=dict(steps=(0,.15,.3),tp=.1,stop=.5,maxd=20)
print('=== SETUP B (chỉ khi BTC bear)')
for name,fn in {'cap NOW ≤100M (cũ)':lambda f:f['mc_now']<=100e6,'cap lúc tín hiệu ≤100M':lambda f:f['mc_sig']<=100e6,
  'cap lúc tín hiệu 20–500M':lambda f:20e6<=f['mc_sig']<=500e6,'20–500M + giảm ≥50% ATH':lambda f:20e6<=f['mc_sig']<=500e6 and f['dd']>=.5,
  '<20M':lambda f:f['mc_sig']<20e6,'500M–2B':lambda f:500e6<=f['mc_sig']<2e9,'>2B':lambda f:f['mc_sig']>=2e9}.items():
    stats([r for r in rows if fn(r[3])],name,**Bp)
