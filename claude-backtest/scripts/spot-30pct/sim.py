"""Portfolio simulation of the spot +30% plan (daily bars, no stop-loss).

Capital split in SLOTS; a signal opens a position on a coin (one per coin) sized equity/SLOTS,
bought in a ladder (fractions at entry, -L1%, -L2% from the first fill). Take profit when the high
reaches avg_cost * (1 + TP). Optional time exit. Delisted coins: forced sale at the last close.
Fees 0.1% per side. Equity marked to market daily → CAGR and max drawdown.
"""
import sys, random, datetime, math
from lib import *
import scan

FEE = 0.001


def prepare(universe):
    data = {}
    for sym in universe:
        x = load(sym)
        if len(x['c']) < 260: continue
        f = scan.features(x)
        data[sym] = (x, f, {t: i for i, t in enumerate(x['t'])})
    return data


def run(data, signal, slots=10, ladder=((0.3, 0), (0.3, -0.15), (0.4, -0.30)), tp=0.30, time_exit=None,
        start=datetime.datetime(2019, 1, 1), end=None, rank=None, seed=0, cooldown=0):
    rnd = random.Random(seed)
    days = sorted({t for (x, f, ix) in data.values() for t in x['t'] if t >= start.timestamp() * 1000 and (end is None or t < end.timestamp() * 1000)})
    cash = 1.0; pos = {}; eq_curve = []; trades = []; last_exit = {}
    for t in days:
        # 1) manage open positions
        for sym in list(pos):
            x, f, ix = data[sym]; i = ix.get(t)
            p = pos[sym]
            if i is None:
                if x['t'][-1] < t:  # delisted → sell at last close
                    proceeds = p['qty'] * x['c'][-1] * (1 - FEE)
                    cash += proceeds + p['reserve']
                    trades.append((sym, p['t0'], t, proceeds / p['cost'] - 1, 'delist', p['fills']))
                    del pos[sym]; last_exit[sym] = t
                continue
            # pending ladder fills
            for k, (frac, lv) in enumerate(ladder):
                if k < p['fills'] or k == 0: continue
                if k == p['fills']:
                    px = p['p0'] * (1 + lv)
                    if x['l'][i] <= px:
                        amt = p['size'] * frac
                        p['qty'] += amt * (1 - FEE) / px; p['cost'] += amt; p['reserve'] -= amt; p['fills'] += 1
            avg = p['cost'] / p['qty']
            target = avg * (1 + tp)
            if x['h'][i] >= target:
                proceeds = p['qty'] * target * (1 - FEE)
                cash += proceeds + p['reserve']
                trades.append((sym, p['t0'], t, proceeds / p['cost'] - 1, 'tp', p['fills']))
                del pos[sym]; last_exit[sym] = t
            elif time_exit and (t - p['t0']) / DAY >= time_exit:
                proceeds = p['qty'] * x['c'][i] * (1 - FEE)
                cash += proceeds + p['reserve']
                trades.append((sym, p['t0'], t, proceeds / p['cost'] - 1, 'time', p['fills']))
                del pos[sym]; last_exit[sym] = t
        # 2) equity
        mtm = cash
        for sym, p in pos.items():
            x, f, ix = data[sym]; i = ix.get(t)
            px = x['c'][i] if i is not None else x['c'][-1]
            mtm += p['qty'] * px + p['reserve']
        eq_curve.append((t, mtm, cash))
        # 3) new entries
        free = slots - len(pos)
        if free <= 0: continue
        cands = []
        for sym, (x, f, ix) in data.items():
            if sym in pos: continue
            if cooldown and sym in last_exit and (t - last_exit[sym]) / DAY < cooldown: continue
            i = ix.get(t)
            if i is None or i < 210 or i >= len(x['c']) - 1: continue
            try:
                ok = signal(x, f, i, rnd)
            except (TypeError, ZeroDivisionError):
                ok = False
            if ok: cands.append((rank(x, f, i) if rank else rnd.random(), sym, i))
        cands.sort()
        for _, sym, i in cands[:free]:
            x, f, ix = data[sym]
            size = mtm / slots
            if cash < size * 0.999: break
            cash -= size
            first = size * ladder[0][0]
            pos[sym] = {'t0': t, 'p0': x['c'][i], 'size': size, 'qty': first * (1 - FEE) / x['c'][i], 'cost': first, 'reserve': size - first, 'fills': 1}
    return eq_curve, trades, pos


def cagr_of(eq):
    yrs = (eq[-1][0] - eq[0][0]) / DAY / 365
    peak = 0; mdd = 0
    for e in eq:
        peak = max(peak, e[1]); mdd = min(mdd, e[1] / peak - 1)
    return eq[-1][1] ** (1 / yrs) - 1, mdd


def stats(eq, trades, pos, label):
    t0, t1 = eq[0][0], eq[-1][0]
    yrs = (t1 - t0) / DAY / 365
    cagr = eq[-1][1] ** (1 / yrs) - 1
    peak = 0; mdd = 0
    for e in eq:
        v = e[1]; peak = max(peak, v); mdd = min(mdd, v / peak - 1)
    expo = sum(1 - e[2] / e[1] for e in eq if len(e) > 2) / len(eq) if len(eq[0]) > 2 else 1.0
    n = len(trades)
    tp = sum(1 for tr in trades if tr[4] == 'tp')
    hold = sorted((tr[2] - tr[1]) / DAY for tr in trades)
    losers = [tr for tr in trades if tr[3] < 0]
    worst = min((tr[3] for tr in trades), default=0)
    full = sum(1 for tr in trades if tr[5] == 3)
    print(f"{label:<46} CAGR {cagr*100:6.1f}% | maxDD {mdd*100:5.0f}% | vốn dùng {expo*100:3.0f}% | lệnh {n:4d} ({n/yrs:4.0f}/năm) TP {tp/n*100 if n else 0:3.0f}% "
          f"| giữ med {hold[len(hold)//2] if hold else 0:3.0f}d p90 {hold[int(len(hold)*.9)] if hold else 0:4.0f}d | lỗ {len(losers):3d} tệ nhất {worst*100:4.0f}% | DCA đủ 3 {full/n*100 if n else 0:3.0f}% | còn mở {len(pos)}")


def btc_hold(start, end=None):
    x = load('BTC'); ix = [i for i, t in enumerate(x['t']) if t >= start.timestamp() * 1000 and (end is None or t < end.timestamp() * 1000)]
    eq = [(x['t'][i], x['c'][i] / x['c'][ix[0]]) for i in ix]
    return eq


if __name__ == '__main__':
    pass
