import json, urllib.request, time, os, sys
COINS = """BTC ETH BNB XRP SOL DOGE ADA TRX LINK AVAX DOT LTC BCH XLM HBAR SUI NEAR UNI ATOM ETC FIL ICP APT ARB OP INJ SEI TIA PEPE SHIB AAVE ENA POL TAO WLD ONDO FET RENDER GRT SAND MANA AXS GALA CHZ ALGO VET EGLD THETA CRV LDO RUNE KAVA ZIL IOTA NEO EOS XTZ 1INCH SNX COMP DYDX IMX STX FLOW KSM ZEC DASH ASTER WLFI""".split()
def get(sym, start):
    url=f"https://api.binance.com/api/v3/klines?symbol={sym}USDT&interval=1d&startTime={start}&limit=1000"
    with urllib.request.urlopen(url, timeout=30) as r: return json.load(r)
for c in COINS:
    out=[]; start=1514764800000  # 2018-01-01
    try:
        while True:
            rows=get(c,start)
            if not rows: break
            out+= [[r[0],float(r[1]),float(r[2]),float(r[3]),float(r[4]),float(r[7])] for r in rows]
            if len(rows)<1000: break
            start=rows[-1][0]+86400000
    except Exception as e:
        print(c,'ERR',e); continue
    out=out[:-1]  # drop forming candle
    json.dump(out, open(f"data/{c}.json","w"))
    print(c, len(out), time.strftime('%Y-%m-%d', time.gmtime(out[0][0]/1000)) if out else '-')
