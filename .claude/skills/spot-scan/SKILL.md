---
name: spot-scan
description: Use this skill whenever the user wants to scan the market for spot-buy candidates by FUNDAMENTALS — "spot scan", "scan coin", "quét coin", "tìm coin tiềm năng", "tìm dự án tốt để mua", "coin nào có thể tăng mạnh", "next ZEC", "tìm coin giống ZEC", "scan theo vốn hoá". Runs a fundamental screener (deep drawdown from ATH, low dilution / high MC-FDV, high circulating %, market-cap window) over Binance-listed coins, then helps evaluate the top picks like a fund (team, investors, tokenomics, unlocks). No technical/price-pattern analysis.
version: 2.0.0
---

# Spot Scan — pick spot buys by fundamentals (find the next ZEC)

A **fundamental** screener for asymmetric spot buys. It ranks Binance-listed coins in a market-cap
window on the quantitative fundamentals a value buyer cares about — then you do the qualitative due
diligence on the top picks. **No technical / price-pattern analysis.**

Reference (ZEC, measured): at its $15.78 low it was **−99.5% from its $3,191 ATH**, with a **hard
21M cap**, ~73% already mined (fair-launch, **no VC unlock overhang**), market cap ~$267M — then ran
~97×. Those are the fundamentals the scan looks for.

## Execute

```bash
cd /root/market-analysis && TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
  scripts/run-spot-scan.ts 25 --min=30 --max=2000 --vol=2
```

Args (market caps in $M): `rows`, then `--min` `--max` (cap window), `--vol` (min 24h volume).
Fast (no klines) — Binance `exchangeInfo` for the universe + a few CoinGecko pages.

### Market-cap window — what to pick
- **Default $30M–$2B.** ZEC's move began at ~$267M, so the opportunity is small/mid-cap.
- **< $30M:** dead/illiquid — skip. **$30M–$300M:** highest asymmetry (10–50×) + highest risk →
  needs the strongest fundamentals (this is the ZEC-at-liftoff zone). **$300M–$2B:** survivors, 3–10×.
  **> a few $B:** little room to multiply.
- Adjust on request, e.g. `--min=150 --max=500` for the ZEC-liftoff band.

## Present the results

Show the ranked table and read the columns:
- **score** — deep drawdown from ATH + low dilution (MC/FDV) + high circulating %.
- **ATH%** — TRUE drawdown from all-time high (deeper = more beaten-down / room to re-rate).
- **MC/FDV** — dilution: near 100% = most supply already circulating (good); **< 30% = heavy unlock
  overhang** (🚩). **circ%** — how much of max supply is already out.
- **30d%** — recent price change, shown as context only (not scored).

**Then flag the trap:** a coin can be −100% from ATH with high MC/FDV and still be **dead** (e.g.
LUNC/Terra Classic). The scan is a quantitative filter only — the qualitative layer decides.

## Then: fundamental due diligence (the deciding layer)

For the top picks, evaluate like a fund — **do not invent facts**; use `WebSearch`/`WebFetch` for
real data and cite the source (or point the user to it if unknown):
- **Team** — founders / CEO / CTO, doxxed?, track record, GitHub activity.
- **Investors & funding** — which VCs (tier-1 > unknowns), amount raised, valuation, when.
  Source: RootData, CryptoRank, Messari, ICO Drops.
- **Tokenomics** — allocation (team/investors/community); insiders > 40–50% = 🚩.
- **Unlocks/vesting** — upcoming cliffs / large unlocks. Source: Token Unlocks, CryptoRank.
- **Traction** — TVL, revenue, real usage. Source: DefiLlama, Token Terminal.
- **Narrative/catalyst** — sector in favour + upcoming catalyst; supply structure / hard cap.

The full checklist + the ZEC "backtest" (how ZEC scored on these criteria) + source table live in the
**"Spot Scan" strategy** on `/strategy`. Keep the two in sync if the method changes.

## Notes
- No API keys: Binance `exchangeInfo` for the tradable USDT universe; CoinGecko `/coins/markets`
  (needs a `User-Agent`, already set) for market cap + FDV + ATH + supply. Only Binance-listed coins.
- It is a **research filter, not a buy signal**. Deep-drawdown + low-dilution raises the odds; most
  such coins never become ZEC. Fundamentals decide.
