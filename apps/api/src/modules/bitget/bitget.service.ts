import { Injectable, Logger } from '@nestjs/common';
import { summarizeBitgetClosed, type BitgetClosedSummary } from '@app/core';
import { createBitgetClosedPositionRepository } from '@app/db';

import { BitgetTradeClient, type BitgetRawPosition } from '../day-trading/bitget-trade.client';

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
  updatedAt: string | null;
};

export type BitgetPositionsResult = {
  configured: boolean;
  positions: BitgetPosition[];
  totalUnrealizedPnlUsd: number;
  totalMarginUsd: number;
  fetchedAt: string;
};

export type BitgetClosedTrade = {
  positionId: string;
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
  private readonly closedRepo = createBitgetClosedPositionRepository();

  async getOpenPositions(): Promise<BitgetPositionsResult> {
    const fetchedAt = new Date().toISOString();

    if (!this.client.isConfigured()) {
      return {
        configured: false,
        positions: [],
        totalUnrealizedPnlUsd: 0,
        totalMarginUsd: 0,
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
    const rows = await this.closedRepo.findRecent(limit, symbol);

    const trades: BitgetClosedTrade[] = rows.map((r) => {
      const notional = Math.abs(r.openAvgPrice * r.openTotalPos);
      return {
        positionId: r.positionId,
        symbol: r.symbol,
        holdSide: r.holdSide === 'short' ? 'short' : 'long',
        marginMode: r.marginMode,
        openAvgPrice: r.openAvgPrice,
        closeAvgPrice: r.closeAvgPrice,
        size: r.openTotalPos,
        netProfit: r.netProfit,
        netProfitPct: notional > 0 ? (r.netProfit / notional) * 100 : 0,
        totalFunding: r.totalFunding,
        feesUsd: r.openFee + r.closeFee,
        openedAt: r.openedAt.toISOString(),
        closedAt: r.closedAt.toISOString(),
      };
    });

    return {
      configured: this.client.isConfigured(),
      trades,
      summary: summarizeBitgetClosed(rows),
      fetchedAt,
    };
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
      updatedAt: p.uTime ? new Date(Number(p.uTime)).toISOString() : null,
    };
  }
}
