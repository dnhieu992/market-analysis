"""Same rules as sim.py but up to `max_pos` independent positions (each with its own ladder)."""
from lib import MS, START_2024
from sim import FEE, CAP, BASE

def simulate_multi(m15, entries, tp_pct, ladder, max_pos=1, max_hold_days=None, min_gap_h=0):
    t,o,h,l,c=m15['t'],m15['o'],m15['h'],m15['l'],m15['c']; idx=m15['_idx']
    sig=set(idx[e] for e in entries if e in idx and e>=START_2024)
    if not sig: return None
    n=len(t); i0=min(sig)
    realized=0.0; peak=CAP; max_dd=0.0; min_eq=CAP; trades=[]; P=[]; max_notional=0.0; inmkt=0; last_entry=-10**18
    for i in range(i0,n):
        if i in sig and len(P)<max_pos and t[i]-last_entry>=min_gap_h*3_600_000:
            P.append({'first':o[i],'coins':BASE/o[i],'cost':BASE,'avg':o[i],'lv':0,'ti':i,'fees':BASE*FEE,'maxh':o[i],'fills':1}); last_entry=t[i]
        if not P: continue
        inmkt+=1; keep=[]; unreal_low=0.0
        for p in P:
            if h[i]>p['maxh']: p['maxh']=h[i]
            filled=False
            while p['lv']<len(ladder):
                pct,mult=ladder[p['lv']]; lvl=p['first']*(1+pct/100)
                if h[i]<lvl: break
                fpx=max(lvl,o[i]) if i!=p['ti'] else lvl; add=BASE*mult
                p['coins']+=add/fpx; p['cost']+=add; p['avg']=p['cost']/p['coins']; p['fees']+=add*FEE; p['lv']+=1; p['fills']+=1; filled=True
            ex=None; why=None
            if not filled:
                tp=p['avg']*(1-tp_pct/100)
                if l[i]<=tp: ex=min(tp,o[i]) if i!=p['ti'] else tp; why='tp'
            if ex is None and max_hold_days and t[i]+MS['15m']-t[p['ti']]>=max_hold_days*86_400_000: ex=c[i]; why='time'
            if ex is not None:
                net=p['coins']*(p['avg']-ex)-p['fees']-p['coins']*ex*FEE; realized+=net
                trades.append({'entry_t':t[p['ti']],'exit_t':t[i]+MS['15m'],'net':net,'fills':p['fills'],'notional':p['cost'],
                               'mae':(p['maxh']/p['first']-1)*100,'hold_h':(t[i]+MS['15m']-t[p['ti']])/3.6e6,'reason':why})
            else:
                keep.append(p); unreal_low+=p['coins']*(p['avg']-h[i])-p['fees']
        P=keep
        max_notional=max(max_notional,sum(p['cost'] for p in P))
        eq=CAP+realized+unreal_low; min_eq=min(min_eq,eq); max_dd=max(max_dd,peak-eq)
        if not P: peak=max(peak,CAP+realized)
    op=None
    if P:
        last=c[n-1]
        op={'entry_t':min(t[p['ti']] for p in P),'unreal':sum(p['coins']*(p['avg']-last)-p['fees']-p['coins']*last*FEE for p in P),
            'notional':sum(p['cost'] for p in P),'fills':max(p['fills'] for p in P),'mae':max((p['maxh']/p['first']-1)*100 for p in P),
            'hold_h':max((t[n-1]-t[p['ti']])/3.6e6 for p in P),'count':len(P)}
    return {'trades':trades,'open':op,'realized':realized,'max_dd':max_dd,'min_eq':min_eq,'max_notional':max_notional,
            'skipped':0,'signals':len(sig),'in_mkt_pct':inmkt/(n-i0)*100}
