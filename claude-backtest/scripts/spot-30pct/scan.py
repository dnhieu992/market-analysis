"""Spot +30% study: community entry signals vs random entry, no stop, exit at +30%.

For every signal event (30-day cooldown per coin per signal) we buy at the day's close and record:
hit +30% within 90/180/365 days, days to hit, worst drawdown before exit, and the 365-day result
when it never hit ("stuck"). Split: 2018-2022 (in-sample feel) vs 2023-2026 (recent regime).
"""
import sys, datetime, statistics as st
from lib import *

COOLDOWN = 30
SPLIT = datetime.datetime(2023, 1, 1).timestamp() * 1000
MIN_HIST = 210  # need SMA200 etc.

btc = load('BTC')
btc_sma200 = sma(btc['c'], 200)
btc_ema50 = ema(btc['c'], 50)
btc_regime = {t: (btc['c'][i] > btc_sma200[i]) if btc_sma200[i] else None for i, t in enumerate(btc['t'])}
btc_up50 = {t: (btc['c'][i] > btc_ema50[i]) if btc_ema50[i] else None for i, t in enumerate(btc['t'])}
FNG = fng_map()


def features(x):
    c, h, l, t = x['c'], x['h'], x['l'], x['t']
    f = {}
    f['e20'] = ema(c, 20); f['e50'] = ema(c, 50); f['e200'] = ema(c, 200); f['s200'] = sma(c, 200)
    f['rsi'] = rsi(c, 14)
    f['wrsi'], f['wema21'], f['wclose'] = weekly_rsi_daily(t, c)
    f['hi90'] = rolling_max(h, 90); f['hi180'] = rolling_max(h, 180); f['hi365'] = rolling_max(h, 365)
    f['hi20'] = rolling_max(h, 20); f['hi50'] = rolling_max(h, 50); f['hi60'] = rolling_max(h, 60)
    f['lo60'] = rolling_min(l, 60)
    m20 = sma(c, 20); sd = stdev(c, 20)
    f['bbl'] = [m - 2 * s if m is not None else None for m, s in zip(m20, sd)]
    f['st'] = supertrend_bull(h, l, c, 10, 3)
    f['vol'] = x['v']; f['v20'] = sma(x['v'], 20)
    return f


def G(f, k, i):
    return f[k][i] if i >= 0 else None


def sig_defs():
    S = {}
    S['RANDOM (mọi ngày)'] = lambda x, f, i: True
    # ── dip buying ──
    S['dd90>=40%'] = lambda x, f, i: x['c'][i] <= 0.6 * f['hi90'][i]
    S['dd180>=50%'] = lambda x, f, i: x['c'][i] <= 0.5 * f['hi180'][i]
    S['dd365>=60%'] = lambda x, f, i: x['c'][i] <= 0.4 * f['hi365'][i]
    S['dd365>=75%'] = lambda x, f, i: x['c'][i] <= 0.25 * f['hi365'][i]
    S['RSI D<30'] = lambda x, f, i: f['rsi'][i] is not None and f['rsi'][i] < 30
    S['RSI D<25'] = lambda x, f, i: f['rsi'][i] is not None and f['rsi'][i] < 25
    S['RSI W<35'] = lambda x, f, i: f['wrsi'][i] is not None and f['wrsi'][i] < 35
    S['RSI W<30'] = lambda x, f, i: f['wrsi'][i] is not None and f['wrsi'][i] < 30
    S['close<0.7*SMA200'] = lambda x, f, i: f['s200'][i] and x['c'][i] < 0.7 * f['s200'][i]
    S['close<BB lower'] = lambda x, f, i: f['bbl'][i] and x['c'][i] < f['bbl'][i]
    S['F&G<20 (sợ hãi tột độ)'] = lambda x, f, i: FNG.get(x['t'][i], 50) < 20
    S['F&G<25'] = lambda x, f, i: FNG.get(x['t'][i], 50) < 25
    # ── bottom confirmation (dip + reclaim) ──
    S['dd180>=50% & reclaim EMA20'] = lambda x, f, i: x['c'][i] <= 0.5 * f['hi180'][i] and x['c'][i] > f['e20'][i] and x['c'][i - 1] <= f['e20'][i - 1]
    S['dd180>=50% & RSI lên lại 35'] = lambda x, f, i: x['c'][i] <= 0.55 * f['hi180'][i] and f['rsi'][i] and f['rsi'][i] > 35 and min((f['rsi'][j] or 99) for j in range(i - 7, i)) < 28
    S['dd180>=50% & Supertrend D lật tăng'] = lambda x, f, i: x['c'][i] <= 0.6 * f['hi180'][i] and f['st'][i] and f['st'][i - 1] is False
    # ── trend / momentum ──
    S['cắt lên EMA50'] = lambda x, f, i: f['e50'][i] and x['c'][i] > f['e50'][i] and x['c'][i - 1] <= f['e50'][i - 1]
    S['Supertrend D lật tăng'] = lambda x, f, i: f['st'][i] and f['st'][i - 1] is False
    S['Golden cross EMA50/200'] = lambda x, f, i: f['e200'][i] and f['e50'][i] > f['e200'][i] and f['e50'][i - 1] <= f['e200'][i - 1]
    S['Donchian 20 breakout'] = lambda x, f, i: x['c'][i] > f['hi20'][i - 1]
    S['Donchian 50 breakout'] = lambda x, f, i: x['c'][i] > f['hi50'][i - 1]
    S['Tuần đóng trên EMA21W'] = lambda x, f, i: f['wema21'][i] and f['wclose'][i] > f['wema21'][i] and f['wclose'][i - 1] is not None and (f['wclose'][i - 1] <= f['wema21'][i - 1]) and f['wclose'][i] != f['wclose'][i - 1]
    S['Phá nền 60d (biên<60%)'] = lambda x, f, i: f['hi60'][i - 1] / f['lo60'][i - 1] < 1.6 and x['c'][i] > f['hi60'][i - 1]
    S['Pullback EMA50 trong uptrend'] = lambda x, f, i: f['s200'][i] and x['c'][i] > f['s200'][i] and f['e50'][i] > f['s200'][i] and x['l'][i] <= f['e50'][i] <= x['c'][i]
    S['Phá nền 60d + vol x2'] = lambda x, f, i: f['hi60'][i - 1] / f['lo60'][i - 1] < 1.6 and x['c'][i] > f['hi60'][i - 1] and f['v20'][i - 1] and x['v'][i] > 2 * f['v20'][i - 1]
    return S


def with_btc(fn):
    return lambda x, f, i: btc_regime.get(x['t'][i]) is True and fn(x, f, i)


def with_btc_down(fn):
    return lambda x, f, i: btc_regime.get(x['t'][i]) is False and fn(x, f, i)


def bucket(ts):
    d = datetime.datetime.utcfromtimestamp(ts / 1000)
    return (d.year, d.month > 6, btc_regime.get(ts))


RAND = {}


def matched_base(ev):
    """Random-entry hit rate (≤180d) of the same half-year + BTC regime, averaged over the signal's events."""
    vals = [RAND.get(e[6]) for e in ev if RAND.get(e[6]) is not None]
    return sum(vals) / len(vals) if vals else None


def build_rand(res):
    from collections import defaultdict
    acc = defaultdict(lambda: [0, 0])
    for e in res['RANDOM (mọi ngày)']:
        if e[5] >= 365 or e[2] is not None:
            a = acc[e[6]]; a[1] += 1; a[0] += 1 if (e[2] is not None and e[2] <= 180) else 0
    RAND.clear(); RAND.update({k: v[0] / v[1] for k, v in acc.items() if v[1] >= 200})


def run(selected=None, horizon=365):
    S = sig_defs()
    for k in list(S):
        if k.startswith('RANDOM') or k.startswith('F&G'):
            pass
        S[k + ' | BTC>SMA200'] = with_btc(S[k])
        S[k + ' | BTC<SMA200'] = with_btc_down(S[k])
    if selected:
        S = {k: v for k, v in S.items() if any(s in k for s in selected)}
    res = {k: [] for k in S}
    for sym in coins():
        x = load(sym)
        if len(x['c']) < MIN_HIST + 30: continue
        f = features(x)
        last = {k: -10 ** 9 for k in S}
        for i in range(MIN_HIST, len(x['c']) - 1):
            for k, fn in S.items():
                cd = 1 if k.startswith('RANDOM') else COOLDOWN
                if i - last[k] < cd: continue
                try:
                    ok = fn(x, f, i)
                except (TypeError, ZeroDivisionError):
                    ok = False
                if not ok: continue
                last[k] = i
                d, mdd, r, avail = outcome(x, i, 1.30, horizon)
                res[k].append((sym, x['t'][i], d, mdd, r, avail, bucket(x['t'][i])))
    return res


def summarize(ev, period=None):
    if period == 'A': ev = [e for e in ev if e[1] < SPLIT]
    if period == 'B': ev = [e for e in ev if e[1] >= SPLIT]
    full = [e for e in ev if e[5] >= 365 or e[2] is not None]  # resolved within the data
    n = len(full)
    if n < 15: return None
    hit = lambda H: sum(1 for e in full if e[2] is not None and e[2] <= H) / n
    days = [e[2] for e in full if e[2] is not None]
    mdd = sorted(e[3] for e in full)
    stuck = [e[4] for e in full if e[2] is None]
    # expectancy per trade held up to 365d (hit: +30%, else mark-to-market at 365d), per year of capital
    rets = [(0.30 if e[2] is not None else e[4]) for e in full]
    hold = [(e[2] if e[2] is not None else 365) for e in full]
    ev_ = sum(rets) / n
    return {
        'n': n, 'coins': len(set(e[0] for e in full)),
        'h90': hit(90), 'h180': hit(180), 'h365': hit(365),
        'dmed': st.median(days) if days else None,
        'mdd_med': st.median(mdd), 'mdd_p10': mdd[int(0.1 * n)],
        'stuck': len(stuck) / n, 'stuck_med': st.median(stuck) if stuck else None,
        'ev': ev_, 'ev_per_yr': ev_ / (sum(hold) / n / 365),
        'edge': (hit(180) - matched_base(full)) if matched_base(full) is not None else None,
    }


def fmt(name, s):
    if not s: return f'{name:<52} (ít mẫu)'
    p = lambda v: f'{v*100:5.0f}%' if v is not None else '   — '
    return (f"{name:<52} n={s['n']:5d} c={s['coins']:2d} | +30% ≤90d {p(s['h90'])} ≤180d {p(s['h180'])} ≤365d {p(s['h365'])}"
            f" | ngày(med) {s['dmed'] or 0:4.0f} | DD med {p(s['mdd_med'])} p10 {p(s['mdd_p10'])}"
            f" | kẹt {p(s['stuck'])} (med {p(s['stuck_med'])}) | EV/năm {p(s['ev_per_yr'])} | EDGE {('%+5.0f' % (s['edge']*100)) if s['edge'] is not None else '  —'}")


if __name__ == '__main__':
    res = run(sys.argv[1:] or None)
    build_rand(res)
    for period, label in [(None, 'TOÀN BỘ 2018→2026'), ('A', '2018→2022'), ('B', '2023→2026')]:
        print(f'\n=== {label} ===')
        rows = [(k, summarize(v, period)) for k, v in res.items()]
        rows.sort(key=lambda r: -(r[1]['edge'] if r[1] and r[1]['edge'] is not None else -9))
        for k, s in rows: print(fmt(k, s))
