import json, urllib.request, time, sys, csv
START = 1704067200000  # 2024-01-01 UTC
def fetch(interval):
    out=[]; t=START
    while True:
        url=f"https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval={interval}&startTime={t}&limit=1000"
        d=json.load(urllib.request.urlopen(url, timeout=30))
        if not d: break
        out+=d; t=d[-1][0]+1
        if len(d)<1000: break
    out=out[:-1]  # drop in-progress candle
    with open(f"data/{interval}.csv","w") as f:
        w=csv.writer(f); w.writerow(["t","o","h","l","c","v"])
        for k in out: w.writerow([k[0],k[1],k[2],k[3],k[4],k[5]])
    print(interval,len(out),flush=True)
for iv in sys.argv[1:]: fetch(iv)
