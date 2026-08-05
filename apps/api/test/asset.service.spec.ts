import { AssetService } from '../src/modules/asset/asset.service';
import { __seedAssetStore, __setSpotCostBasis } from './stubs/app-db';

const SPOT = 'cat-spot';
const TRADING = 'cat-trading';
const BITGET = 'cat-bitget';

async function deposit(service: AssetService, toCategoryId: string, amountUsdt: number) {
  return service.createTransaction({ type: 'DEPOSIT', amountUsdt, toCategoryId });
}

describe('AssetService', () => {
  let service: AssetService;

  beforeEach(() => {
    __seedAssetStore([
      { id: SPOT, key: 'spot', label: 'Spot', sortOrder: 1 },
      { id: TRADING, key: 'trading', label: 'Trading', sortOrder: 2 },
      { id: BITGET, key: 'bitget', label: 'Bitget', sortOrder: 3 },
    ]);
    service = new AssetService();
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
