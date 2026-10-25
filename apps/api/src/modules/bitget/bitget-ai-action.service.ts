import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { averageEntry } from '@app/core';
import { createBitgetAiActionRepository } from '@app/db';

import { BitgetService } from './bitget.service';
import type { ExecuteAiActionDto } from './dto/execute-ai-action.dto';

export type BitgetAiActionType = 'OPEN' | 'DCA' | 'SET_TP' | 'CLOSE' | 'CANCEL';

/** What a card carries. Claude fills it in; the confirm dialog may override any field. */
export type BitgetAiActionParams = {
  orderType?: 'MARKET' | 'LIMIT';
  price?: number | null;
  marginUsd?: number;
  leverage?: number;
  takeProfitPrice?: number | null;
  closePct?: number;
  orderId?: string;
  /** Market price when Claude proposed the card (display only). */
  refPrice?: number | null;
};

const SIDE = (s: string) => (s === 'short' ? 'SHORT' : 'LONG');

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  return n.toLocaleString('en-US', { maximumFractionDigits: abs >= 1000 ? 2 : abs >= 1 ? 4 : 8 });
}

/**
 * Runs the action cards the /bitget AI chat proposes — ONLY when the user presses
 * confirm on a card. Real orders on the live account, take-profit only: no code
 * path here ever sets a stop-loss (an existing SL the trader set by hand is kept
 * as is when the TP changes). Each executed card is logged to the position's
 * journal as "từ AI chat".
 */
@Injectable()
export class BitgetAiActionService {
  private readonly logger = new Logger(BitgetAiActionService.name);
  private readonly repo = createBitgetAiActionRepository();

  constructor(private readonly bitget: BitgetService) {}

  list(conversationId: string) {
    return this.repo.listByConversation(conversationId);
  }

  async dismiss(id: string) {
    const action = await this.repo.findById(id);
    if (!action) throw new NotFoundException('Không tìm thấy đề xuất.');
    if (action.status === 'EXECUTED') throw new ConflictException('Đề xuất đã được thực hiện.');
    return this.repo.update(id, { status: 'DISMISSED', decidedAt: new Date() });
  }

  async execute(id: string, edits: ExecuteAiActionDto) {
    const action = await this.repo.findById(id);
    if (!action) throw new NotFoundException('Không tìm thấy đề xuất.');
    if (action.status === 'EXECUTED') throw new ConflictException('Đề xuất đã được thực hiện.');
    if (action.status === 'DISMISSED') throw new ConflictException('Đề xuất đã bị bỏ qua.');

    const symbol = action.symbol;
    const holdSide = action.holdSide === 'short' ? 'short' : 'long';
    const type = action.type as BitgetAiActionType;
    const params: BitgetAiActionParams = { ...(action.params as BitgetAiActionParams), ...stripUndefined(edits) };

    try {
      const before = await this.bitget.getRawPosition(symbol, holdSide);
      const { result, orderId, journal } = await this.run(type, symbol, holdSide, params, before);

      // Journal the action on the position's timeline (the position as it is now,
      // or as it was before a full close).
      const after = (await this.bitget.getRawPosition(symbol, holdSide).catch(() => null)) ?? before;
      if (after && journal.length) {
        await this.bitget.logToJournal(
          after,
          [`🤖 **Từ AI chat** — ${journal[0]}`, ...journal.slice(1), ...(action.reason ? [`- Lý do AI: ${action.reason}`] : [])].join('\n'),
        );
      }

      this.logger.log(`AI action ${id} executed: ${type} ${holdSide} ${symbol}`);
      return this.repo.update(id, {
        status: 'EXECUTED',
        executedParams: params,
        result: result as object,
        orderId,
        error: null,
        decidedAt: new Date(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`AI action ${id} (${type} ${holdSide} ${symbol}) failed: ${msg}`);
      return this.repo.update(id, { status: 'FAILED', executedParams: params, error: msg, decidedAt: new Date() });
    }
  }

  private async run(
    type: BitgetAiActionType,
    symbol: string,
    holdSide: 'long' | 'short',
    p: BitgetAiActionParams,
    before: Awaited<ReturnType<BitgetService['getRawPosition']>>,
  ): Promise<{ result: unknown; orderId: string | null; journal: string[] }> {
    switch (type) {
      case 'OPEN':
      case 'DCA': {
        if (type === 'DCA' && !before) throw new ConflictException(`Không có vị thế ${SIDE(holdSide)} ${symbol} để DCA.`);
        const marginUsd = Number(p.marginUsd);
        const leverage = Number(p.leverage);
        const tp = p.takeProfitPrice != null && p.takeProfitPrice > 0 ? p.takeProfitPrice : null;
        const label = type === 'DCA' ? 'DCA' : before ? 'Thêm vào lệnh' : 'Mở lệnh';

        if (p.orderType === 'LIMIT') {
          if (!(Number(p.price) > 0)) throw new BadRequestException('Thiếu giá limit.');
          const res = await this.bitget.placeLimitOrder({ symbol, holdSide, marginUsd, leverage, price: Number(p.price), takeProfitPrice: tp });
          const lines = [
            `${label} LIMIT ${SIDE(holdSide)} ${symbol}`,
            `- Giá limit: ${fmt(res.price)} · size ${fmt(res.size)} · ký quỹ $${fmt(marginUsd)} · ${res.leverage}× cross`,
            `- TP: ${res.takeProfitPrice != null ? fmt(res.takeProfitPrice) : tp != null ? `${fmt(tp)} (đặt sau khi khớp — vị thế đang mở)` : 'chưa đặt'} · không SL`,
          ];
          if (before) {
            const avg = averageEntry(Number(before.total), Number(before.openPriceAvg), res.size, res.price);
            lines.push(`- Giá TB dự kiến nếu khớp: ${fmt(Number(before.openPriceAvg))} → ${fmt(avg)}`);
          }
          return { result: res, orderId: res.orderId, journal: lines };
        }

        const res = await this.bitget.openPosition({ symbol, holdSide, marginUsd, leverage });
        let tpNote = 'chưa đặt';
        if (tp != null) {
          // Position TP on the exchange; keep any SL the trader set by hand (this flow never sets one).
          const [, liveSl] = await this.bitget.getLiveTpsl(symbol, holdSide);
          try {
            await this.bitget.setTpsl({ symbol, holdSide, takeProfitPrice: tp, stopLossPrice: liveSl });
            tpNote = fmt(tp);
          } catch (e) {
            tpNote = `LỖI đặt TP ${fmt(tp)}: ${e instanceof Error ? e.message : String(e)}`;
          }
        }
        const lines = [
          `${label} MARKET ${SIDE(holdSide)} ${symbol}`,
          `- Size ${fmt(res.size)} @~${fmt(res.entryPrice)} · ký quỹ $${fmt(marginUsd)} · ${res.leverage}× cross`,
          `- TP: ${tpNote} · không SL`,
        ];
        if (before) lines.push(`- Size: ${fmt(Number(before.total))} → ${fmt(res.totalSize)} · giá TB trước: ${fmt(Number(before.openPriceAvg))}`);
        return { result: { ...res, takeProfitNote: tpNote }, orderId: null, journal: lines };
      }

      case 'SET_TP': {
        if (!before) throw new ConflictException(`Không có vị thế ${SIDE(holdSide)} ${symbol}.`);
        const tp = p.takeProfitPrice != null && p.takeProfitPrice > 0 ? p.takeProfitPrice : null;
        const [prevTp, liveSl] = await this.bitget.getLiveTpsl(symbol, holdSide);
        const res = await this.bitget.setTpsl({ symbol, holdSide, takeProfitPrice: tp, stopLossPrice: liveSl });
        return {
          result: res,
          orderId: null,
          journal: [`${tp != null ? 'Đặt' : 'Xoá'} TP ${SIDE(holdSide)} ${symbol}`, `- TP: ${fmt(prevTp)} → ${tp != null ? fmt(tp) : 'không TP'}`],
        };
      }

      case 'CLOSE': {
        const pct = Math.min(100, Math.max(0, Number(p.closePct ?? 100)));
        const res = await this.bitget.closePartial({ symbol, holdSide, pct });
        return {
          result: res,
          orderId: res.orderId,
          journal: [
            `Đóng ${res.pct}% ${SIDE(holdSide)} ${symbol}`,
            `- Đóng ${fmt(res.size)} @~${fmt(res.markPrice)} · còn lại ${fmt(res.remainingSize)}`,
          ],
        };
      }

      case 'CANCEL': {
        if (!p.orderId) throw new BadRequestException('Thiếu orderId của lệnh chờ.');
        const res = await this.bitget.cancelLimitOrder({ symbol, orderId: p.orderId });
        return { result: res, orderId: p.orderId, journal: [`Huỷ lệnh chờ ${SIDE(holdSide)} ${symbol}`, `- orderId ${p.orderId}`] };
      }

      default:
        throw new BadRequestException(`Loại đề xuất không hỗ trợ: ${String(type)}`);
    }
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
