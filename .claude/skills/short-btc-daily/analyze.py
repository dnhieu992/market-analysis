#!/usr/bin/env python3
"""BTCUSDT Intraday Short Setup Finder — 4H context + 1H setup + 15min entry."""

import json
import sys
import threading
import urllib.request
from datetime import datetime, timezone, timedelta
from statistics import mean


# ── Fetch ──────────────────────────────────────────────────────────────────────

def _fetch(url):
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.loads(r.read())


def fetch_all():
    urls = {
        "h4":  "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=4h&limit=100",
        "h1":  "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=48",
        "m15": "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=20",
    }
    results, errors = {}, {}

    def do(key, url):
        try:
            results[key] = _fetch(url)
        except Exception as e:
            errors[key] = e

    threads = [threading.Thread(target=do, args=(k, u)) for k, u in urls.items()]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    if errors:
        raise RuntimeError(errors)
    return results["h4"], results["h1"], results["m15"]


def parse(raw):
    return [
        {
            "open":   float(k[1]),
            "high":   float(k[2]),
            "low":    float(k[3]),
            "close":  float(k[4]),
            "volume": float(k[5]),
            "time":   int(k[0]),
        }
        for k in raw
    ]


# ── Swing detection ────────────────────────────────────────────────────────────

def find_swings(candles, n=2):
    highs, lows = [], []
    neighbors = [j for j in range(-n, n + 1) if j != 0]
    for i in range(n, len(candles) - n):
        if all(candles[i]["high"] > candles[i + j]["high"] for j in neighbors):
            highs.append({"price": candles[i]["high"], "index": i})
        if all(candles[i]["low"] < candles[i + j]["low"] for j in neighbors):
            lows.append({"price": candles[i]["low"], "index": i})
    return highs, lows


def classify_trend(highs, lows):
    if len(highs) < 3 or len(lows) < 3:
        return "sideways"
    rh = [s["price"] for s in highs[-5:]]
    rl = [s["price"] for s in lows[-5:]]
    lh = sum(1 for i in range(1, len(rh)) if rh[i] < rh[i - 1])
    ll = sum(1 for i in range(1, len(rl)) if rl[i] < rl[i - 1])
    hh = sum(1 for i in range(1, len(rh)) if rh[i] > rh[i - 1])
    hl = sum(1 for i in range(1, len(rl)) if rl[i] > rl[i - 1])
    if lh >= 2 and ll >= 2:
        return "downtrend"
    if hh >= 2 and hl >= 2:
        return "uptrend"
    return "sideways"


# ── S/R zones (4H clustering) ──────────────────────────────────────────────────

def build_sr_zones(h4_candles, current_price):
    highs, lows = find_swings(h4_candles, n=2)
    prices = [(s["price"], "high") for s in highs] + [(s["price"], "low") for s in lows]
    prices.sort(key=lambda x: x[0])
    if not prices:
        return []

    clusters, cur = [], [prices[0]]
    for p in prices[1:]:
        if abs(p[0] - cur[0][0]) / cur[0][0] <= 0.005:
            cur.append(p)
        else:
            clusters.append(cur)
            cur = [p]
    clusters.append(cur)

    zones = []
    for cl in clusters:
        vals = [p[0] for p in cl]
        mid = mean(vals)
        spread = mid * 0.002
        if abs(mid - current_price) / current_price < 0.002:
            continue
        zones.append({
            "midpoint": mid,
            "low":      mid - spread,
            "high":     mid + spread,
            "tests":    len(cl),
            "label":    "resistance" if mid > current_price else "support",
        })

    zones.sort(key=lambda z: abs(z["midpoint"] - current_price))
    return zones[:6]


# ── 15min confirmation ─────────────────────────────────────────────────────────

def m15_bearish_confirm(m15):
    if len(m15) < 2:
        return False, "none"
    c, p = m15[-1], m15[-2]
    body = abs(c["close"] - c["open"])
    uw = c["high"] - max(c["close"], c["open"])
    if body > 0 and uw >= 1.5 * body and c["close"] < c["open"]:
        return True, "bearish pin bar"
    if c["close"] < c["open"] and c["open"] >= p["close"] and c["close"] <= p["open"]:
        return True, "bearish engulfing"
    return False, "none"


# ── Risk scoring ───────────────────────────────────────────────────────────────

def risk_score(trend, m15_confirmed, volume_above_avg, rr, zone_tests):
    score = 0
    breakdown = {}

    # 4H alignment
    if trend in ("downtrend", "sideways"):
        pts = 3 if trend == "downtrend" else 2
        score += pts
        breakdown["4H alignment"] = f"{pts}/3"
    else:
        breakdown["4H alignment"] = "0/3 (counter-trend)"

    # 15min confirmation
    pts = 2 if m15_confirmed else 0
    score += pts
    breakdown["15min confirmation"] = f"{pts}/2"

    # Volume
    pts = 2 if volume_above_avg else 0
    score += pts
    breakdown["Volume"] = f"{pts}/2"

    # R:R
    if rr >= 3.0:
        pts = 2
    elif rr >= 2.0:
        pts = 1
    else:
        pts = 0
    score += pts
    breakdown["R:R"] = f"{pts}/2"

    # Level quality
    pts = 1 if zone_tests >= 2 else 0
    score += pts
    breakdown["Level quality"] = f"{pts}/1"

    grade = "A" if score >= 8 else "B" if score >= 6 else "C" if score >= 4 else "D"
    return score, grade, breakdown


def grade_label(grade):
    return {"A": "Low risk", "B": "Moderate", "C": "High risk", "D": "Speculative"}[grade]


# ── Setup detection ────────────────────────────────────────────────────────────

def avg_vol(candles, n=20):
    return mean(c["volume"] for c in candles[-n:])


def detect_setups(h4, h1, m15, trend, zones):
    price = h1[-1]["close"]
    avg1h = avg_vol(h1, 20)
    m15_ok, m15_pattern = m15_bearish_confirm(m15)
    h1_highs, h1_lows = find_swings(h1, n=2)

    res_zones = sorted([z for z in zones if z["label"] == "resistance"], key=lambda z: z["midpoint"])
    sup_zones = sorted([z for z in zones if z["label"] == "support"],    key=lambda z: z["midpoint"], reverse=True)

    setups = []

    def nearest_support_tp(entry_mid):
        candidates = [z["midpoint"] for z in sup_zones if z["midpoint"] < entry_mid]
        return candidates[0] if candidates else entry_mid * 0.97

    def build_setup(setup_type, entry_low, entry_high, sl, zone_tests):
        entry_mid = (entry_low + entry_high) / 2
        tp1 = entry_mid - (sl - entry_mid)          # 1:1
        tp2 = entry_mid - 2 * (sl - entry_mid)      # 1:2
        tp3 = nearest_support_tp(entry_mid)
        rr = (entry_mid - tp1) / (sl - entry_mid) if sl > entry_mid else 0
        above_avg = h1[-1]["volume"] > avg1h
        sc, gr, breakdown = risk_score(trend, m15_ok, above_avg, rr, zone_tests)
        return {
            "type": setup_type,
            "entry_low": entry_low,
            "entry_high": entry_high,
            "entry_mid": entry_mid,
            "sl": sl,
            "tp1": tp1,
            "tp2": tp2,
            "tp3": tp3,
            "rr": rr,
            "score": sc,
            "grade": gr,
            "breakdown": breakdown,
            "above_avg_vol": above_avg,
            "m15_pattern": m15_pattern,
            "zone_tests": zone_tests,
        }

    # A. Resistance rejection
    for zone in res_zones[:3]:
        recent = h1[-3:]
        touched = any(c["high"] >= zone["low"] for c in recent)
        last = h1[-1]
        body = abs(last["close"] - last["open"])
        uw = last["high"] - max(last["close"], last["open"])
        rejected = body > 0 and uw >= 1.5 * body and last["close"] < last["open"]
        if touched and rejected:
            entry_high = max(last["close"], last["open"])
            entry_low = entry_high * 0.997
            sl = last["high"] * 1.002
            setups.append(build_setup("Resistance Rejection", entry_low, entry_high, sl, zone["tests"]))
            break

    # B. Break & retest
    for zone in sup_zones[:3]:
        broke = next(
            (c for c in h1[-6:-1] if c["open"] > zone["low"] > c["close"]),
            None,
        )
        if broke and zone["low"] <= price <= zone["high"]:
            entry_low = zone["low"]
            entry_high = zone["high"]
            sl = zone["high"] * 1.003
            setups.append(build_setup("Break & Retest", entry_low, entry_high, sl, zone["tests"]))
            break

    # C. Lower high continuation
    if h1_highs and trend in ("downtrend", "sideways"):
        last_sh = h1_highs[-1]["price"]
        if abs(price - last_sh) / last_sh <= 0.015:
            entry_high = last_sh
            entry_low = last_sh * 0.995
            sl = last_sh * 1.005
            setups.append(build_setup("Lower High Continuation", entry_low, entry_high, sl, 1))

    # D. Range top (sideways)
    if trend == "sideways" and len(h4) >= 20:
        range_high = max(c["high"] for c in h4[-20:])
        range_low  = min(c["low"]  for c in h4[-20:])
        threshold  = range_high - (range_high - range_low) * 0.15
        if price >= threshold:
            entry_high = range_high
            entry_low  = range_high * 0.985
            sl = range_high * 1.005
            setups.append(build_setup("Range Top Short", entry_low, entry_high, sl, 2))

    # E. Counter-trend at major resistance (uptrend — requires 15min confirmation)
    if trend == "uptrend" and m15_ok:
        for zone in res_zones[:2]:
            if zone["tests"] >= 2 and abs(price - zone["midpoint"]) / zone["midpoint"] <= 0.005:
                entry_low  = zone["midpoint"] * 0.998
                entry_high = zone["midpoint"] * 1.002
                sl = zone["high"] * 1.003
                setups.append(build_setup("Counter-Trend at Resistance", entry_low, entry_high, sl, zone["tests"]))
                break

    # Fallback — always ensure at least one setup
    if not setups:
        best_res = res_zones[0] if res_zones else None
        if best_res:
            entry_low  = best_res["midpoint"] * 0.998
            entry_high = best_res["midpoint"] * 1.002
            sl = best_res["high"] * 1.003
            setups.append(build_setup("Limit Short at Nearest Resistance", entry_low, entry_high, sl, best_res["tests"]))
        else:
            entry_low  = price * 1.005
            entry_high = price * 1.01
            sl = price * 1.015
            setups.append(build_setup("Overhead Limit Short", entry_low, entry_high, sl, 0))

    # Sort by score desc
    setups.sort(key=lambda s: s["score"], reverse=True)
    return setups


# ── Report ─────────────────────────────────────────────────────────────────────

def build_report(price, now, h4_trend, zones, setups):
    out = []
    W = out.append
    close_by = (now + timedelta(hours=8)).strftime("%H:%M UTC")
    inval_level = setups[0]["sl"] if setups else price * 1.02

    res_zones = sorted([z for z in zones if z["label"] == "resistance"], key=lambda z: z["midpoint"])
    sup_zones = sorted([z for z in zones if z["label"] == "support"],    key=lambda z: z["midpoint"], reverse=True)

    W("📊 BTCUSDT — Intraday Short Analysis")
    W(f"🗓 {now.strftime('%Y-%m-%d %H:%M UTC')}  |  💰 ${price:,.2f}")
    W("")
    W("🔵 4H Context")
    W(f"  Trend: {h4_trend}")
    res_str = "  |  ".join("${:,.0f}".format(z["midpoint"]) for z in res_zones[:3])
    sup_str = "  |  ".join("${:,.0f}".format(z["midpoint"]) for z in sup_zones[:3])
    W(f"  Resistance zones: {res_str if res_str else 'none found'}")
    W(f"  Support zones:    {sup_str if sup_str else 'none found'}")
    W("")

    best = setups[0]
    rr_display = f"{best['rr']:.1f}" if best['rr'] > 0 else "n/a"
    W(f"⚡ Best Setup — {best['type']}")
    W(f"  Risk Score: {best['score']}/10  ·  Grade {best['grade']} ({grade_label(best['grade'])})")
    W("")
    W(f"  📍 Entry Zone (limit sell): ${best['entry_low']:,.0f} – ${best['entry_high']:,.0f}")
    W(f"  🛑 Stop Loss: ${best['sl']:,.2f}  (+{(best['sl'] / best['entry_mid'] - 1) * 100:.2f}% above entry)")
    W(f"  🎯 TP1: ${best['tp1']:,.0f}  (1:1 R:R — close 40%)")
    W(f"  🎯 TP2: ${best['tp2']:,.0f}  (1:2 R:R — close 40%)")
    W(f"  🎯 TP3: ${best['tp3']:,.0f}  (next support — close 20%)")
    W(f"  ⏱ Close by: {close_by}  if TP2 not hit")
    W("")
    W("  Reasoning:")
    W(f"    • Setup type: {best['type']} on 1H chart")
    W(f"    • 15min confirmation: {best['m15_pattern']}")
    W(f"    • Volume vs avg: {'above — confirms momentum' if best['above_avg_vol'] else 'below — weaker signal'}")
    if best["grade"] == "D":
        W(f"    • ⚠️  Grade D — speculative setup, use small size only")
    W("")
    W("  Score breakdown:")
    for k, v in best["breakdown"].items():
        dots = "." * max(1, 22 - len(k))
        W(f"    {k} {dots} {v}")
    W("")

    if len(setups) > 1:
        W("📋 Alternative Setups")
        for i, s in enumerate(setups[1:], 1):
            rr_alt = f"{s['rr']:.1f}" if s['rr'] > 0 else "n/a"
            W(f"  [{i}] {s['type']}")
            W(f"      Entry ${s['entry_low']:,.0f}–${s['entry_high']:,.0f}  |  SL ${s['sl']:,.0f}  |  TP1 ${s['tp1']:,.0f}  |  TP2 ${s['tp2']:,.0f}  |  Score {s['score']}/10 ({s['grade']})")
        W("")

    W(f"⚠️  Invalidation: short thesis off if 1H closes above ${inval_level:,.0f}")
    W(f"⏰  Intraday rule: close ALL positions by {close_by} regardless of result")

    return "\n".join(out)


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    try:
        h4_raw, h1_raw, m15_raw = fetch_all()
    except Exception as e:
        print(f"Fetch error: {e}", file=sys.stderr)
        sys.exit(1)

    h4, h1, m15 = parse(h4_raw), parse(h1_raw), parse(m15_raw)
    price = h1[-1]["close"]
    now = datetime.now(timezone.utc)

    h4_highs, h4_lows = find_swings(h4, n=2)
    h4_trend = classify_trend(h4_highs, h4_lows)

    zones = build_sr_zones(h4, price)
    setups = detect_setups(h4, h1, m15, h4_trend, zones)

    print(build_report(price, now, h4_trend, zones, setups))


if __name__ == "__main__":
    main()
