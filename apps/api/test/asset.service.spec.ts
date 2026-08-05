import { AssetService } from '../src/modules/asset/asset.service';
import {
  __seedAssetStore,
  __setSpotCostBasis,
  __setSpotPositions,
  __setSpotRealizedPnl,
} from './stubs/app-db';

const SPOT = 'cat-spot';
const TRADING = 'cat-trading';
const BITGET = 'cat-bitget';

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

/** A fresh service per case — the price cache is per-instance. */
function build(prices: Record<string, number> = {}, fail = false) {
  return new AssetService(marketStub(prices, fail));
}

describe('AssetService', () => {
  let service: AssetService;

  beforeEach(() => {
    __seedAssetStore([
      { id: SPOT, key: 'spot', label: 'Spot', sortOrder: 1 },
      { id: TRADING, key: 'trading', label: 'Trading', sortOrder: 2 },
      { id: BITGET, key: 'bitget', label: 'Bitget', sortOrder: 3 },
    ]);
    service = build();
  });

  describe('getSummary', () => {
    it('starts at zero with the seeded categories and no ledger', async () => {
      const summary = await service.getSummary();
      expect(summary.totalUsdt).toBe(0);
      expect(summary.categories.map((c) => c.key)).toEqual(['spot', 'trading', 'bitget']);
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
    it('adds unrealized profit to available and to the current value', async () => {
      service = build({ BTCUSDT: 120 });
      await deposit(service, SPOT, 1000);
      // 10 BTC bought for 1000 total, now worth 1200 → +200.
      __setSpotPositions([{ coinId: 'BTC', totalAmount: 10, totalCost: 1000 }]);

      const { available, totalUsdt, currentValueUsdt } = await service.getSummary();

      expect(available.spentOnSpotUsdt).toBe(1000);
      expect(available.spotMarketValueUsdt).toBe(1200);
      expect(available.unrealizedSpotPnlUsdt).toBe(200);
      expect(totalUsdt).toBe(1000); // the ledger headline does not move with price
      expect(currentValueUsdt).toBe(1200);
      // 1000 − 1000 spent + 200 profit
      expect(available.availableUsdt).toBe(200);
    });

    it('subtracts unrealized loss — the bug this replaced', async () => {
      service = build({ BTCUSDT: 80 });
      await deposit(service, SPOT, 1100);
      __setSpotPositions([{ coinId: 'BTC', totalAmount: 10, totalCost: 1000 }]);

      const { available, currentValueUsdt } = await service.getSummary();

      expect(available.unrealizedSpotPnlUsdt).toBe(-200);
      expect(currentValueUsdt).toBe(900);
      // 1100 − 1000 spent − 200 loss. Subtracting cost alone would say 100.
      expect(available.availableUsdt).toBe(-100);
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

    it('nets banked profit against an unrealized loss, matching /portfolio', async () => {
      service = build({ BTCUSDT: 90 });
      await deposit(service, SPOT, 1200);
      // Cost 1000, now worth 900 → −100 unrealized; +150 already booked.
      __setSpotPositions([{ coinId: 'BTC', totalAmount: 10, totalCost: 1000 }]);
      __setSpotRealizedPnl(150);

      const { available, currentValueUsdt } = await service.getSummary();

      expect(available.unrealizedSpotPnlUsdt).toBe(-100);
      expect(available.totalSpotPnlUsdt).toBe(50); // in profit overall
      expect(currentValueUsdt).toBe(1250);
      // 1200 − 1000 spent + 50 net profit
      expect(available.availableUsdt).toBe(250);
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
      expect(created.sortOrder).toBe(4); // highest existing sortOrder (3) + 1
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
      expect(summary.categories.map((c) => c.key)).toEqual(['spot', 'trading']);
    });
  });
});
