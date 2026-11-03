import json,urllib.request,concurrent.futures as cf,os,time
u=json.load(open('universe.json'))
syms=[v['fsym'] for b,v in u.items() if 0<v['mc']<300e6]+['BTCUSDT']
def get(sym,interval='1d'):
    out=f'kl/{sym}_{interval}.json'
    if os.path.exists(out): return
    rows=[];start=0
    while True:
        url=f'https://fapi.binance.com/fapi/v1/klines?symbol={sym}&interval={interval}&limit=1500&startTime={start}'
        for t in range(4):
            try: d=json.load(urllib.request.urlopen(url,timeout=20));break
            except Exception as e: time.sleep(2)
        else: return
        rows+=d
        if len(d)<1500: break
        start=d[-1][0]+1
    json.dump([[r[0],float(r[1]),float(r[2]),float(r[3]),float(r[4]),float(r[7])] for r in rows],open(out,'w'))
with cf.ThreadPoolExecutor(8) as ex: list(ex.map(get,syms))
print(len(syms),len(os.listdir('kl')))
