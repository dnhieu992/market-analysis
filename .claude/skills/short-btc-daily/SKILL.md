---
name: short-btc-daily
description: Use this skill whenever the user mentions "short btc daily", "btc short setup", "phân tích btc daily short", "tìm setup short btc", "btc bearish", "btc có thể short không", or wants to know if BTC has a short/bearish opportunity. Always use this skill when the user asks about shorting or bearish intraday setups for BTC/BTCUSDT — even if they phrase it casually.
version: 0.3.0
---

# Short BTC Intraday — Day Trading Short Setup Finder

Run the analysis script and present the output directly in the chat. No overnight positions — all setups are designed for same-session entry and exit.

## Execute

```bash
python3 /root/market-analysis/.claude/skills/short-btc-daily/analyze.py
```

## What the script does

Fetches live BTCUSDT data from Binance (4H × 100 bars, 1H × 48 bars, 15min × 20 bars in parallel) and always produces at least one short setup regardless of the macro trend.

**Analysis layers:**
- **4H** — trend classification + S/R zone clustering (0.5% grouping, 6 nearest zones)
- **1H** — setup detection in priority order:
  1. Resistance Rejection — bearish wick rejection at 4H resistance zone
  2. Break & Retest — 1H support broken, price retesting from below
  3. Lower High Continuation — price within 1.5% of last 1H swing high in downtrend
  4. Range Top Short — price in top 15% of 4H range during sideways
  5. Counter-Trend at Resistance — uptrend but 15min confirms bearish at major resistance
- **15min** — entry confirmation (bearish pin bar or engulfing)

**Risk scoring (0–10):**
- 4H trend alignment: up to 3 pts
- 15min confirmation: up to 2 pts
- Volume vs 20-period avg: up to 2 pts
- R:R ≥ 2:1 or 3:1: up to 2 pts
- Zone quality (2+ tests): 1 pt
- Grade A (8–10) · B (6–7) · C (4–5) · D (≤3 speculative)

**Entry structure:** always limit orders — entry zone, hard SL, TP1 (1:1 close 40%), TP2 (1:2 close 40%), TP3 (next support close 20%), with an 8-hour intraday close rule.

## Output the result

Print the script output verbatim into the chat. If the script fails (network error, etc.), report the error and suggest retrying.
