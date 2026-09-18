---
name: spot-scan
description: Use this skill whenever the user wants to scan the market for spot-buy candidates — "spot scan", "scan coin", "quét coin", "tìm coin tiềm năng", "tìm dự án tốt để mua", "coin nào có thể tăng mạnh", "next ZEC", "tìm coin giống ZEC", "coin tích luỹ sắp breakout", "scan theo vốn hoá". Runs the ZEC-template accumulation→breakout screener over a CoinGecko universe (filtered by market cap) merged with Binance technicals, then helps evaluate the top picks like a fund (team, investors, tokenomics, unlocks).
version: 1.0.0
---

# Spot Scan — find the next ZEC

A two-layer spot-buy screener. **Layer 1 (this script) = technical + quantitative timing:** which
coins are in a ZEC-like accumulation → early breakout right now. **Layer 2 (you, after) = fundamental
due diligence:** which of those actually deserve a buy. Technicals say *when*; fundamentals say *which*.

The ZEC template (measured): $15.78 → $1,535 (~97×). Deep drawdown from ATH → long tight base near
the lows → reclaim of the 200-day SMA → volume expansion → base breakout while still early.

## Execute

Run the screener (universe from CoinGecko, technicals from Binance D1):

```bash
cd /root/market-analysis && TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-spot-scan.ts 25 --min=30 --max=2000 --vol=2 --pool=350
```

Args (market caps in $M): `rows` (how many to show) then flags `--min` `--max` (market-cap window),
`--vol` (min 24h volume), `--pool` (how many CoinGecko coins to pull). Takes ~1–2 min (rate-limited).

### Market-cap window — what to pick
- **Default $30M–$2B** is the sweet spot for "next ZEC" hunting.
- **< ~$30M:** mostly dead/illiquid/scam — hard to exit, skip unless the user asks.
- **$30M–$300M:** highest asymmetry (10–50× room) but highest risk — needs strong fundamentals.
- **$300M–$2B:** survivors with a real chance of 3–10× and better liquidity.
- **> a few $B:** less room to multiply; only if the user wants safer/large-cap revivals.
- Adjust on request, e.g. micro-cap hunt `--min=10 --max=150`, or safer `--min=300 --max=5000`.

## Present the results

1. Show the ranked table (coin, score, market cap, MC/FDV, ATH%, 30d%, signals).
2. Read the columns for the user:
   - **score** — how closely it matches the ZEC accumulation→breakout template (higher = closer).
   - **ATH%** — TRUE drawdown from all-time high (deep = beaten-down, more room).
   - **MC/FDV** — dilution: near 100% = most tokens already circulating (good); **< 30% = heavy
     unlock overhang** (flagged with ⚠).
   - **signals** — `reclaim 200D` (regime flip), `base N×` (tight base), `vol N×` (volume surge),
     `60d high` (breakout), `+N% off low` (`⚠ late` if already > +150% — missed the early phase).
3. Call out the cleanest setups (high score, deep ATH, low dilution, NOT "late") vs the ones to
   avoid (high dilution / already extended).

## Then: fundamental due diligence (layer 2)

The scan is timing only. For the top picks the user is interested in, evaluate like a fund — **do
not invent facts**; use `WebSearch`/`WebFetch` for real data and cite the source, or point the user
to the source if unknown:

- **Team** — founders / CEO / CTO, doxxed?, track record, GitHub activity.
- **Investors & funding** — which VCs (tier-1 like a16z/Paradigm/Binance Labs > unknowns), amount
  raised, valuation, when. Source: RootData, CryptoRank, Messari, ICO Drops.
- **Tokenomics** — allocation (team/investors/community); insiders > 40–50% = red flag.
- **Unlocks/vesting** — upcoming cliffs / large unlocks = sell pressure. Source: Token Unlocks,
  CryptoRank. (The scan's MC/FDV already hints at this.)
- **Traction** — TVL, revenue, real usage. Source: DefiLlama, Token Terminal.
- **Narrative/catalyst** — sector in favour + upcoming catalyst (mainnet, listing, supply lock).

The full checklist + red flags + source table also live in the **"Spot Scan" strategy** on
`/strategy` (the app). Keep the two in sync if the method changes.

## Notes
- No API keys needed: CoinGecko `/coins/markets` (needs a `User-Agent`, already set) for the
  universe + fundamentals; Binance public klines for technicals. ~71/120 coins in a typical window
  trade on Binance; the rest show as `fund-only` (no technical score).
- It is a **research filter, not a buy signal**. Most deep-drawdown coins never become ZEC; the
  filter only raises the odds. Always confirm fundamentals before buying spot.
