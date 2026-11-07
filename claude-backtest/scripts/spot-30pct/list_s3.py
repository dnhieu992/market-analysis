import urllib.request, re, json, os
base = 'https://s3-ap-northeast-1.amazonaws.com/data.binance.vision?delimiter=/&prefix=data/spot/monthly/klines/'
syms = []; marker = ''
while True:
    x = urllib.request.urlopen(base + ('&marker=' + marker if marker else ''), timeout=60).read().decode()
    ps = re.findall(r'<Prefix>data/spot/monthly/klines/([^/<]+)/</Prefix>', x)
    syms += ps
    if '<IsTruncated>true' not in x or not ps: break
    marker = 'data/spot/monthly/klines/' + ps[-1] + '/'
usdt = sorted(s[:-4] for s in syms if s.endswith('USDT'))
live = set(f[:-5] for f in os.listdir('all'))
have = set(f[:-5] for f in os.listdir('data_dead')) | set(f[:-5] for f in os.listdir('data'))
STABLE = {'USDC','FDUSD','TUSD','USDP','DAI','EUR','AEUR','BUSD','USDE','PAX','USDS','USDSB','SUSD','UST','GBP','AUD','BKRW','IDRT','BVND','NGN','RUB','TRY','BRL','UAH','ZAR','PLN','RON','ARS','JPY','MXN','COP','CZK'}
dead = [s for s in usdt if s not in live and s not in have and s not in STABLE and not re.search(r'(UP|DOWN|BULL|BEAR)$', s)]
print('usdt symbols in archive', len(usdt), 'delisted candidates', len(dead))
json.dump(dead, open('dead_list.json', 'w'))
print(dead[:80])
