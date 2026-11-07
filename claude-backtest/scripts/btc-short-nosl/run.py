import json, multiprocessing as mp, sys, time
import strategies as S
from sim import simulate, summarize

TPS = [1.0, 1.5, 2.0, 3.0]
LADDERS = {
    'không DCA': [],
    'DCA +3/+6/+10% (1-1-2)': [(3, 1), (6, 1), (10, 2)],
    'DCA +5/+10/+15% (1-1-2)': [(5, 1), (10, 1), (15, 2)],
}

SIGS = {}


def job(args):
    name, filt, tp, lad, hold = args
    r = simulate(S.D['15m'], SIGS[(name, filt)], tp, LADDERS[lad], max_hold_days=hold)
    s = summarize(r)
    s.update({'strategy': name, 'filter': filt, 'tp': tp, 'ladder': lad, 'hold': hold})
    return s


if __name__ == '__main__':
    t0 = time.time()
    for name, fn in S.STRATS.items():
        base = fn()
        for fk, f in S.FILTERS.items():
            if name.startswith('[đối chứng]') and fk != 'none' and fk != 'D1<EMA50':
                continue
            SIGS[(name, fk)] = base if f is None else [e for e in base if f(e)]
    print('signals', round(time.time() - t0, 1), 's', file=sys.stderr)
    holds = [None] + ([14] if '--hold' in sys.argv else [])
    jobs = [(n, f, tp, lad, hd) for (n, f) in SIGS for tp in TPS for lad in LADDERS for hd in holds]
    with mp.get_context('fork').Pool(8) as p:
        res = p.map(job, jobs, chunksize=4)
    for x in res:
        x['by_year'] = {str(k): v for k, v in x['by_year'].items()}
    json.dump(res, open('results.json', 'w'), ensure_ascii=False, default=str)
    print('done', len(res), 'sims', round(time.time() - t0, 1), 's', file=sys.stderr)
