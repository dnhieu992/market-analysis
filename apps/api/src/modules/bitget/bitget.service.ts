import { Injectable, Logger } from '@nestjs/common';

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

@Injectable()
export class BitgetService {
  private readonly logger = new Logger(BitgetService.name);
  private readonly client = new BitgetTradeClient();

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
