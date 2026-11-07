import scan
from lib import *
base = scan.sig_defs
def defs():
    S = {'RANDOM (mọi ngày)': lambda x, f, i: True}
    W = lambda th: (lambda x, f, i: f['wrsi'][i] is not None and f['wrsi'][i] < th)
    Dr = lambda th: (lambda x, f, i: f['rsi'][i] is not None and f['rsi'][i] < th)
    for th in (25, 30, 35, 40): S[f'W<{th}'] = W(th)
    for th in (20, 25, 30): S[f'D<{th}'] = Dr(th)
    S['W<40 & D<30'] = lambda x, f, i: W(40)(x, f, i) and Dr(30)(x, f, i)
    S['W<35 & D<30'] = lambda x, f, i: W(35)(x, f, i) and Dr(30)(x, f, i)
    S['W<45 & D<25'] = lambda x, f, i: W(45)(x, f, i) and Dr(25)(x, f, i)
    S['W<35 | D<25'] = lambda x, f, i: W(35)(x, f, i) or Dr(25)(x, f, i)
    # filters on W<35 | D<25
    core = S['W<35 | D<25']
    age = lambda x, f, i: i >= 365
    alive = lambda x, f, i: x['c'][i] >= 0.08 * f['hi365'][i]   # not already -92% in a year
    liq = lambda x, f, i: f['v20'][i] and f['v20'][i] > 5e6      # >$5M/day quote volume
    S['core & coin ≥1 năm'] = lambda x, f, i: core(x, f, i) and age(x, f, i)
    S['core & chưa -92%/năm'] = lambda x, f, i: core(x, f, i) and alive(x, f, i)
    S['core & vol>5M$/ngày'] = lambda x, f, i: core(x, f, i) and liq(x, f, i)
    S['core & cả 3 lọc'] = lambda x, f, i: core(x, f, i) and age(x, f, i) and alive(x, f, i) and liq(x, f, i)
    S['W<35 & cả 3 lọc'] = lambda x, f, i: W(35)(x, f, i) and age(x, f, i) and alive(x, f, i) and liq(x, f, i)
    S['D<25 & cả 3 lọc'] = lambda x, f, i: Dr(25)(x, f, i) and age(x, f, i) and alive(x, f, i) and liq(x, f, i)
    S['RANDOM & cả 3 lọc'] = lambda x, f, i: age(x, f, i) and alive(x, f, i) and liq(x, f, i)
    return S
scan.sig_defs = defs
_run = scan.run
def run_noregime(selected=None, horizon=365):
    # same as scan.run but without the BTC regime variants
    S = defs(); res = {k: [] for k in S}
    for sym in coins():
        x = load(sym)
        if len(x['c']) < scan.MIN_HIST + 30: continue
        f = scan.features(x); last = {k: -10**9 for k in S}
        for i in range(scan.MIN_HIST, len(x['c']) - 1):
            for k, fn in S.items():
                cd = 1 if k.startswith('RANDOM (') else scan.COOLDOWN
                if i - last[k] < cd: continue
                try: ok = fn(x, f, i)
                except (TypeError, ZeroDivisionError): ok = False
                if not ok: continue
                last[k] = i
                d, mdd, r, avail = outcome(x, i, 1.30, horizon)
                res[k].append((sym, x['t'][i], d, mdd, r, avail, scan.bucket(x['t'][i])))
    return res
res = run_noregime(); scan.build_rand(res)
for per, lab in [(None, 'ALL'), ('A', '2018-22'), ('B', '2023-26')]:
    print('==', lab)
    for k, v in res.items(): print(scan.fmt(k, scan.summarize(v, per)).replace('                    ', ' ', 1))
