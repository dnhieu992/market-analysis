import urllib.request, zipfile, io, json, os, concurrent.futures as cf
DEAD = "LUNA FTT WAVES SRM ANC MIR XEM OMG REN HNT MDX BTS KEY UNFI CVC BTT MATIC FTM RNDR OCEAN XMR NANO WTC MFT COCOS DOCK POLY AKRO KLAY MOB GTO NPXS STORM MITH BEAM LTO DREP PNT TCT PERL BCHSV BCHABC VEN TUSD".split()
DEAD = [d for d in DEAD if d not in ('TUSD',)]
months = [f"{y}-{m:02d}" for y in range(2018, 2027) for m in range(1, 13) if (y, m) <= (2026, 10)]
def one(sym, ym):
    url = f"https://data.binance.vision/data/spot/monthly/klines/{sym}USDT/1d/{sym}USDT-1d-{ym}.zip"
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            z = zipfile.ZipFile(io.BytesIO(r.read()))
            rows = []
            for line in z.read(z.namelist()[0]).decode().splitlines():
                p = line.split(',')
                if not p[0].isdigit(): continue
                t = int(p[0]); t = t // 1000 if t > 10**14 else t
                rows.append([t, float(p[1]), float(p[2]), float(p[3]), float(p[4]), float(p[7])])
            return rows
    except Exception:
        return []
for sym in DEAD:
    with cf.ThreadPoolExecutor(16) as ex:
        parts = list(ex.map(lambda ym: one(sym, ym), months))
    rows = sorted({r[0]: r for p in parts for r in p}.values())
    if len(rows) < 250: print(sym, 'skip', len(rows)); continue
    os.makedirs('data_dead', exist_ok=True)
    json.dump(rows, open(f'data_dead/{sym}.json', 'w'))
    import time
    print(sym, len(rows), time.strftime('%Y-%m', time.gmtime(rows[0][0]/1000)), '→', time.strftime('%Y-%m', time.gmtime(rows[-1][0]/1000)), 'last/peak=%.3f' % (rows[-1][4] / max(r[2] for r in rows)))
