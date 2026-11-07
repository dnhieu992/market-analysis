import json, urllib.request, csv, sys
def get(u): return json.load(urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent':'backtest-script'}), timeout=60))
def kl(iv, start):
    out=[]; t=start
    while True:
        d=get(f"https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval={iv}&startTime={t}&limit=1500")
        if not d: break
        out+=d; t=d[-1][0]+1
        if len(d)<1500: break
    out=out[:-1]
    with open(f"data/{iv}.csv","w") as f:
        w=csv.writer(f); w.writerow(["t","o","h","l","c","v"])
        for k in out: w.writerow(k[:6])
    print(iv,len(out),flush=True)
def fng():
    d=get("https://api.alternative.me/fng/?limit=0&format=json")['data']
    with open("data/fng.csv","w") as f:
        w=csv.writer(f); w.writerow(["t","value"])
        for x in sorted(d,key=lambda x:int(x['timestamp'])): w.writerow([int(x['timestamp'])*1000,x['value']])
    print('fng',len(d))
def funding():
    out=[]; t=1567296000000
    while True:
        d=get(f"https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&startTime={t}&limit=1000")
        if not d: break
        out+=d; t=d[-1]['fundingTime']+1
        if len(d)<1000: break
    with open("data/funding.csv","w") as f:
        w=csv.writer(f); w.writerow(["t","rate"])
        for x in out: w.writerow([x['fundingTime'],x['fundingRate']])
    print('funding',len(out))
fng(); funding()
kl('1d',1567296000000); kl('4h',1598918400000); kl('1h',1598918400000); kl('15m',1598918400000)
