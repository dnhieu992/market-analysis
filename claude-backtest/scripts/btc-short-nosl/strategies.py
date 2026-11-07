"""Community short setups for BTC. Each returns a list of ENTRY times (ms) = open of the bar after the signal bar closed."""
import math
from lib import (MS, NAN, load, ema, sma, rsi, stdev, stoch_rsi, macd, supertrend, qqe, last_closed_idx, utc)

D = {iv: load(iv) for iv in ('15m', '1h', '4h', '1d')}
D['15m']['_idx'] = {t: i for i, t in enumerate(D['15m']['t'])}


def nxt(b, i):
    return b['t'][i] + MS[b['iv']]


def isn(*xs):
    return any(math.isnan(x) for x in xs)


# ---- regime filters (evaluated on bars CLOSED at signal time) ----
_d1 = D['1d']; _d1_e50 = ema(_d1['c'], 50)
_h4 = D['4h']; _h4_e200 = ema(_h4['c'], 200)


def bear_d1(t_ms):  # last closed daily close < daily EMA50
    j = last_closed_idx(_d1['t'], MS['1d'], t_ms)
    return j >= 0 and not math.isnan(_d1_e50[j]) and _d1['c'][j] < _d1_e50[j]


def bear_h4(t_ms):  # last closed H4 close < H4 EMA200
    j = last_closed_idx(_h4['t'], MS['4h'], t_ms)
    return j >= 0 and not math.isnan(_h4_e200[j]) and _h4['c'][j] < _h4_e200[j]


# ---------------- strategies ----------------
def rsi_cross(iv, lvl=70, n=14):
    b = D[iv]; r = rsi(b['c'], n)
    return [nxt(b, i) for i in range(1, len(r)) if not isn(r[i], r[i - 1]) and r[i - 1] >= lvl > r[i]]


def bb_reentry(iv, n=20, k=2.0):
    b = D[iv]; c = b['c']; m = sma(c, n); s = stdev(c, n)
    up = [NAN if isn(a, d) else a + k * d for a, d in zip(m, s)]
    return [nxt(b, i) for i in range(1, len(c)) if not isn(up[i], up[i - 1]) and c[i - 1] > up[i - 1] and c[i] < up[i]]


def stochrsi_cross(iv, hi=80):
    b = D[iv]; K, Dd = stoch_rsi(b['c'])
    return [nxt(b, i) for i in range(1, len(K)) if not isn(K[i], Dd[i], K[i - 1], Dd[i - 1])
            and K[i - 1] >= Dd[i - 1] and K[i] < Dd[i] and K[i - 1] > hi]


def macd_bear(iv):
    b = D[iv]; m, s = macd(b['c'])
    return [nxt(b, i) for i in range(1, len(m)) if not isn(m[i], s[i], m[i - 1], s[i - 1])
            and m[i - 1] >= s[i - 1] and m[i] < s[i] and m[i] > 0]


def ema_reject(iv='1h'):
    b = D[iv]; c, h = b['c'], b['h']; e50, e200 = ema(c, 50), ema(c, 200)
    return [nxt(b, i) for i in range(1, len(c)) if not isn(e50[i], e200[i])
            and e50[i] < e200[i] and h[i] >= e50[i] and c[i] < e50[i] and c[i - 1] < e50[i - 1]]


def pdh_sweep(iv='1h'):
    b = D[iv]; d = D['1d']; out = []; done = set()
    for i in range(len(b['c'])):
        day = b['t'][i] // MS['1d']
        if day in done: continue
        j = last_closed_idx(d['t'], MS['1d'], b['t'][i])
        if j < 0: continue
        pdh = d['h'][j]
        if b['h'][i] > pdh and b['c'][i] < pdh:
            out.append(nxt(b, i)); done.add(day)
    return out


def asia_sweep(iv='1h', asia_end=8, last_hour=20):
    b = D[iv]; out = []; ah = {}; done = set()
    for i in range(len(b['c'])):
        dt = utc(b['t'][i]); day = b['t'][i] // MS['1d']
        if dt.hour < asia_end:
            ah[day] = max(ah.get(day, 0), b['h'][i]); continue
        if dt.hour > last_hour or day in done or day not in ah: continue
        if b['h'][i] > ah[day] and b['c'][i] < ah[day]:
            out.append(nxt(b, i)); done.add(day)
    return out


def rsi_bear_div(iv='1h', left=5, right=3, lookback=60, min_rsi=60):
    b = D[iv]; h = b['h']; r = rsi(b['c'], 14); out = []; piv = []
    for p in range(left, len(h) - right):
        if all(h[p] > h[p - k] for k in range(1, left + 1)) and all(h[p] >= h[p + k] for k in range(1, right + 1)):
            piv.append(p)
    for a, p in zip(piv, piv[1:]):
        if p - a > lookback or isn(r[a], r[p]): continue
        if h[p] > h[a] and r[p] < r[a] and r[a] >= min_rsi:
            out.append(nxt(b, p + right))  # known only after the right side closes
    return out


def pump_fade(iv='1h', bars=6, pct=3.0):
    b = D[iv]; c = b['c']
    return [nxt(b, i) for i in range(bars, len(c)) if c[i] / c[i - bars] - 1 >= pct / 100]


def st_flip(iv='1h'):
    b = D[iv]; bull = supertrend(b, 10, 3.0)
    return [nxt(b, i) for i in range(1, len(bull)) if bull[i - 1] is True and bull[i] is False]


def qqe_short(iv):
    b = D[iv]; _, _, cr = qqe(b['c'])
    return [nxt(b, i) for i, x in enumerate(cr) if x == 'short']


def daily_at(hour):
    b = D['1h']
    return [nxt(b, i) for i in range(len(b['t'])) if utc(b['t'][i]).hour == (hour - 1) % 24]


STRATS = {
    'RSI14 H1 cắt xuống 70': lambda: rsi_cross('1h'),
    'RSI14 H4 cắt xuống 70': lambda: rsi_cross('4h'),
    'RSI14 15m cắt xuống 70': lambda: rsi_cross('15m'),
    'BB(20,2) H1 đóng lại trong band': lambda: bb_reentry('1h'),
    'BB(20,2) H4 đóng lại trong band': lambda: bb_reentry('4h'),
    'StochRSI H1 cắt xuống >80': lambda: stochrsi_cross('1h'),
    'StochRSI H4 cắt xuống >80': lambda: stochrsi_cross('4h'),
    'MACD H4 cắt xuống trên 0': lambda: macd_bear('4h'),
    'EMA50 H1 từ chối (EMA50<200)': lambda: ema_reject('1h'),
    'Quét đỉnh hôm qua (PDH) H1': lambda: pdh_sweep('1h'),
    'Quét đỉnh phiên Á H1': lambda: asia_sweep('1h'),
    'Phân kỳ âm RSI H1': lambda: rsi_bear_div('1h'),
    'Pump +3%/6h rồi short': lambda: pump_fade('1h'),
    'Supertrend(10,3) H1 lật giảm': lambda: st_flip('1h'),
    'QQE H1 cắt short': lambda: qqe_short('1h'),
    'QQE H4 cắt short': lambda: qqe_short('4h'),
    '[đối chứng] short mỗi ngày 00:00 UTC': lambda: daily_at(0),
    '[đối chứng] short mỗi ngày 13:00 UTC': lambda: daily_at(13),
}

FILTERS = {
    'none': None,
    'D1<EMA50': bear_d1,
    'H4<EMA200': bear_h4,
}
