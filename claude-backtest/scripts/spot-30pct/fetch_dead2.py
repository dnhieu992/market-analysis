import urllib.request, zipfile, io, json, os, csv
from concurrent.futures import ThreadPoolExecutor
dead = json.load(open('dead_list.json'))
months = [f'{y}-{m:02d}' for y in range(2021, 2027) for m in range(1, 13) if (y, m) <= (2026, 10)]
def get(sym, ym):
    u = f'https://data.binance.vision/data/spot/monthly/klines/{sym}USDT/1d/{sym}USDT-1d-{ym}.zip'
    try:
        b = urllib.request.urlopen(u, timeout=30).read()
    except Exception:
        return []
    z = zipfile.ZipFile(io.BytesIO(b)); rows = []
    for r in csv.reader(io.TextIOWrapper(z.open(z.namelist()[0]))):
        t = int(r[0]); t = t // 1000 if t > 1e14 else t
        rows.append([t, float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[7])])
    return rows
def one(sym):
    rows = []
    with ThreadPoolExecutor(8) as ex:
        for r in ex.map(lambda ym: get(sym, ym), months): rows += r
    rows.sort()
    if rows: json.dump(rows, open(f'dead2/{sym}.json', 'w'))
    return sym, len(rows)
with ThreadPoolExecutor(6) as ex:
    res = list(ex.map(one, dead))
print(sum(1 for s, n in res if n), 'coins with data;', sum(1 for s, n in res if n >= 400), '>=400 days')
