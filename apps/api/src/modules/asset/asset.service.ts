import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  createAssetCategoryRepository,
  createAssetTransactionRepository,
  createBitgetTradeRepository,
  createHoldingRepository,
  createMexcTradeRepository,
  createOrderRepository,
} from '@app/db';

import { BitgetTradeClient } from '../bitget/bitget-trade.client';
import { MexcTradeClient } from '../mexc/mexc-trade.client';
import { BinanceMarketDataService } from '../market/binance-market-data.service';

import type { CreateAssetCategoryDto } from './dto/create-asset-category.dto';
import type { CreateAssetTransactionDto } from './dto/create-asset-transaction.dto';
import type { UpdateAssetCategoryDto } from './dto/update-asset-category.dto';

/** How many ledger rows the page shows. Balances are summed in SQL, not from this slice. */
const LEDGER_LIMIT = 200;

export type AssetCategoryDto = {
  id: string;
  key: string;
  label: string;
  sortOrder: number;
  /** Net USDT sitting in this bucket right now (deposits + transfers in − withdrawals − out). */
  balanceUsdt: number;
};

export type AssetTransactionDto = {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAW' | 'TRANSFER';
  amountUsdt: number;
  fromCategoryId: string | null;
  toCategoryId: string | null;
  note: string | null;
  occurredAt: string;
  createdAt: string;
};

/** One bucket whose balance counts as capital already committed, not spendable. */
export type AssetDeployedDto = {
  key: string;
  label: string;
  balanceUsdt: number;
};

/** Where a deployed bucket's PnL came from — the page says so rather than implying certainty. */
export type AssetDeployedSource =
  /** Live account equity read from the exchange — includes fees and funding. */
  | 'exchange'
  /** Mirrored closed trades in our DB; the exchange call failed or has no key. */
  | 'sync'
  /** The manual /trades book: closed PnL plus open orders marked to Binance last price. */
  | 'orders'
  /** Nothing readable — the bucket falls back to showing its capital only. */
  | 'unknown';

/**
 * A deployed bucket valued as capital + PnL rather than as the raw amount
 * transferred in, so /my-asset answers "is this account up or down?" for
 * Bitget, MEXC and the manual trade book the same way their own pages do.
 */
export type AssetDeployedValueDto = AssetDeployedDto & {
  /** Net USDT transferred in — the cost basis the return is measured against. */
  capitalUsdt: number;
  /** `capitalUsdt + pnlUsdt`. Falls back to capital when PnL is unknown. */
  currentValueUsdt: number;
  /** Profit already banked by closed trades. */
  realizedPnlUsdt: number;
  /** Open-position profit still on paper. */
  unrealizedPnlUsdt: number;
  /** `realized + unrealized`, or null when no source could be read. */
  pnlUsdt: number | null;
  /** Return on capital, %. Null when PnL is unknown or capital is 0 (undefined return). */
  pnlPct: number | null;
  source: AssetDeployedSource;
  /**
   * True when the bucket holds open positions that could not be priced, so the
   * unrealized half understates reality. Only the `orders` source can set it.
   */
  pricedPartially: boolean;
};

/**
 * One coin still held on spot, marked to market. The allocation donut splits the
 * spot bucket into these instead of showing it as a single lump, because "3,163
 * USDT in spot" says nothing about how much of it is BTC.
 */
export type AssetSpotPositionDto = {
  /** Coin symbol as stored on the holding, upper-cased — `BTC`, `ETH`, … */
  coinId: string;
  amount: number;
  /** Cost basis of the position. */
  costUsdt: number;
  /** Amount × Binance last price, or the cost basis when the coin has no price. */
  marketValueUsdt: number;
  /** False when the value above fell back to cost — the page can flag it. */
  priced: boolean;
};

/**
 * The "what can I still deploy?" breakdown, returned alongside the totals so the
 * page can show the arithmetic rather than an unexplained number.
 */
export type AssetAvailableDto = {
  /**
   * Spendable USDT: the ledger minus what is tied up, plus profit already sold
   * into cash. Unrealized PnL is deliberately NOT subtracted — paper gains and
   * losses cannot be deployed until the position is closed, and letting them in
   * would make this number twitch with every price tick while the actual cash
   * balance sat still. Mark-to-market lives in `currentValueUsdt` instead.
   */
  availableUsdt: number;
  /** Cost basis of coins still held on spot — money spent, not sitting idle. */
  spentOnSpotUsdt: number;
  /** What those same coins are worth right now at Binance last price. */
  spotMarketValueUsdt: number;
  /** `spotMarketValueUsdt − spentOnSpotUsdt` — profit still on paper. */
  unrealizedSpotPnlUsdt: number;
  /**
   * Profit already banked by selling — the "All-time Realized P&L" on
   * /portfolio-pnl. It is real USDT sitting in the spot account that the manual
   * ledger never recorded, so it has to be added back or available understates
   * a book that has been trading profitably.
   */
  realizedSpotPnlUsdt: number;
  /** `unrealized + realized` — what /portfolio calls the coin's all-time profit. */
  totalSpotPnlUsdt: number;
  /**
   * True when at least one held coin had no usable price and was valued at its
   * cost instead, so the PnL above understates reality. The page says so rather
   * than presenting a partial number as complete.
   */
  pricedPartially: boolean;
  /**
   * Every coin still held, valued at market and sorted largest first — what the
   * allocation donut draws in place of a single "Spot" slice.
   */
  spotPositions: AssetSpotPositionDto[];
  /** Balance of the `spot` bucket itself — the allocation coins are bought from. */
  spotAllocationUsdt: number;
  /**
   * Buckets that are neither spot nor deployed — `wallet` plus any bucket the
   * trader adds later. Their balances are plain cash and count toward available
   * in full, so a new category is spendable by default rather than invisible.
   */
  liquid: AssetDeployedDto[];
  /**
   * The `trading` / `bitget` / `mexc` buckets, each already committed — and each
   * marked to market, so the page can show what the capital grew or shrank to.
   */
  deployed: AssetDeployedValueDto[];
};

export type AssetSummaryDto = {
  /** Sum of every bucket = total deposited − total withdrawn. Currency is always USDT. */
  totalUsdt: number;
  totalDepositedUsdt: number;
  totalWithdrawnUsdt: number;
  /**
   * `totalUsdt` marked to market: the ledger plus spot PnL plus the PnL of every
   * deployed bucket. This is the number that answers "what is the book worth
   * right now?", so it has to include the exchange accounts, not just spot.
   */
  currentValueUsdt: number;
  /** Spot realized + unrealized — the same figure `available.totalSpotPnlUsdt` carries. */
  totalSpotPnlUsdt: number;
  /** Summed PnL of every deployed bucket whose value could be read; 0 when none could. */
  totalDeployedPnlUsdt: number;
  /** `totalSpotPnlUsdt + totalDeployedPnlUsdt` — the whole book's result. */
  totalPnlUsdt: number;
  available: AssetAvailableDto;
  categories: AssetCategoryDto[];
  transactions: AssetTransactionDto[];
};

/** The spot-book terms of the breakdown — everything `valueSpot()` works out. */
type AssetSpotValuation = Omit<
  AssetAvailableDto,
  'availableUsdt' | 'deployed' | 'liquid' | 'spotAllocationUsdt'
>;

/**
 * The slice of the Bitget/MEXC trade clients this service uses. Both satisfy it;
 * naming only what is read keeps the dependency honest and the stub small.
 */
type ExchangeBalanceClient = {
  isConfigured(): boolean;
  getAccountBalance(): Promise<{ accountEquity: number; unrealizedPL: number } | null>;
};

/** What one deployed-bucket valuation resolves to; null means no source could be read. */
type DeployedPnl = {
  realizedPnlUsdt: number;
  unrealizedPnlUsdt: number;
  source: Exclude<AssetDeployedSource, 'unknown'>;
  pricedPartially: boolean;
};

/** Held coins that are USDT by definition — Binance lists no `<stable>USDT` pair for them. */
const STABLE_COINS = new Set(['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'FDUSD']);

/**
 * Prices move far slower than the trader clicks. Caching them briefly keeps a
 * burst of saves (each one refetches the summary) down to a single Binance call.
 */
const PRICE_CACHE_MS = 30_000;

/**
 * Buckets treated as "already committed" when working out what is available.
 * Spot is deliberately absent: its allocation is only spent to the extent coins
 * were actually bought, which `spentOnSpotUsdt` measures directly.
 */
const DEPLOYED_KEYS = ['trading', 'bitget', 'mexc'] as const;

/** The bucket coins are bought from; handled by cost basis rather than in full. */
const SPOT_KEY = 'spot';

/** A slug the UI and future code can rely on: lowercase, digits, dash/underscore. */
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

@Injectable()
export class AssetService {
  private readonly logger = new Logger(AssetService.name);
  private readonly categories = createAssetCategoryRepository();
  private readonly transactions = createAssetTransactionRepository();
  private readonly holdings = createHoldingRepository();
  private readonly orders = createOrderRepository();
  private readonly bitgetTrades = createBitgetTradeRepository();
  private readonly mexcTrades = createMexcTradeRepository();
  private readonly priceCache = new Map<string, { price: number; at: number }>();

  constructor(
    @Inject(BinanceMarketDataService)
    private readonly market: BinanceMarketDataService,
    // Injected rather than constructed inline (unlike BitgetService/MexcService,
    // which predate this) so a test can drive the live-equity path without a key.
    @Inject(BitgetTradeClient)
    private readonly bitget: ExchangeBalanceClient,
    @Inject(MexcTradeClient)
    private readonly mexc: ExchangeBalanceClient,
  ) {}

  /** Everything /my-asset renders in one round trip. */
  async getSummary(): Promise<AssetSummaryDto> {
    const [categories, balances, byType, transactions, spot] = await Promise.all([
      this.categories.findAll(),
      this.transactions.sumBalances(),
      this.transactions.sumByType(),
      this.transactions.findAll(LEDGER_LIMIT),
      this.valueSpot(),
    ]);

    const balanceById = new Map(balances.map((b) => [b.categoryId, b.balanceUsdt]));
    const categoryDtos = categories.map((c) => ({
      id: c.id,
      key: c.key,
      label: c.label,
      sortOrder: c.sortOrder,
      balanceUsdt: balanceById.get(c.id) ?? 0,
    }));

    const totalUsdt = categoryDtos.reduce((sum, c) => sum + c.balanceUsdt, 0);

    // A deployed bucket the trader deleted simply drops out of the subtraction.
    // Each surviving one is valued as capital + PnL rather than as the raw amount
    // transferred in, so the page reports the account's actual standing.
    const deployed: AssetDeployedValueDto[] = await Promise.all(
      DEPLOYED_KEYS.flatMap((key) => {
        const category = categoryDtos.find((c) => c.key === key);
        return category ? [this.valueDeployed(key, category)] : [];
      }),
    );

    // Everything that is neither spot nor deployed is plain cash — wallet today,
    // and whatever the trader adds tomorrow.
    const deployedKeys = new Set<string>([...DEPLOYED_KEYS, SPOT_KEY]);
    const liquid: AssetDeployedDto[] = categoryDtos
      .filter((c) => !deployedKeys.has(c.key))
      .map((c) => ({ key: c.key, label: c.label, balanceUsdt: c.balanceUsdt }));

    const spotAllocationUsdt = categoryDtos.find((c) => c.key === SPOT_KEY)?.balanceUsdt ?? 0;

    // available = the spot allocation not yet converted into coins, plus profit
    // already banked, plus every cash bucket. Only the REALIZED half of the spot
    // PnL belongs here — it is real USDT the ledger never recorded. Unrealized
    // PnL is reported (in `currentValueUsdt`) but cannot be spent, so it is out.
    //
    // Algebraically identical to `total − spentOnSpot + realized − deployed`;
    // written this way so the page can show each contributing bucket by name.
    const availableUsdt =
      spotAllocationUsdt -
      spot.spentOnSpotUsdt +
      spot.realizedSpotPnlUsdt +
      liquid.reduce((sum, c) => sum + c.balanceUsdt, 0);

    // A bucket whose PnL could not be read contributes 0 rather than dragging the
    // whole total to null — the bucket itself already says its source is unknown.
    const totalDeployedPnlUsdt = deployed.reduce((sum, d) => sum + (d.pnlUsdt ?? 0), 0);

    return {
      totalUsdt,
      totalDepositedUsdt: byType.DEPOSIT ?? 0,
      totalWithdrawnUsdt: byType.WITHDRAW ?? 0,
      currentValueUsdt: totalUsdt + spot.totalSpotPnlUsdt + totalDeployedPnlUsdt,
      totalSpotPnlUsdt: spot.totalSpotPnlUsdt,
      totalDeployedPnlUsdt,
      totalPnlUsdt: spot.totalSpotPnlUsdt + totalDeployedPnlUsdt,
      available: { availableUsdt, ...spot, spotAllocationUsdt, liquid, deployed },
      categories: categoryDtos,
      transactions: transactions.map(toTransactionDto),
    };
  }

  /**
   * Mark one deployed bucket to market. Every branch degrades rather than
   * throws: an unreachable exchange falls back to the trades our sync already
   * mirrored, and a bucket with no source at all reports `unknown` and shows its
   * capital unchanged — which is exactly what the page showed before.
   */
  private async valueDeployed(
    key: (typeof DEPLOYED_KEYS)[number],
    category: AssetCategoryDto,
  ): Promise<AssetDeployedValueDto> {
    const capitalUsdt = category.balanceUsdt;
    const base = { key: category.key, label: category.label, balanceUsdt: capitalUsdt, capitalUsdt };

    const pnl =
      key === 'trading'
        ? await this.valueTradingBook()
        : await this.valueExchange(key, capitalUsdt);

    if (pnl == null) {
      return {
        ...base,
        currentValueUsdt: capitalUsdt,
        realizedPnlUsdt: 0,
        unrealizedPnlUsdt: 0,
        pnlUsdt: null,
        pnlPct: null,
        source: 'unknown',
        pricedPartially: false,
      };
    }

    const pnlUsdt = pnl.realizedPnlUsdt + pnl.unrealizedPnlUsdt;

    return {
      ...base,
      currentValueUsdt: capitalUsdt + pnlUsdt,
      realizedPnlUsdt: pnl.realizedPnlUsdt,
      unrealizedPnlUsdt: pnl.unrealizedPnlUsdt,
      pnlUsdt,
      // A 0-capital bucket has no denominator — % is genuinely undefined, and
      // reporting 0% would read as "flat" when it means "nothing was put in".
      pnlPct: capitalUsdt > 0 ? (pnlUsdt / capitalUsdt) * 100 : null,
      source: pnl.source,
      pricedPartially: pnl.pricedPartially,
    };
  }

  /**
   * Bitget / MEXC. Live account equity is the ground truth — it already nets off
   * fees and funding, and it is the same figure /bitget and /mexc show — so the
   * PnL is simply `equity − capital`, split by the exchange's own unrealized
   * number. When the account can't be read we fall back to the closed trades the
   * worker mirrors into our DB, which knows realized profit but not open positions.
   */
  private async valueExchange(
    key: 'bitget' | 'mexc',
    capitalUsdt: number,
  ): Promise<DeployedPnl | null> {
    const client = key === 'bitget' ? this.bitget : this.mexc;

    if (client.isConfigured()) {
      const balance = await client.getAccountBalance().catch((err) => {
        this.logger.warn(`Failed to read ${key} account balance: ${(err as Error).message}`);
        return null;
      });

      if (balance && Number.isFinite(balance.accountEquity)) {
        const unrealizedPnlUsdt = Number.isFinite(balance.unrealizedPL) ? balance.unrealizedPL : 0;
        return {
          // Everything equity holds beyond capital and open-position PnL is
          // profit that has already settled into the wallet.
          realizedPnlUsdt: balance.accountEquity - capitalUsdt - unrealizedPnlUsdt,
          unrealizedPnlUsdt,
          source: 'exchange',
          pricedPartially: false,
        };
      }
    }

    const realizedPnlUsdt = await (key === 'bitget'
      ? this.bitgetTrades.sumRealizedPnl()
      : this.mexcTrades.sumRealizedPnl()
    ).catch((err) => {
      this.logger.warn(`Failed to read mirrored ${key} trades: ${(err as Error).message}`);
      return null;
    });

    if (realizedPnlUsdt == null) return null;

    // Open positions are invisible from the DB mirror alone, so this is the
    // banked half only — flagged by `source: 'sync'`.
    return { realizedPnlUsdt, unrealizedPnlUsdt: 0, source: 'sync', pricedPartially: false };
  }

  /**
   * The `trading` bucket is the manual book on /trades: banked PnL from closed
   * orders, plus open orders marked to Binance last price. Every broker counts —
   * /trades reports one all-time total across them, and this must agree with it.
   */
  private async valueTradingBook(): Promise<DeployedPnl | null> {
    const summary = await this.orders.allTimePnlSummary().catch((err) => {
      this.logger.warn(`Failed to read the manual trade book: ${(err as Error).message}`);
      return null;
    });

    if (summary == null) return null;

    // An order with no size can't be marked to market; it is skipped rather than
    // valued at 0, and flagged so the page can say the number is incomplete.
    const sizedOpen = summary.openOrders.filter((o) => o.quantity != null && o.quantity !== 0);
    let pricedPartially = sizedOpen.length < summary.openOrders.length;

    const prices = await this.prices([...new Set(sizedOpen.map((o) => o.symbol.toUpperCase()))]);

    let unrealizedPnlUsdt = 0;
    for (const order of sizedOpen) {
      const price = prices[order.symbol.toUpperCase()];
      if (price == null) {
        pricedPartially = true;
        continue;
      }
      const quantity = order.quantity as number;
      unrealizedPnlUsdt +=
        order.side === 'short'
          ? (order.entryPrice - price) * quantity
          : (price - order.entryPrice) * quantity;
    }

    return {
      realizedPnlUsdt: summary.closedPnlSum,
      unrealizedPnlUsdt,
      source: 'orders',
      pricedPartially,
    };
  }

  /**
   * Value the spot book at Binance last price. Every failure mode degrades to
   * "no PnL known" rather than breaking the page: an unreadable holdings table
   * yields zeros, a failed price call values everything at cost, and a single
   * unlisted coin is valued at its own cost and flagged via `pricedPartially`.
   */
  private async valueSpot(): Promise<AssetSpotValuation> {
    const [positions, realizedSpotPnlUsdt] = await Promise.all([
      this.holdings.sumByCoin().catch((err) => {
        this.logger.warn(`Failed to read spot holdings: ${(err as Error).message}`);
        return [] as Array<{ coinId: string; totalAmount: number; totalCost: number }>;
      }),
      // Spans sold-out coins too, so profit taken on a position that no longer
      // exists still counts. Those rows are most of the realized total.
      this.holdings.sumRealizedPnl().catch(() => 0),
    ]);

    const spentOnSpotUsdt = positions.reduce((sum, p) => sum + p.totalCost, 0);
    if (positions.length === 0) {
      // Nothing held, but past sells still banked real USDT.
      return {
        spentOnSpotUsdt: 0,
        spotMarketValueUsdt: 0,
        unrealizedSpotPnlUsdt: 0,
        realizedSpotPnlUsdt,
        totalSpotPnlUsdt: realizedSpotPnlUsdt,
        pricedPartially: false,
        spotPositions: [],
      };
    }

    const priceable = positions.filter((p) => !STABLE_COINS.has(p.coinId.toUpperCase()));
    const prices = await this.prices(priceable.map((p) => `${p.coinId.toUpperCase()}USDT`));

    let spotMarketValueUsdt = 0;
    let pricedPartially = false;
    const spotPositions: AssetSpotPositionDto[] = [];

    for (const position of positions) {
      const coin = position.coinId.toUpperCase();
      const base = { coinId: coin, amount: position.totalAmount, costUsdt: position.totalCost };

      if (STABLE_COINS.has(coin)) {
        // A stablecoin is its own value; there is no pair to price it against.
        spotMarketValueUsdt += position.totalAmount;
        spotPositions.push({ ...base, marketValueUsdt: position.totalAmount, priced: true });
        continue;
      }

      const price = prices[`${coin}USDT`];
      if (price == null) {
        // Value at cost so one unlisted coin contributes 0 PnL instead of
        // wiping its whole position out of the total.
        spotMarketValueUsdt += position.totalCost;
        pricedPartially = true;
        spotPositions.push({ ...base, marketValueUsdt: position.totalCost, priced: false });
        continue;
      }

      const marketValueUsdt = position.totalAmount * price;
      spotMarketValueUsdt += marketValueUsdt;
      spotPositions.push({ ...base, marketValueUsdt, priced: true });
    }

    const unrealizedSpotPnlUsdt = spotMarketValueUsdt - spentOnSpotUsdt;

    return {
      spentOnSpotUsdt,
      spotMarketValueUsdt,
      unrealizedSpotPnlUsdt,
      realizedSpotPnlUsdt,
      totalSpotPnlUsdt: unrealizedSpotPnlUsdt + realizedSpotPnlUsdt,
      pricedPartially,
      // Largest first: the donut and its legend read top-down by weight.
      spotPositions: spotPositions.sort((a, b) => b.marketValueUsdt - a.marketValueUsdt),
    };
  }

  /**
   * Binance last prices, cached briefly. Cached per symbol rather than per call:
   * the spot book and the manual trade book ask for different, overlapping sets
   * within one summary, and a whole-set cache would have each evict the other.
   * A failed call returns whatever was already cached, never throws.
   */
  private async prices(symbols: string[]): Promise<Record<string, number>> {
    if (symbols.length === 0) return {};

    const now = Date.now();
    const wanted = [...new Set(symbols)];
    const missing = wanted.filter((s) => {
      const hit = this.priceCache.get(s);
      return !hit || now - hit.at >= PRICE_CACHE_MS;
    });

    if (missing.length > 0) {
      try {
        const fetched = await this.market.fetchCurrentPrices(missing);
        for (const [symbol, price] of Object.entries(fetched)) {
          this.priceCache.set(symbol, { price, at: now });
        }
      } catch (err) {
        this.logger.warn(`Failed to fetch prices: ${(err as Error).message}`);
      }
    }

    // Symbols that stayed unpriced are simply absent — every caller already
    // treats a missing entry as "unknown price" rather than as zero.
    const result: Record<string, number> = {};
    for (const symbol of wanted) {
      const hit = this.priceCache.get(symbol);
      if (hit) result[symbol] = hit.price;
    }
    return result;
  }

  async createCategory(input: CreateAssetCategoryDto): Promise<AssetCategoryDto> {
    const key = input.key.trim().toLowerCase();
    if (!KEY_PATTERN.test(key)) {
      throw new BadRequestException(
        'key chỉ được chứa chữ thường, số, dấu gạch ngang hoặc gạch dưới',
      );
    }
    if (await this.categories.findByKey(key)) {
      throw new ConflictException(`Danh mục "${key}" đã tồn tại`);
    }

    // New buckets land at the end of the page unless the caller places them.
    const existing = await this.categories.findAll();
    const sortOrder =
      input.sortOrder ?? existing.reduce((max, c) => Math.max(max, c.sortOrder), 0) + 1;

    const created = await this.categories.create({ key, label: input.label.trim(), sortOrder });
    return { ...created, balanceUsdt: 0 };
  }

  async updateCategory(id: string, input: UpdateAssetCategoryDto): Promise<AssetCategoryDto> {
    await this.requireCategory(id);
    const updated = await this.categories.update(id, {
      ...(input.label === undefined ? {} : { label: input.label.trim() }),
      ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
    });
    const balances = await this.transactions.sumBalances();
    return {
      ...updated,
      balanceUsdt: balances.find((b) => b.categoryId === id)?.balanceUsdt ?? 0,
    };
  }

  /**
   * Deleting a bucket that still has history would silently change the total, so
   * the ledger has to be cleared first.
   */
  async deleteCategory(id: string): Promise<{ id: string }> {
    await this.requireCategory(id);
    const used = await this.categories.countTransactions(id);
    if (used > 0) {
      throw new ConflictException(
        `Danh mục còn ${used} giao dịch trong lịch sử — xoá các giao dịch đó trước`,
      );
    }
    await this.categories.deleteById(id);
    return { id };
  }

  async createTransaction(input: CreateAssetTransactionDto): Promise<AssetTransactionDto> {
    if (input.amountUsdt <= 0) {
      throw new BadRequestException('Số tiền phải lớn hơn 0');
    }

    // Each type has exactly one valid shape of endpoints — reject the rest here so
    // the ledger can never hold a row the balance maths would misread.
    const from = input.fromCategoryId ?? null;
    const to = input.toCategoryId ?? null;

    if (input.type === 'DEPOSIT') {
      if (!to) throw new BadRequestException('Nạp cần chọn danh mục nhận (toCategoryId)');
      if (from) throw new BadRequestException('Nạp không có danh mục nguồn');
    } else if (input.type === 'WITHDRAW') {
      if (!from) throw new BadRequestException('Rút cần chọn danh mục nguồn (fromCategoryId)');
      if (to) throw new BadRequestException('Rút không có danh mục nhận');
    } else {
      if (!from || !to) throw new BadRequestException('Chuyển cần cả danh mục nguồn và nhận');
      if (from === to) throw new BadRequestException('Không thể chuyển vào chính danh mục đó');
    }

    if (from) await this.requireCategory(from);
    if (to) await this.requireCategory(to);

    const created = await this.transactions.create({
      type: input.type,
      amountUsdt: input.amountUsdt,
      fromCategoryId: from,
      toCategoryId: to,
      note: input.note?.trim() || null,
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
    });

    return toTransactionDto(created);
  }

  async deleteTransaction(id: string): Promise<{ id: string }> {
    try {
      await this.transactions.deleteById(id);
    } catch {
      throw new NotFoundException(`Không tìm thấy giao dịch ${id}`);
    }
    return { id };
  }

  private async requireCategory(id: string) {
    const category = await this.categories.findById(id);
    if (!category) throw new NotFoundException(`Không tìm thấy danh mục ${id}`);
    return category;
  }
}

function toTransactionDto(row: {
  id: string;
  type: string;
  amountUsdt: unknown;
  fromCategoryId: string | null;
  toCategoryId: string | null;
  note: string | null;
  occurredAt: Date;
  createdAt: Date;
}): AssetTransactionDto {
  return {
    id: row.id,
    type: row.type as AssetTransactionDto['type'],
    amountUsdt: Number(row.amountUsdt),
    fromCategoryId: row.fromCategoryId,
    toCategoryId: row.toCategoryId,
    note: row.note,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
