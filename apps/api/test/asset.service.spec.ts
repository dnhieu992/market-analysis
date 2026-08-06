import { AssetService } from '../src/modules/asset/asset.service';
import {
  __seedAssetStore,
  __setExchangeRealizedPnl,
  __setSpotCostBasis,
  __setSpotPositions,
  __setSpotRealizedPnl,
  __setTradingBook,
} from './stubs/app-db';

const SPOT = 'cat-spot';
const TRADING = 'cat-trading';
const BITGET = 'cat-bitget';
const WALLET = 'cat-wallet';

async function deposit(service: AssetService, toCategoryId: string, amountUsdt: number) {
  return service.createTransaction({ type: 'DEPOSIT', amountUsdt, toCategoryId });
}

/** Stands in for Binance. `prices` is keyed by pair, e.g. { BTCUSDT: 50000 }. */
function marketStub(prices: Record<string, number> = {}, fail = false) {
  return {
    async fetchCurrentPrices() {
      if (fail) throw new Error('binance down');
      return prices;
    },
  } as never;
}

/**
 * Stands in for a Bitget/MEXC account. `equity: null` means the balance call
 * failed; `configured: false` means there is no API key at all — both push the
 * bucket onto the mirrored-trades fallback.
 */
function exchangeStub(
  equity: number | null,
  unrealizedPL = 0,
  configured = true,
) {
  return {
    isConfigured: () => configured,
    async getAccountBalance() {
      if (equity == null) throw new Error('exchange down');
      return { accountEquity: equity, unrealizedPL };
    },
  } as never;
}

/** An account with no key — the default for cases that aren't about the exchanges. */
const NO_ACCOUNT = exchangeStub(null, 0, false);

/** A fresh service per case — the price cache is per-instance. */
function build(
  prices: Record<string, number> = {},
  fail = false,
  bitget = NO_ACCOUNT,
  mexc = NO_ACCOUNT,
) {
  return new AssetService(marketStub(prices, fail), bitget, mexc);
}

describe('AssetService', () => {
  let service: AssetService;

  beforeEach(() => {
    __seedAssetStore([
      { id: SPOT, key: 'spot', label: 'Spot', sortOrder: 1 },
      { id: TRADING, key: 'trading', label: 'Trading', sortOrder: 2 },
      { id: BITGET, key: 'bitget', label: 'Bitget', sortOrder: 3 },
      { id: WALLET, key: 'wallet', label: 'Wallet', sortOrder: 5 },
    ]);
    // The stub's books are module-level, so every case starts them empty rather
    // than inheriting whatever the previous one set.
    __setSpotPositions([]);
    __setSpotRealizedPnl(0);
    __setTradingBook(0);
    __setExchangeRealizedPnl(0, 0);
    service = build();
  });

  describe('getSummary', () => {
    it('starts at zero with the seeded categories and no ledger', async () => {
      const summary = await service.getSummary();
      expect(summary.totalUsdt).toBe(0);
      expect(summary.categories.map((c) => c.key)).toEqual([
        'spot',
        'trading',
        'bitget',
        'wallet',
      ]);
      expect(summary.categories.every((c) => c.balanceUsdt === 0)).toBe(true);
    });

    it('derives each balance and the total from the ledger', async () => {
      await deposit(service, SPOT, 1000);
      await deposit(service, BITGET, 200);
      await service.createTransaction({
        type: 'WITHDRAW',
        amountUsdt: 150,
        fromCategoryId: SPOT,
      });

      const summary = await service.getSummary();
      const byKey = Object.fromEntries(summary.categories.map((c) => [c.key, c.balanceUsdt]));

      expect(byKey.spot).toBe(850);
      expect(byKey.bitget).toBe(200);
      expect(summary.totalUsdt).toBe(1050);
      expect(summary.totalDepositedUsdt).toBe(1200);
      expect(summary.totalWithdrawnUsdt).toBe(150);
    });

    it('leaves the total unchanged when money moves between categories', async () => {
      await deposit(service, SPOT, 1000);
      await service.createTransaction({
        type: 'TRANSFER',
        amountUsdt: 400,
        fromCategoryId: SPOT,
        toCategoryId: BITGET,
      });

      const summary = await service.getSummary();
      const byKey = Object.fromEntries(summary.categories.map((c) => [c.key, c.balanceUsdt]));

      expect(byKey.spot).toBe(600);
      expect(byKey.bitget).toBe(400);
      expect(summary.totalUsdt).toBe(1000);
    });

    it('reverts a deleted ledger row out of the balances', async () => {
      const tx = await deposit(service, SPOT, 500);
      await service.deleteTransaction(tx.id);

      const summary = await service.getSummary();
      expect(summary.totalUsdt).toBe(0);
      expect(summary.transactions).toHaveLength(0);
    });
  });

  describe('availableUsdt', () => {
    it('subtracts spot spend and every deployed bucket from the total', async () => {
      await deposit(service, SPOT, 1000);
      await deposit(service, TRADING, 300);
      await deposit(service, BITGET, 200);
      __setSpotCostBasis(600); // 600 of the spot allocation is already in coins

      const { available, totalUsdt } = await service.getSummary();

      expect(totalUsdt).toBe(1500);
      expect(available.spentOnSpotUsdt).toBe(600);
      expect(available.deployed.map((d) => d.key)).toEqual(['trading', 'bitget']);
      // 1500 − 600 spot spend − 300 trading − 200 bitget
      expect(available.availableUsdt).toBe(400);
    });

    it('counts the whole balance as available when nothing is deployed', async () => {
      await deposit(service, SPOT, 750);
      const { available } = await service.getSummary();
      expect(available.availableUsdt).toBe(750);
      expect(available.spentOnSpotUsdt).toBe(0);
    });

    it('drops a deployed bucket the trader deleted instead of failing', async () => {
      await deposit(service, SPOT, 500);
      await service.deleteCategory(TRADING);

      const { available } = await service.getSummary();
      expect(available.deployed.map((d) => d.key)).toEqual(['bitget']);
      expect(available.availableUsdt).toBe(500);
    });

    it('goes negative when more is committed than the books hold', async () => {
      await deposit(service, TRADING, 100);
      __setSpotCostBasis(400); // bought spot with money the ledger never recorded

      const { available } = await service.getSummary();
      expect(available.availableUsdt).toBe(-400);
    });

    it('reports a transfer into a deployed bucket as committed, not available', async () => {
      await deposit(service, SPOT, 1000);
      await service.createTransaction({
        type: 'TRANSFER',
        amountUsdt: 250,
        fromCategoryId: SPOT,
        toCategoryId: BITGET,
      });

      const { available, totalUsdt } = await service.getSummary();
      expect(totalUsdt).toBe(1000);
      expect(available.deployed.find((d) => d.key === 'bitget')?.balanceUsdt).toBe(250);
      expect(available.availableUsdt).toBe(750);
    });
  });

  describe('spot marked to market', () => {
    it('reports unrealized profit in current value but keeps it out of available', async () => {
      service = build({ BTCUSDT: 120 });
      await deposit(service, SPOT, 1000);
      // 10 BTC bought for 1000 total, now worth 1200 → +200 on paper.
      __setSpotPositions([{ coinId: 'BTC', totalAmount: 10, totalCost: 1000 }]);

      const { available, totalUsdt, currentValueUsdt } = await service.getSummary();

      expect(available.spentOnSpotUsdt).toBe(1000);
      expect(available.spotMarketValueUsdt).toBe(1200);
      expect(available.unrealizedSpotPnlUsdt).toBe(200);
      expect(totalUsdt).toBe(1000); // the ledger headline does not move with price
      expect(currentValueUsdt).toBe(1200);
      // Paper profit cannot be deployed until the position is sold.
      expect(available.availableUsdt).toBe(0);
    });

    it('does not let an unrealized loss eat into spendable cash', async () => {
      service = build({ BTCUSDT: 80 });
      await deposit(service, SPOT, 1100);
      __setSpotPositions([{ coinId: 'BTC', totalAmount: 10, totalCost: 1000 }]);

      const { available, currentValueUsdt } = await service.getSummary();

      expect(available.unrealizedSpotPnlUsdt).toBe(-200);
      expect(currentValueUsdt).toBe(900); // the loss shows here…
      expect(available.availableUsdt).toBe(100); // …but 100 USDT is still in hand
    });

    it('values a coin with no price at cost and flags it', async () => {
      service = build({ BTCUSDT: 120 }); // no price for FOO
      await deposit(service, SPOT, 1000);
      __setSpotPositions([
        { coinId: 'BTC', totalAmount: 10, totalCost: 1000 },
        { coinId: 'FOO', totalAmount: 50, totalCost: 500 },
      ]);

      const { available } = await service.getSummary();

      expect(available.pricedPartially).toBe(true);
      expect(available.spentOnSpotUsdt).toBe(1500);
      expect(available.spotMarketValueUsdt).toBe(1700); // 1200 BTC + 500 FOO at cost
      expect(available.unrealizedSpotPnlUsdt).toBe(200); // FOO contributes nothing
    });

    it('treats stablecoin holdings as 1:1 without asking for a price', async () => {
      service = build({}, true); // even a dead Binance must not break this
      await deposit(service, SPOT, 500);
      __setSpotPositions([{ coinId: 'USDC', totalAmount: 300, totalCost: 300 }]);

      const { available } = await service.getSummary();

      expect(available.spotMarketValueUsdt).toBe(300);
      expect(available.unrealizedSpotPnlUsdt).toBe(0);
      expect(available.pricedPartially).toBe(false);
      expect(available.availableUsdt).toBe(200);
    });

    it('falls back to cost when the price call fails, never throwing', async () => {
      service = build({}, true);
      await deposit(service, SPOT, 1000);
      __setSpotPositions([{ coinId: 'BTC', totalAmount: 10, totalCost: 800 }]);

      const { available } = await service.getSummary();

      expect(available.unrealizedSpotPnlUsdt).toBe(0);
      expect(available.pricedPartially).toBe(true);
      expect(available.availableUsdt).toBe(200);
    });

    it('reports zero PnL and no partial flag when nothing is held', async () => {
      service = build({ BTCUSDT: 120 });
      await deposit(service, SPOT, 400);

      const { available, currentValueUsdt } = await service.getSummary();

      expect(available.spotMarketValueUsdt).toBe(0);
      expect(available.unrealizedSpotPnlUsdt).toBe(0);
      expect(available.pricedPartially).toBe(false);
      expect(currentValueUsdt).toBe(400);
      expect(available.availableUsdt).toBe(400);
    });
  });

  describe('realized spot PnL', () => {
    it('adds banked profit to available — the /portfolio-pnl figure', async () => {
      service = build({ BTCUSDT: 100 });
      await deposit(service, SPOT, 1000);
      __setSpotPositions([{ coinId: 'BTC', totalAmount: 10, totalCost: 1000 }]);
      __setSpotRealizedPnl(150);

      const { available, currentValueUsdt } = await service.getSummary();

      expect(available.unrealizedSpotPnlUsdt).toBe(0);
      expect(available.realizedSpotPnlUsdt).toBe(150);
      expect(available.totalSpotPnlUsdt).toBe(150);
      expect(currentValueUsdt).toBe(1150);
      expect(available.availableUsdt).toBe(150);
    });

    it('nets both halves for the PnL headline but banks only the realized half', async () => {
      service = build({ BTCUSDT: 90 });
      await deposit(service, SPOT, 1200);
      // Cost 1000, now worth 900 → −100 unrealized; +150 already booked.
      __setSpotPositions([{ coinId: 'BTC', totalAmount: 10, totalCost: 1000 }]);
      __setSpotRealizedPnl(150);

      const { available, currentValueUsdt } = await service.getSummary();

      expect(available.unrealizedSpotPnlUsdt).toBe(-100);
      expect(available.totalSpotPnlUsdt).toBe(50); // in profit overall — the /portfolio figure
      expect(currentValueUsdt).toBe(1250);
      // 1200 − 1000 spent + 150 banked. The −100 is on paper, so it stays out.
      expect(available.availableUsdt).toBe(350);
    });

    it('counts profit from coins sold out entirely', async () => {
      service = build();
      await deposit(service, SPOT, 500);
      __setSpotPositions([]); // everything sold
      __setSpotRealizedPnl(75);

      const { available, currentValueUsdt } = await service.getSummary();

      expect(available.spentOnSpotUsdt).toBe(0);
      expect(available.realizedSpotPnlUsdt).toBe(75);
      expect(currentValueUsdt).toBe(575);
      expect(available.availableUsdt).toBe(575);
    });

    it('subtracts realized losses', async () => {
      service = build();
      await deposit(service, SPOT, 500);
      __setSpotRealizedPnl(-80);

      const { available } = await service.getSummary();

      expect(available.totalSpotPnlUsdt).toBe(-80);
      expect(available.availableUsdt).toBe(420);
    });
  });

  describe('cash buckets', () => {
    it('adds the wallet balance to available in full', async () => {
      await deposit(service, SPOT, 1000);
      await deposit(service, WALLET, 250);
      __setSpotPositions([{ coinId: 'BTC', totalAmount: 10, totalCost: 800 }]);

      const { available } = await service.getSummary();

      expect(available.spotAllocationUsdt).toBe(1000);
      expect(available.liquid.map((c) => c.key)).toEqual(['wallet']);
      // (1000 spot − 800 in coins) + 250 wallet
      expect(available.availableUsdt).toBe(450);
    });

    it('treats a newly added bucket as spendable cash, not as deployed', async () => {
      await deposit(service, SPOT, 100);
      const binance = await service.createCategory({ key: 'binance', label: 'Binance' });
      await deposit(service, binance.id, 500);

      const { available } = await service.getSummary();

      expect(available.liquid.map((c) => c.key).sort()).toEqual(['binance', 'wallet']);
      expect(available.availableUsdt).toBe(600);
    });

    it('keeps trading/bitget/mexc out of the cash list', async () => {
      await deposit(service, SPOT, 400);
      await deposit(service, TRADING, 300);
      await deposit(service, BITGET, 200);
      await deposit(service, WALLET, 50);

      const { available } = await service.getSummary();

      expect(available.liquid.map((c) => c.key)).toEqual(['wallet']);
      expect(available.deployed.map((c) => c.key)).toEqual(['trading', 'bitget']);
      expect(available.availableUsdt).toBe(450); // 400 spot + 50 wallet
    });
  });

  describe('deployed buckets marked to market', () => {
    it('values an exchange bucket from live equity and splits the PnL', async () => {
      service = build({}, false, exchangeStub(140, -10));
      await deposit(service, BITGET, 100);

      const bitget = (await service.getSummary()).available.deployed.find(
        (d) => d.key === 'bitget',
      );

      expect(bitget?.source).toBe('exchange');
      expect(bitget?.capitalUsdt).toBe(100);
      expect(bitget?.currentValueUsdt).toBe(140);
      expect(bitget?.pnlUsdt).toBe(40);
      expect(bitget?.pnlPct).toBe(40);
      // Equity already contains the open position's −10; the rest has settled.
      expect(bitget?.unrealizedPnlUsdt).toBe(-10);
      expect(bitget?.realizedPnlUsdt).toBe(50);
    });

    it('reports a losing exchange account with a negative return', async () => {
      service = build({}, false, exchangeStub(82.5));
      await deposit(service, BITGET, 100);

      const bitget = (await service.getSummary()).available.deployed.find(
        (d) => d.key === 'bitget',
      );

      expect(bitget?.pnlUsdt).toBe(-17.5);
      expect(bitget?.pnlPct).toBe(-17.5);
    });

    it('falls back to mirrored closed trades when the exchange call fails', async () => {
      __setExchangeRealizedPnl(9.04, 0);
      service = build({}, false, exchangeStub(null));
      await deposit(service, BITGET, 100);

      const bitget = (await service.getSummary()).available.deployed.find(
        (d) => d.key === 'bitget',
      );

      // Open positions are invisible from the mirror, so only the banked half shows.
      expect(bitget?.source).toBe('sync');
      expect(bitget?.pnlUsdt).toBe(9.04);
      expect(bitget?.unrealizedPnlUsdt).toBe(0);
    });

    it('values the trading bucket from closed PnL plus open orders at market', async () => {
      __setTradingBook(200, [
        { symbol: 'BTCUSDT', side: 'long', entryPrice: 60000, quantity: 0.01 },
        { symbol: 'ETHUSDT', side: 'short', entryPrice: 3000, quantity: 1 },
      ]);
      service = build({ BTCUSDT: 65000, ETHUSDT: 3200 });
      await deposit(service, TRADING, 1000);

      const trading = (await service.getSummary()).available.deployed.find(
        (d) => d.key === 'trading',
      );

      expect(trading?.source).toBe('orders');
      expect(trading?.realizedPnlUsdt).toBe(200);
      // long +50, short −200
      expect(trading?.unrealizedPnlUsdt).toBe(-150);
      expect(trading?.pnlUsdt).toBe(50);
      expect(trading?.pnlPct).toBe(5);
      expect(trading?.currentValueUsdt).toBe(1050);
    });

    it('flags an open order it could not price instead of valuing it at zero', async () => {
      __setTradingBook(0, [
        { symbol: 'BTCUSDT', side: 'long', entryPrice: 60000, quantity: 0.01 },
        { symbol: 'NOPEUSDT', side: 'long', entryPrice: 1, quantity: 100 },
        { symbol: 'ETHUSDT', side: 'long', entryPrice: 3000, quantity: null },
      ]);
      service = build({ BTCUSDT: 65000 });
      await deposit(service, TRADING, 1000);

      const trading = (await service.getSummary()).available.deployed.find(
        (d) => d.key === 'trading',
      );

      expect(trading?.unrealizedPnlUsdt).toBe(50);
      expect(trading?.pricedPartially).toBe(true);
    });

    it('leaves the return undefined when no capital was ever sent', async () => {
      service = build({}, false, exchangeStub(12));
      // Nothing deposited into bitget — 12 USDT of equity against a 0 cost basis.
      const bitget = (await service.getSummary()).available.deployed.find(
        (d) => d.key === 'bitget',
      );

      expect(bitget?.pnlUsdt).toBe(12);
      expect(bitget?.pnlPct).toBeNull();
    });

    it('rolls deployed PnL into the headline totals alongside spot', async () => {
      __setTradingBook(30);
      __setSpotRealizedPnl(20);
      service = build({}, false, exchangeStub(110));
      await deposit(service, SPOT, 500);
      await deposit(service, TRADING, 100);
      await deposit(service, BITGET, 100);

      const summary = await service.getSummary();

      expect(summary.totalUsdt).toBe(700);
      expect(summary.totalSpotPnlUsdt).toBe(20);
      expect(summary.totalDeployedPnlUsdt).toBe(40); // 30 trading + 10 bitget
      expect(summary.totalPnlUsdt).toBe(60);
      expect(summary.currentValueUsdt).toBe(760);
    });

    it('keeps deployed PnL out of available — it is on the exchange, not spendable', async () => {
      service = build({}, false, exchangeStub(500));
      await deposit(service, SPOT, 200);
      await deposit(service, BITGET, 100);

      const { available } = await service.getSummary();

      expect(available.deployed.find((d) => d.key === 'bitget')?.pnlUsdt).toBe(400);
      expect(available.availableUsdt).toBe(200);
    });
  });

  describe('createTransaction validation', () => {
    it('rejects a non-positive amount', async () => {
      await expect(deposit(service, SPOT, 0)).rejects.toThrow('Số tiền phải lớn hơn 0');
    });

    it('rejects a deposit with no destination', async () => {
      await expect(
        service.createTransaction({ type: 'DEPOSIT', amountUsdt: 100 }),
      ).rejects.toThrow(/danh mục nhận/i);
    });

    it('rejects a deposit that also names a source', async () => {
      await expect(
        service.createTransaction({
          type: 'DEPOSIT',
          amountUsdt: 100,
          fromCategoryId: SPOT,
          toCategoryId: BITGET,
        }),
      ).rejects.toThrow(/không có danh mục nguồn/i);
    });

    it('rejects a withdrawal with no source', async () => {
      await expect(
        service.createTransaction({ type: 'WITHDRAW', amountUsdt: 100 }),
      ).rejects.toThrow(/danh mục nguồn/i);
    });

    it('rejects a transfer missing one side', async () => {
      await expect(
        service.createTransaction({ type: 'TRANSFER', amountUsdt: 100, fromCategoryId: SPOT }),
      ).rejects.toThrow(/cả danh mục nguồn và nhận/i);
    });

    it('rejects a transfer into the same category', async () => {
      await expect(
        service.createTransaction({
          type: 'TRANSFER',
          amountUsdt: 100,
          fromCategoryId: SPOT,
          toCategoryId: SPOT,
        }),
      ).rejects.toThrow(/chính danh mục đó/i);
    });

    it('rejects an unknown category', async () => {
      await expect(deposit(service, 'cat-nope', 100)).rejects.toThrow(/Không tìm thấy danh mục/i);
    });
  });

  describe('categories', () => {
    it('slug-checks the key and appends the new bucket last', async () => {
      const created = await service.createCategory({ key: 'Binance', label: 'Binance' });
      expect(created.key).toBe('binance');
      expect(created.sortOrder).toBe(6); // highest existing sortOrder (5) + 1
      expect(created.balanceUsdt).toBe(0);
    });

    it('rejects an invalid key', async () => {
      await expect(service.createCategory({ key: 'my wallet!', label: 'x' })).rejects.toThrow(
        /chữ thường/i,
      );
    });

    it('rejects a duplicate key', async () => {
      await expect(service.createCategory({ key: 'spot', label: 'Spot 2' })).rejects.toThrow(
        /đã tồn tại/i,
      );
    });

    it('renames without touching the key or the balance', async () => {
      await deposit(service, BITGET, 300);
      const updated = await service.updateCategory(BITGET, { label: 'Bitget Futures' });
      expect(updated.label).toBe('Bitget Futures');
      expect(updated.key).toBe('bitget');
      expect(updated.balanceUsdt).toBe(300);
    });

    it('refuses to delete a category that still has ledger history', async () => {
      await deposit(service, SPOT, 100);
      await expect(service.deleteCategory(SPOT)).rejects.toThrow(/còn 1 giao dịch/i);
    });

    it('deletes a category once its ledger is clear', async () => {
      await service.deleteCategory(BITGET);
      const summary = await service.getSummary();
      expect(summary.categories.map((c) => c.key)).toEqual(['spot', 'trading', 'wallet']);
    });
  });
});
