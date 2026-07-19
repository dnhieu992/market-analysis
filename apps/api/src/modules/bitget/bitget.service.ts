import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { summarizeBitgetClosed, type BitgetClosedSummary } from '@app/core';
import { createBitgetTradeRepository } from '@app/db';

import { BitgetTradeClient, type BitgetRawPosition } from './bitget-trade.client';

export type BitgetPosition = {
  symbol: string;
  holdSide: 'long' | 'short';
  marginMode: string;
  leverage: number;
  size: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number | null;
  breakEvenPrice: number | null;
  marginUsd: number;
  notionalUsd: number;
  unrealizedPnlUsd: number;
  /** Return on the margin actually committed (ROE %), the number the exchange shows. */
  roePct: number;
  realizedPnlUsd: number;
  /** When the position was opened (Bitget cTime). Anchors the trade-journal tradeKey. */
  openedAt: string | null;
  updatedAt: string | null;
};

export type BitgetPositionsResult = {
  configured: boolean;
  positions: BitgetPosition[];
  totalUnrealizedPnlUsd: number;
  totalMarginUsd: number;
  /** Total wallet equity (balance + unrealized PnL), USDT. Null if unavailable. */
  accountEquityUsd: number | null;
  fetchedAt: string;
};

export type BitgetClosedTrade = {
  positionId: string;
  /** Stable trade-session key — lets the history tab open the trade's journal. */
  tradeKey: string;
  status: 'closed';
  symbol: string;
  holdSide: 'long' | 'short';
  marginMode: string;
  openAvgPrice: number;
  closeAvgPrice: number;
  size: number;
  netProfit: number;
  /** Return on notional (netProfit ÷ entry notional), in %. */
  netProfitPct: number;
  totalFunding: number;
  feesUsd: number;
  openedAt: string;
  closedAt: string;
};

export type BitgetHistoryResult = {
  configured: boolean;
  trades: BitgetClosedTrade[];
  summary: BitgetClosedSummary;
  fetchedAt: string;
};

@Injectable()
export class BitgetService {
  private readonly logger = new Logger(BitgetService.name);
  private readonly client = new BitgetTradeClient();
  private readonly tradeRepo = createBitgetTradeRepository();

  async getOpenPositions(): Promise<BitgetPositionsResult> {
    const fetchedAt = new Date().toISOString();

    if (!this.client.isConfigured()) {
      return {
        configured: false,
        positions: [],
        totalUnrealizedPnlUsd: 0,
        totalMarginUsd: 0,
        accountEquityUsd: null,
        fetchedAt,
      };
    }

    let raw: BitgetRawPosition[] = [];
    try {
      raw = await this.client.getAllPositions();
    } catch (err) {
      this.logger.warn(`Failed to fetch Bitget positions: ${(err as Error).message}`);
      throw err;
    }

    // Wallet balance is non-fatal — a failure here shouldn't blank the positions table.
    const balance = await this.client.getAccountBalance().catch((err) => {
      this.logger.warn(`Failed to fetch Bitget account balance: ${(err as Error).message}`);
      return null;
    });

    const positions = raw
      .map((p) => this.mapPosition(p))
      .sort((a, b) => Math.abs(b.notionalUsd) - Math.abs(a.notionalUsd));

    const totalUnrealizedPnlUsd = positions.reduce((sum, p) => sum + p.unrealizedPnlUsd, 0);
    const totalMarginUsd = positions.reduce((sum, p) => sum + p.marginUsd, 0);

    return {
      configured: true,
      positions,
      totalUnrealizedPnlUsd,
      totalMarginUsd,
      accountEquityUsd: balance?.accountEquity ?? null,
      fetchedAt,
    };
  }

  /**
   * Closed-trade history + realized-PnL summary, read from the DB (the worker
   * mirrors Bitget's 90-day window into `bitget_closed_positions` on a cron).
   * `configured` reflects whether the same account credentials the worker syncs
   * with are present, so the page can explain an empty list.
   */
  async getClosedHistory(limit = 200, symbol?: string): Promise<BitgetHistoryResult> {
    const fetchedAt = new Date().toISOString();
    const rows = await this.tradeRepo.findRecentClosed(limit, symbol);

    const trades: BitgetClosedTrade[] = rows.map((r) => {
      const notional = Math.abs(r.openAvgPrice * r.openTotalPos);
      const netProfit = r.netProfit ?? 0;
      return {
        positionId: r.positionId ?? '',
        tradeKey: r.tradeKey,
        status: 'closed',
        symbol: r.symbol,
        holdSide: r.holdSide === 'short' ? 'short' : 'long',
        marginMode: r.marginMode,
        openAvgPrice: r.openAvgPrice,
        closeAvgPrice: r.closeAvgPrice ?? 0,
        size: r.openTotalPos,
        netProfit,
        netProfitPct: notional > 0 ? (netProfit / notional) * 100 : 0,
        totalFunding: r.totalFunding ?? 0,
        feesUsd: (r.openFee ?? 0) + (r.closeFee ?? 0),
        openedAt: r.openedAt.toISOString(),
        closedAt: (r.closedAt ?? r.openedAt).toISOString(),
      };
    });

    // summarizeBitgetClosed needs non-null netProfit — closed rows always have it.
    const summary = summarizeBitgetClosed(
      rows.map((r) => ({
        symbol: r.symbol,
        netProfit: r.netProfit ?? 0,
        openAvgPrice: r.openAvgPrice,
        openTotalPos: r.openTotalPos,
      })),
    );

    return { configured: this.client.isConfigured(), trades, summary, fetchedAt };
  }

  /**
   * Force-close a live position at market (reduce-only). Reads the current size
   * first so an already-flat side returns 409 (nothing to close) instead of a
   * confusing exchange error. Throws 503 when credentials are missing or the
   * exchange call fails — never report success while the position may be open.
   */
  async closePosition(
    symbol: string,
    holdSide: 'long' | 'short',
  ): Promise<{ closed: true; symbol: string; holdSide: 'long' | 'short' }> {
    if (!this.client.isConfigured()) {
      throw new ServiceUnavailableException('Bitget credentials not configured — cannot close a position');
    }
    try {
      const size = await this.client.getPositionSize(symbol, holdSide);
      if (size <= 0) {
        throw new ConflictException('Vị thế đã đóng trên sàn — không còn gì để đóng.');
      }
      await this.client.closePosition(symbol, holdSide);
      this.logger.log(`Force-closed Bitget position at market: ${symbol} ${holdSide} (size ${size})`);
      return { closed: true, symbol, holdSide };
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to force-close ${symbol} ${holdSide}: ${msg}`);
      throw new ServiceUnavailableException(`Không đóng được vị thế trên Bitget: ${msg}`);
    }
  }

  /**
   * Open a NEW market position in cross margin from the Setup tab. Sets leverage,
   * derives the base-asset size from the requested margin × leverage ÷ live price
   * (floored to the contract's precision), then places a market order with no
   * preset TP/SL — a deliberate manual entry. Rejects (409) if a position for the
   * same symbol+side is already open, so the button can't accidentally double up.
   */
  async openPosition(input: {
    symbol: string;
    holdSide: 'long' | 'short';
    marginUsd: number;
    leverage: number;
  }): Promise<{
    opened: true;
    symbol: string;
    holdSide: 'long' | 'short';
    size: number;
    entryPrice: number;
    leverage: number;
    marginUsd: number;
  }> {
    const { symbol, holdSide, marginUsd, leverage } = input;
    if (!this.client.isConfigured()) {
      throw new ServiceUnavailableException('Bitget credentials not configured — cannot open a position');
    }
    if (!(marginUsd > 0)) throw new BadRequestException('Ký quỹ phải lớn hơn 0.');
    if (!(leverage >= 1)) throw new BadRequestException('Đòn bẩy phải ≥ 1.');

    try {
      const existing = await this.client.getPositionSize(symbol, holdSide);
      if (existing > 0) {
        throw new ConflictException('Đã có vị thế mở cho coin này — không mở thêm.');
      }

      const [price, spec] = await Promise.all([
        this.client.getTickerPrice(symbol),
        this.client.getContractSpec(symbol),
      ]);

      // notional = margin × leverage; size (base asset) = notional ÷ price, floored
      // to the contract's volume precision so Bitget doesn't reject it.
      const rawSize = (marginUsd * leverage) / price;
      const factor = 10 ** spec.volumePlace;
      const size = Math.floor(rawSize * factor) / factor;
      if (size < spec.minTradeNum || size <= 0) {
        throw new BadRequestException(
          `Ký quỹ quá nhỏ: size ${size} < tối thiểu ${spec.minTradeNum} ${symbol}. Tăng ký quỹ hoặc đòn bẩy.`,
        );
      }

      await this.client.setCrossLeverage(symbol, leverage);
      const clientOid = `manual-${symbol}-${holdSide}-${Date.now()}`;
      await this.client.openMarketPosition({
        symbol,
        holdSide,
        size: size.toFixed(spec.volumePlace),
        clientOid,
      });
      this.logger.log(
        `Opened Bitget market position: ${holdSide} ${symbol} size ${size} @~${price} ` +
          `(margin $${marginUsd}, ${leverage}x cross)`,
      );
      return { opened: true, symbol, holdSide, size, entryPrice: price, leverage, marginUsd };
    } catch (err) {
      if (
        err instanceof ConflictException ||
        err instanceof BadRequestException ||
        err instanceof ServiceUnavailableException
      ) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to open ${holdSide} ${symbol}: ${msg}`);
      throw new ServiceUnavailableException(`Không mở được vị thế trên Bitget: ${msg}`);
    }
  }

  private mapPosition(p: BitgetRawPosition): BitgetPosition {
    const size = Number(p.total);
    const entryPrice = Number(p.openPriceAvg);
    const markPrice = Number(p.markPrice);
    const marginUsd = Number(p.marginSize);
    const unrealizedPnlUsd = Number(p.unrealizedPL);
    const leverage = Number(p.leverage);
    const liquidationPrice = Number(p.liquidationPrice);
    const breakEvenPrice = Number(p.breakEvenPrice);

    return {
      symbol: p.symbol,
      holdSide: p.holdSide,
      marginMode: p.marginMode,
      leverage: Number.isFinite(leverage) ? leverage : 0,
      size,
      entryPrice,
      markPrice,
      liquidationPrice: Number.isFinite(liquidationPrice) && liquidationPrice > 0 ? liquidationPrice : null,
      breakEvenPrice: Number.isFinite(breakEvenPrice) && breakEvenPrice > 0 ? breakEvenPrice : null,
      marginUsd,
      notionalUsd: size * markPrice,
      unrealizedPnlUsd,
      roePct: marginUsd > 0 ? (unrealizedPnlUsd / marginUsd) * 100 : 0,
      realizedPnlUsd: Number(p.achievedProfits),
      openedAt: p.cTime ? new Date(Number(p.cTime)).toISOString() : null,
      updatedAt: p.uTime ? new Date(Number(p.uTime)).toISOString() : null,
    };
  }
}
