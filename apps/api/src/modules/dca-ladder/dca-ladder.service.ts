import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';
import { createDcaLadderRepository } from '@app/db';
import {
  tierPrices,
  computePosition,
  computeTpPrice,
  computeRealizedPnl,
  computeBudget,
  computeDcaTimingSignal,
  computeTimeframeTrend,
  effectiveFirstTierPct,
  type DcaLadderParams,
  type DcaFill,
  type DcaTimingSignal,
  type DcaTimingSeries,
  type PaTrend,
} from '@app/core';
import type { UpdateDcaLadderSettingsDto } from './dto/update-settings.dto';
import type { UpdateOrderDto } from './dto/update-order.dto';

const SYMBOL = 'BTCUSDT';
// BTC circulating supply (~19.8M) — turns live price into an honest market cap
// so the safety score lands in the top "safe" tier the way it does for BTC on
// /tracking-coins. Constant is fine: the cap thresholds top out at $1B.
const BTC_CIRCULATING_SUPPLY = 19_800_000;

@Injectable()
export class DcaLadderService {
  private readonly logger = new Logger(DcaLadderService.name);
  private repo = createDcaLadderRepository();
  private readonly http: AxiosInstance = axios.create({ baseURL: 'https://api.binance.com', timeout: 8_000 });

  private async fetchSeedPeak(): Promise<number> {
    const res = await this.http.get<any[]>('/api/v3/klines', { params: { symbol: SYMBOL, interval: '1d', limit: 30 } });
    return Math.max(...res.data.map((k) => parseFloat(k[2]))); // high
  }

  private async fetchLivePrice(): Promise<number> {
    const res = await this.http.get<{ price: string }>('/api/v3/ticker/price', { params: { symbol: SYMBOL } });
    return parseFloat(res.data.price);
  }

  /**
   * The /tracking-coins DCA signal applied to BTC — tells the user whether now
   * is a reasonable moment to start a DCA layer (GOM), wait (CHO), or take
   * profit (CHOT). Non-fatal: returns null if Binance is unreachable.
   */
  private async fetchTimingSignal(livePrice: number): Promise<DcaTimingSignal | null> {
    const toSeries = (rows: any[]): DcaTimingSeries => ({
      closes: rows.map((k) => parseFloat(k[4])),
      highs: rows.map((k) => parseFloat(k[2])),
      lows: rows.map((k) => parseFloat(k[3])),
    });
    const [d1, w1] = await Promise.all([
      this.http.get<any[]>('/api/v3/klines', { params: { symbol: SYMBOL, interval: '1d', limit: 220 } }),
      this.http.get<any[]>('/api/v3/klines', { params: { symbol: SYMBOL, interval: '1w', limit: 300 } }),
    ]);
    const marketCap = livePrice > 0 ? livePrice * BTC_CIRCULATING_SUPPLY : null;
    return computeDcaTimingSignal(toSeries(d1.data), toSeries(w1.data), marketCap);
  }

  private params(settings: any, firstTierPct: number): DcaLadderParams {
    return { firstTierPct, numTiers: settings.numTiers, stepPct: settings.stepPct };
  }

  /** BTC weekly price-action trend (same `computeTimeframeTrend` the app uses for weekTrend). */
  private async fetchWeekTrend(): Promise<PaTrend> {
    const res = await this.http.get<any[]>('/api/v3/klines', { params: { symbol: SYMBOL, interval: '1w', limit: 300 } });
    const rows = res.data;
    return computeTimeframeTrend(
      rows.map((k) => parseFloat(k[4])),
      rows.map((k) => parseFloat(k[2])),
      rows.map((k) => parseFloat(k[3])),
    );
  }

  /**
   * The first tier % to arm a FLAT cycle with: shallow (firstTierPct) in a weekly
   * uptrend, deep (bearFirstTierPct) in a bear/neutral week. Falls back to the bull
   * value if the weekly trend can't be fetched (keeps prior behaviour, non-fatal).
   */
  private async resolveFirstTierPct(settings: any): Promise<number> {
    try {
      const trend = await this.fetchWeekTrend();
      return effectiveFirstTierPct(trend, settings.firstTierPct, settings.bearFirstTierPct);
    } catch (e) {
      this.logger.warn(`week trend failed, using bull first tier: ${String(e)}`);
      return settings.firstTierPct;
    }
  }

  getSettings() {
    return this.repo.getSettings();
  }

  async updateSettings(dto: UpdateDcaLadderSettingsDto) {
    const settings = await this.repo.updateSettings(dto);
    // Re-arm FLAT cycle with updated settings so tier count/prices/budget stay in sync.
    // Never re-arm an IN_POSITION cycle — that would delete filled buy orders.
    const cycle = await this.repo.getCurrentCycle(SYMBOL);
    if (cycle && cycle.status === 'FLAT') {
      const closed = await this.repo.listClosedCycles(SYMBOL);
      const budget = computeBudget(settings.startCapital, closed.map((c: any) => c.realizedPnl ?? 0));
      const firstTierPct = await this.resolveFirstTierPct(settings);
      await this.repo.updateCycle(cycle.id, { budget });
      await this.armBuyTiers(cycle.id, cycle.peak, budget, settings, firstTierPct);
    }
    return this.getState();
  }

  /** Arm (or re-arm) the BUY tier orders for a FLAT cycle from its peak + budget. */
  private async armBuyTiers(cycleId: string, peak: number, budget: number, settings: any, firstTierPct: number) {
    await this.repo.deleteOrdersByCycle(cycleId);
    const prices = tierPrices(peak, this.params(settings, firstTierPct));
    const usd = budget / settings.numTiers;
    await this.repo.createOrders(
      prices.map((plannedPrice, tierIndex) => ({
        cycleId, side: 'BUY', tierIndex, plannedPrice, usdAmount: usd, status: 'ARMED',
      })),
    );
  }

  private async ensureCycle(settings: any) {
    let cycle = await this.repo.getCurrentCycle(SYMBOL);
    if (cycle) return cycle;
    const closed = await this.repo.listClosedCycles(SYMBOL);
    const peak = await this.fetchSeedPeak();
    const budget = computeBudget(settings.startCapital, closed.map((c: any) => c.realizedPnl ?? 0));
    const firstTierPct = await this.resolveFirstTierPct(settings);
    cycle = await this.repo.createCycle({ symbol: SYMBOL, cycleNumber: closed.length + 1, status: 'FLAT', peak, budget });
    await this.armBuyTiers(cycle.id, peak, budget, settings, firstTierPct);
    return cycle;
  }

  /** Recompute avgCost/positionSize/tpPrice from FILLED buys; manage SELL + status. */
  private async recompute(cycleId: string, settings: any) {
    const orders = await this.repo.getOrdersByCycle(cycleId);
    const filledBuys = orders.filter((o: any) => o.side === 'BUY' && o.status === 'FILLED');
    const fills: DcaFill[] = filledBuys.map((o: any) => ({ price: o.fillPrice!, usd: o.usdAmount! }));
    const sell = orders.find((o: any) => o.side === 'SELL');

    if (fills.length === 0) {
      await this.repo.updateCycle(cycleId, { status: 'FLAT', avgCost: null, positionSize: null, tpPrice: null });
      if (sell) await this.repo.updateOrder(sell.id, { status: 'CANCELLED' });
      return;
    }
    const pos = computePosition(fills, settings.feePct);
    const tpPrice = computeTpPrice(pos.avgCost, settings.tpPct);
    await this.repo.updateCycle(cycleId, {
      status: 'IN_POSITION', avgCost: pos.avgCost, positionSize: pos.positionSize, tpPrice,
    });
    if (sell) {
      await this.repo.updateOrder(sell.id, { plannedPrice: tpPrice, status: sell.status === 'FILLED' ? 'FILLED' : 'ARMED' });
    } else {
      await this.repo.createOrders([{ cycleId, side: 'SELL', tierIndex: null, plannedPrice: tpPrice, usdAmount: null, status: 'ARMED' }]);
    }
  }

  async fillOrder(id: string, fillPrice: number) {
    const settings = await this.repo.getSettings();
    const order = await this.repo.getOrder(id);
    if (!order) throw new NotFoundException('Order not found');
    if (order.side === 'SELL') return this.closeCycle(fillPrice);
    const qty = (order.usdAmount! / fillPrice) * (1 - settings.feePct / 100);
    await this.repo.updateOrder(id, { status: 'FILLED', fillPrice, qty, filledAt: new Date() });
    await this.recompute(order.cycleId, settings);
    return this.getState();
  }

  async unfillOrder(id: string) {
    const settings = await this.repo.getSettings();
    const order = await this.repo.getOrder(id);
    if (!order) throw new NotFoundException('Order not found');
    await this.repo.updateOrder(id, { status: 'ARMED', fillPrice: null, qty: null, filledAt: null });
    await this.recompute(order.cycleId, settings);
    return this.getState();
  }

  async updateOrder(id: string, dto: UpdateOrderDto) {
    const settings = await this.repo.getSettings();
    const order = await this.repo.getOrder(id);
    if (!order) throw new NotFoundException('Order not found');
    const data: Record<string, unknown> = {};
    if (dto.plannedPrice != null) data.plannedPrice = dto.plannedPrice;
    if (dto.fillPrice != null && order.status === 'FILLED') {
      data.fillPrice = dto.fillPrice;
      data.qty = (order.usdAmount! / dto.fillPrice) * (1 - settings.feePct / 100);
    } else if (dto.fillPrice != null) {
      data.fillPrice = dto.fillPrice;
    }
    await this.repo.updateOrder(id, data);
    await this.recompute(order.cycleId, settings);
    return this.getState();
  }

  async closeCycle(sellPrice: number) {
    const settings = await this.repo.getSettings();
    const cycle = await this.repo.getCurrentCycle(SYMBOL);
    if (!cycle || cycle.status !== 'IN_POSITION') throw new ConflictException('No open position to close');
    const orders = await this.repo.getOrdersByCycle(cycle.id);
    const filledBuys = orders.filter((o: any) => o.side === 'BUY' && o.status === 'FILLED');
    const capitalDeployed = filledBuys.reduce((a: number, o: any) => a + (o.usdAmount ?? 0), 0);
    const realizedPnl = computeRealizedPnl(cycle.positionSize!, cycle.avgCost!, sellPrice, capitalDeployed, settings.feePct);
    const sell = orders.find((o: any) => o.side === 'SELL');
    if (sell) await this.repo.updateOrder(sell.id, { status: 'FILLED', fillPrice: sellPrice, filledAt: new Date() });
    await this.repo.updateCycle(cycle.id, { status: 'CLOSED', realizedPnl, closedAt: new Date() });

    const closed = await this.repo.listClosedCycles(SYMBOL);
    const budget = computeBudget(settings.startCapital, closed.map((c: any) => c.realizedPnl ?? 0));
    const firstTierPct = await this.resolveFirstTierPct(settings);
    const next = await this.repo.createCycle({ symbol: SYMBOL, cycleNumber: cycle.cycleNumber + 1, status: 'FLAT', peak: sellPrice, budget });
    await this.armBuyTiers(next.id, sellPrice, budget, settings, firstTierPct);
    return this.getState();
  }

  async getState() {
    const settings = await this.repo.getSettings();
    const cycle = await this.ensureCycle(settings);
    const orders = await this.repo.getOrdersByCycle(cycle.id);
    let livePrice = 0;
    try { livePrice = await this.fetchLivePrice(); } catch (e) { this.logger.warn(`live price failed: ${String(e)}`); }
    let timingSignal: DcaTimingSignal | null = null;
    try { timingSignal = await this.fetchTimingSignal(livePrice); } catch (e) { this.logger.warn(`timing signal failed: ${String(e)}`); }
    const all = await this.repo.listAllCycles(SYMBOL);
    const closed = all.filter((c: any) => c.status === 'CLOSED');
    const realizedPnl = closed.reduce((a: number, c: any) => a + (c.realizedPnl ?? 0), 0);
    const fillsPerCycle = await Promise.all(
      closed.map(async (c: any) => (await this.repo.getOrdersByCycle(c.id)).filter((o: any) => o.side === 'BUY' && o.status === 'FILLED').length),
    );
    const avgFillsPerCycle = fillsPerCycle.length ? fillsPerCycle.reduce((a: number, b: number) => a + b, 0) / fillsPerCycle.length : 0;
    const unrealizedPnl = cycle.status === 'IN_POSITION' && cycle.positionSize && cycle.avgCost
      ? cycle.positionSize * (livePrice - cycle.avgCost)
      : 0;
    return {
      settings, cycle, orders, livePrice, timingSignal,
      summary: { cycleCount: all.length, avgFillsPerCycle, realizedPnl, unrealizedPnl },
    };
  }
}
