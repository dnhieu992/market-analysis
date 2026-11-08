"""Strategy C vs B: overlap of the volume-climax signal with B's crash triggers, and whether volume/support adds to B."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from csr import C, vr, ctx
from csr2 import scan, line, HDR, climax

def b_sig(x, i):
    c = x['c']
    return (i >= 30 and (c[i] <= .80 * c[i-3] or c[i] <= .75 * c[i-7] or c[i] <= .60 * c[i-30]))

def near_zone(x, i):
    tol, zs = ctx(x, i); l = x['l'][i]
    return any(s >= 2 and abs(l / p - 1) <= 2 * tol for p, s, _ in zs)

def wick(x, i, w=.4):
    h, l = x['h'][i], x['l'][i]
    return h > l and (min(x['o'][i], x['c'][i]) - l) / (h - l) >= w

info = lambda x, i: dict(level=0, zs=None)
B = lambda f: (lambda x, i: info(x, i) if b_sig(x, i) and f(x, i) else None)
print('=== B (3d≤−20% | 7d≤−25% | 30d≤−40%) tách theo volume / râu nến / vùng hỗ trợ — top 100 vol, cooldown 10d ===\n' + HDR)
ev = scan({
    'B tất cả': B(lambda x, i: True),
    'B + volume ≥ 2×': B(lambda x, i: vr(x, i) >= 2),
    'B + volume < 1.2×': B(lambda x, i: vr(x, i) < 1.2),
    'B + râu dưới ≥ 40%': B(wick),
    'B + râu < 20%': B(lambda x, i: not wick(x, i, .2)),
    'B + gần vùng hỗ trợ': B(near_zone),
    'B + KHÔNG gần vùng hỗ trợ': B(lambda x, i: not near_zone(x, i)),
    'B + vol≥2× + râu≥40% + vùng HT': B(lambda x, i: vr(x, i) >= 2 and wick(x, i) and near_zone(x, i)),
    'C climax (v≥2, −15%, râu .4)': lambda x, i: climax(x, i, 2.0, .15, .4),
    'C climax KHÔNG trùng B': lambda x, i: None if b_sig(x, i) else climax(x, i, 2.0, .15, .4),
})
for k, rows in ev.items(): line(k, rows)
