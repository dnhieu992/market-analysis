import json, urllib.request, csv, sys
START = 1688169600000  # 2023-07-01 (warm-up before 2024)
def fetch(iv):
    out=[]; t=START
    while True:
        u=f"https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval={iv}&startTime={t}&limit=1500"
        d=json.load(urllib.request.urlopen(u, timeout=30))
        if not d: break
        out+=d; t=d[-1][0]+1
        if len(d)<1500: break
    out=out[:-1]
    with open(f"data/{iv}.csv","w") as f:
        w=csv.writer(f); w.writerow(["t","o","h","l","c","v"])
        for k in out: w.writerow([k[0],k[1],k[2],k[3],k[4],k[5]])
    print(iv,len(out),flush=True)
for iv in sys.argv[1:]: fetch(iv)
