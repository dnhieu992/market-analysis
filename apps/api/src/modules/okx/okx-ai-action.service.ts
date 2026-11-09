import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createOkxAiActionRepository, createOrderJournalRepository, createOrderRepository } from '@app/db';

import { OKX_DEFAULT_MARGIN_USD, OKX_FIXED_LEVERAGE, OkxService, type OkxPosition } from './okx.service';
import type { ExecuteAiActionDto } from './dto/execute-ai-action.dto';

export type OkxAiActionType = 'OPEN' | 'DCA' | 'SET_TP' | 'CLOSE' | 'CANCEL';
type Side = 'long' | 'short';

export type OkxAiActionParams = {
  orderType?: 'MARKET' | 'LIMIT';
  price?: number | null;
  marginUsd?: number;
  leverage?: number;
  takeProfitPrice?: number | null;
  closePct?: number;
  orderId?: string;
  refPrice?: number | null;
};

function fmt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  return v.toLocaleString('en-US', { maximumFractionDigits: abs >= 1000 ? 2 : abs >= 1 ? 4 : 8 });
}

/**
 * Runs the cards the /trades OKX AI chat proposes — ONLY on the user's confirm. LONG and
 * SHORT (long allowed since 2026-11-09). New positions are always cross × OKX_FIXED_LEVERAGE;
 * margin defaults to OKX_DEFAULT_MARGIN_USD. Each executed card is noted on the matching
 * open OKX order of /trades (order journal) when the worker has synced it.
 */
@Injectable()
export class OkxAiActionService {
  private readonly logger = new Logger(OkxAiActionService.name);
  private readonly repo = createOkxAiActionRepository();
  private readonly orders = createOrderRepository();
  private readonly journal = createOrderJournalRepository();

  constructor(private readonly okx: OkxService) {}

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
    const side = action.holdSide as Side;
    if (side !== 'long' && side !== 'short') throw new BadRequestException(`Chiều lệnh không hợp lệ: ${String(action.holdSide)}`);

    const type = action.type as OkxAiActionType;
    const params: OkxAiActionParams = { ...(action.params as OkxAiActionParams), ...stripUndefined(edits) };
    try {
      const before = await this.okx.getPosition(action.symbol, side);
      const { result, orderId, lines } = await this.run(type, action.symbol, side, params, before);
      await this.noteOnOrder(action.symbol, side, [`🤖 **Từ AI chat (OKX ${side})** — ${lines[0]}`, ...lines.slice(1), ...(action.reason ? [`- Lý do AI: ${action.reason}`] : [])].join('\n'), before);
      this.logger.log(`OKX AI action ${id} executed: ${type} ${side} ${action.symbol}`);
      return this.repo.update(id, { status: 'EXECUTED', executedParams: params, result: result as object, orderId, error: null, decidedAt: new Date() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`OKX AI action ${id} (${type} ${side} ${action.symbol}) failed: ${msg}`);
      return this.repo.update(id, { status: 'FAILED', executedParams: params, error: msg, decidedAt: new Date() });
    }
  }

  private async run(
    type: OkxAiActionType,
    symbol: string,
    side: Side,
    p: OkxAiActionParams,
    before: OkxPosition | null,
  ): Promise<{ result: unknown; orderId: string | null; lines: string[] }> {
    const SIDE = side.toUpperCase();
    switch (type) {
      case 'OPEN':
      case 'DCA': {
        if (type === 'DCA' && !before) throw new ConflictException(`Không có vị thế ${SIDE} ${symbol} để DCA.`);
        const marginUsd = Number(p.marginUsd) > 0 ? Number(p.marginUsd) : OKX_DEFAULT_MARGIN_USD;
        // Fixed config: a new position is always cross × OKX_FIXED_LEVERAGE; an open one keeps its own.
        const leverage = before ? before.leverage : OKX_FIXED_LEVERAGE;
        p.marginUsd = marginUsd;
        p.leverage = leverage;
        const orderType = p.orderType === 'LIMIT' ? 'LIMIT' : 'MARKET';
        const tp = p.takeProfitPrice != null && p.takeProfitPrice > 0 ? p.takeProfitPrice : null;
        // An open position keeps one position-level TP: move it instead of attaching a second one.
        const attachTp = tp != null && !before;
        const res = await this.okx.placeOrder({
          symbol,
          holdSide: side,
          orderType,
          marginUsd,
          leverage,
          price: p.price,
          takeProfitPrice: attachTp ? tp : null,
          keepLeverage: !!before,
        });
        let tpNote = tp != null ? fmt(tp) : 'chưa đặt';
        if (tp != null && before) {
          if (orderType === 'MARKET') {
            try {
              await this.okx.setTakeProfit(symbol, side, tp);
            } catch (e) {
              tpNote = `LỖI đặt TP ${fmt(tp)}: ${e instanceof Error ? e.message : String(e)}`;
            }
          } else {
            tpNote = `${fmt(tp)} (chưa đổi — dời TP bằng thẻ SET_TP sau khi lệnh limit khớp)`;
          }
        }
        const label = type === 'DCA' ? 'DCA' : before ? 'Thêm vào lệnh' : 'Mở lệnh';
        const lines = [
          `${label} ${orderType} ${SIDE} ${symbol}`,
          `- ${orderType === 'LIMIT' ? `Giá limit ${fmt(res.refPrice)}` : `~${fmt(res.refPrice)}`} · ${res.contracts} hợp đồng (${fmt(res.size)} coin) · ký quỹ $${fmt(marginUsd)} · ${res.leverage}× cross`,
          `- TP: ${tpNote}`,
        ];
        if (before) lines.push(`- Vị thế trước: ${fmt(before.size)} @ ${fmt(before.entryPrice)}`);
        return { result: { ...res, takeProfitNote: tpNote }, orderId: res.orderId || null, lines };
      }
      case 'SET_TP': {
        if (!before) throw new ConflictException(`Không có vị thế ${SIDE} ${symbol}.`);
        const tp = p.takeProfitPrice != null && p.takeProfitPrice > 0 ? p.takeProfitPrice : null;
        const res = await this.okx.setTakeProfit(symbol, side, tp);
        return { result: res, orderId: null, lines: [`${tp != null ? 'Đặt' : 'Xoá'} TP ${SIDE} ${symbol}`, `- TP: ${fmt(res.prevTp)} → ${tp != null ? fmt(tp) : 'không TP'}`] };
      }
      case 'CLOSE': {
        const pct = Math.min(100, Math.max(1, Number(p.closePct ?? 100)));
        const res = await this.okx.closePosition(symbol, side, pct);
        return {
          result: res,
          orderId: res.orderId,
          lines: [`Đóng ${pct}% ${SIDE} ${symbol}`, `- Đóng ${res.closedContracts} hợp đồng @~${fmt(res.markPrice)} · còn ${res.remainingContracts}`],
        };
      }
      case 'CANCEL': {
        if (!p.orderId) throw new BadRequestException('Thiếu orderId của lệnh chờ.');
        const res = await this.okx.cancelOrder(symbol, p.orderId);
        return { result: res, orderId: p.orderId, lines: [`Huỷ lệnh chờ ${SIDE} ${symbol}`, `- orderId ${p.orderId}`] };
      }
      default:
        throw new BadRequestException(`Loại đề xuất không hỗ trợ: ${String(type)}`);
    }
  }

  /** Journal note on the open OKX position of /trades — skipped when the sync has not created it yet. */
  private async noteOnOrder(symbol: string, side: Side, content: string, before: OkxPosition | null) {
    try {
      const open = (await this.orders.listOpenBySource('okx')).find((o) => o.symbol === symbol && o.side === side);
      if (!open) return;
      await this.journal.create({
        orderId: open.id,
        content,
        snapshot: before ? { price: before.markPrice, entryPrice: before.entryPrice, pnlUsd: before.unrealizedPnlUsd } : null,
      });
    } catch (e) {
      this.logger.warn(`OKX AI journal note failed for ${symbol}: ${(e as Error).message}`);
    }
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
