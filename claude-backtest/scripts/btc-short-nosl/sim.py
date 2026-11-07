"""No-stop-loss BTC short simulator on 15m bars.

Money management (identical for every strategy so they compare fairly):
- capital $1000, base order $100 notional, one position at a time (signals while in a trade are skipped)
- DCA ladder: adds when price rises X% above the FIRST entry (limit fills at the level, or at the open on a gap)
- TP: buy-limit at avg*(1 - tp%) — the only exit (optional time exit, reported separately)
- fee 0.05% per fill and on exit; no slippage, no funding
- same-bar ambiguity: a bar that fills a DCA level does not also take the TP (conservative)
"""
import math
from lib import MS, START_2024

FEE = 0.0005
CAP = 1000.0
BASE = 100.0


def simulate(m15, entries, tp_pct, ladder, max_hold_days=None, end_ms=None):
    t, o, h, l, c = m15['t'], m15['o'], m15['h'], m15['l'], m15['c']
    idx_of = m15['_idx']
    sig_idx = sorted({idx_of[e] for e in entries if e in idx_of and e >= START_2024})
    n = len(t)
    realized = 0.0; peak = CAP; max_dd = 0.0; min_eq = CAP
    trades = []; pos = None; skipped = 0
    bars_in_mkt = 0; max_notional = 0.0
    si = 0
    i = sig_idx[0] if sig_idx else n
    first_i = i
    while i < n:
        if pos is None:
            while si < len(sig_idx) and sig_idx[si] < i: si += 1
            if si >= len(sig_idx): break
            i = sig_idx[si]
            px = o[i]
            coins = BASE / px
            pos = {'first': px, 'coins': coins, 'cost': BASE, 'avg': px, 'lv': 0, 'ti': i, 'fees': BASE * FEE,
                   'maxh': px, 'fills': 1}
            max_notional = max(max_notional, pos['cost'])
        else:
            if si < len(sig_idx) and sig_idx[si] == i: skipped += 1
        while si < len(sig_idx) and sig_idx[si] <= i: si += 1
        bars_in_mkt += 1
        p = pos
        if h[i] > p['maxh']: p['maxh'] = h[i]
        filled = False
        while p['lv'] < len(ladder):
            lvl_pct, mult = ladder[p['lv']]
            lvl = p['first'] * (1 + lvl_pct / 100)
            if h[i] < lvl: break
            fpx = max(lvl, o[i]) if i != p['ti'] else lvl
            add = BASE * mult
            p['coins'] += add / fpx; p['cost'] += add; p['avg'] = p['cost'] / p['coins']
            p['fees'] += add * FEE; p['lv'] += 1; p['fills'] += 1; filled = True
        max_notional = max(max_notional, p['cost'])
        # mark-to-market worst point of the bar (short loses on the high)
        eq_low = CAP + realized + p['coins'] * (p['avg'] - h[i]) - p['fees']
        min_eq = min(min_eq, eq_low)
        max_dd = max(max_dd, peak - eq_low)
        exit_px = None; reason = None
        if not filled:
            tp = p['avg'] * (1 - tp_pct / 100)
            if l[i] <= tp:
                exit_px = min(tp, o[i]) if i != p['ti'] else tp; reason = 'tp'
        if exit_px is None and max_hold_days is not None and t[i] + MS['15m'] - t[p['ti']] >= max_hold_days * 86_400_000:
            exit_px = c[i]; reason = 'time'
        if exit_px is not None:
            gross = p['coins'] * (p['avg'] - exit_px)
            fees = p['fees'] + p['coins'] * exit_px * FEE
            net = gross - fees
            realized += net
            peak = max(peak, CAP + realized)
            trades.append({'entry_t': t[p['ti']], 'exit_t': t[i] + MS['15m'], 'net': net, 'fills': p['fills'],
                           'notional': p['cost'], 'mae': (p['maxh'] / p['first'] - 1) * 100,
                           'hold_h': (t[i] + MS['15m'] - t[p['ti']]) / 3_600_000, 'reason': reason})
            pos = None
        i += 1
    open_pos = None
    if pos is not None:
        last = c[n - 1]
        unreal = pos['coins'] * (pos['avg'] - last) - pos['fees'] - pos['coins'] * last * FEE
        open_pos = {'entry_t': t[pos['ti']], 'unreal': unreal, 'notional': pos['cost'], 'fills': pos['fills'],
                    'mae': (pos['maxh'] / pos['first'] - 1) * 100,
                    'hold_h': (t[n - 1] + MS['15m'] - t[pos['ti']]) / 3_600_000}
    total_bars = n - first_i if first_i < n else 1
    return {'trades': trades, 'open': open_pos, 'realized': realized, 'max_dd': max_dd, 'min_eq': min_eq,
            'max_notional': max_notional, 'skipped': skipped, 'signals': len(sig_idx),
            'in_mkt_pct': bars_in_mkt / total_bars * 100}


def summarize(r, years=(2024, 2025, 2026)):
    from lib import utc
    tr = r['trades']; n = len(tr)
    wins = sum(1 for x in tr if x['net'] > 0)
    by_year = {y: 0.0 for y in years}
    for x in tr:
        y = utc(x['exit_t']).year
        if y in by_year: by_year[y] += x['net']
    maes = sorted(x['mae'] for x in tr) or [0]
    holds = sorted(x['hold_h'] for x in tr) or [0]
    entries = sorted(x['entry_t'] for x in tr) + ([r['open']['entry_t']] if r['open'] else [])
    gaps = [(b - a) / 86_400_000 for a, b in zip(entries, entries[1:])]
    op = r['open']
    weeks = max(1e-9, (1793923200000 + 2 * 86_400_000 - START_2024) / (7 * 86_400_000))
    return {
        'trades': n, 'per_week': n / weeks, 'wr': wins / n * 100 if n else 0,
        'net': r['realized'], 'open_unreal': op['unreal'] if op else 0.0,
        'total': r['realized'] + (op['unreal'] if op else 0.0),
        'by_year': by_year, 'max_dd': r['max_dd'], 'min_eq': r['min_eq'], 'max_notional': r['max_notional'],
        'mae_max': max(maes + ([op['mae']] if op else [])), 'mae_p90': maes[int(0.9 * (len(maes) - 1))],
        'hold_med_h': holds[len(holds) // 2], 'hold_max_d': max(holds + ([op['hold_h']] if op else [])) / 24,
        'max_gap_d': max(gaps) if gaps else 0, 'in_mkt': r['in_mkt_pct'],
        'dca_used': sum(1 for x in tr if x['fills'] > 1), 'full_ladder': max([x['fills'] for x in tr] + [0]),
        'open': op, 'time_exits': sum(1 for x in tr if x['reason'] == 'time'),
        'time_exit_loss': sum(x['net'] for x in tr if x['reason'] == 'time'),
    }
