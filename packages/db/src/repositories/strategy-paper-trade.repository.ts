import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export const STRATEGY_PAPER_TRADE_OPEN_STATUS = 'OPEN';

/** Seed text for the editable "Chi tiết chiến lược" dialog — plain Vietnamese, bullet points. */
export const DEFAULT_STRATEGY_DOC = `## Chiến lược: Phá đỉnh/đáy của ngày hôm trước (BTC, khung 1 giờ)

**Ý tưởng**
- Mỗi ngày giá có một đỉnh và một đáy mà cả thị trường đều nhìn thấy.
- Giá **vượt lên trên đỉnh hôm qua** → phe mua thắng → thường chạy tiếp lên → **vào lệnh mua**.
- Giá **rơi xuống dưới đáy hôm qua** → phe bán thắng → thường chạy tiếp xuống → **vào lệnh bán**.
- Không đoán đỉnh đáy, chỉ đi theo cú phá vỡ khi nó thật sự xảy ra.

**Cách chạy (máy tự động, mỗi giờ một lần)**
- Đánh dấu **đỉnh cao nhất** và **đáy thấp nhất của ngày hôm qua** (tính theo giờ quốc tế, tức mốc 7 giờ sáng Việt Nam).
- Xem nến **1 giờ vừa đóng cửa**:
  - Đóng cửa **cao hơn đỉnh hôm qua** → mở **lệnh mua**.
  - Đóng cửa **thấp hơn đáy hôm qua** → mở **lệnh bán**.
- Mỗi chiều chỉ vào **1 lần trong ngày**, và mỗi lúc chỉ giữ **1 lệnh**.

**Quản lý lệnh**
- **Cắt lỗ**: đặt ở **phía đối diện của biên ngày hôm qua**, cộng một khoảng đệm nhỏ:
  - Lệnh mua (phá đỉnh) → cắt lỗ **dưới đáy của ngày hôm qua**.
  - Lệnh bán (phá đáy) → cắt lỗ **trên đỉnh của ngày hôm qua**.
  - (Đây là kiểu dừng lỗ rộng — chấp nhận cả biên ngày hôm qua làm rủi ro; chính cấu hình này cho kết quả tốt nhất khi backtest.)
- **Chốt lời**: đặt cách điểm vào **gấp 2 lần khoảng rủi ro** (lời gấp đôi mức chấp nhận mất).
- **Đóng cuối ngày**: hết ngày mà chưa chạm chốt lời/cắt lỗ thì **đóng luôn** — không giữ lệnh qua đêm.

**Vốn**
- Mỗi lệnh chỉ đặt cược một số tiền cố định nhỏ (mặc định 10 đô). Khối lượng tính ngược từ khoảng cắt lỗ.

**Lưu ý**
- Đây là backtest chạy giả, **không nối sàn thật**.
- Lợi thế mỏng (cứ 100 đồng rủi ro lãi trung bình ~16 đồng), sẽ có chuỗi thua — vào lệnh nhỏ, coi là công cụ timing.
`;

/** Config row id of the original PDH/PDL breakout strategy. */
export const PDHL_STRATEGY_ID = 'pdhl-btc';

export type StrategyPaperTradeInput = Pick<
  Prisma.StrategyPaperTradeUncheckedCreateInput,
  | 'strategyId'
  | 'symbol'
  | 'timeframe'
  | 'tradeDate'
  | 'direction'
  | 'pdh'
  | 'pdl'
  | 'signalClose'
  | 'entryPrice'
  | 'initialStopLoss'
  | 'stopLoss'
  | 'takeProfit'
  | 'riskUsd'
  | 'quantity'
  | 'rrPlanned'
  | 'openedAt'
  | 'lastPrice'
  | 'lastCheckedAt'
>;

export function createStrategyPaperTradeRepository(client = prisma) {
  return {
    create(data: StrategyPaperTradeInput) {
      return client.strategyPaperTrade.create({ data });
    },

    findById(id: string) {
      return client.strategyPaperTrade.findUnique({ where: { id } });
    },

    /** OPEN trades — of one strategy when `strategyId` is given, otherwise of all. */
    findOpen(strategyId?: string) {
      return client.strategyPaperTrade.findMany({
        where: { status: STRATEGY_PAPER_TRADE_OPEN_STATUS, ...(strategyId ? { strategyId } : {}) },
        orderBy: { openedAt: 'asc' },
      });
    },

    /** Has this strategy already taken this side on this UTC day? (PDH/PDL dedupe guard) */
    findByDateDirection(strategyId: string, tradeDate: string, direction: string) {
      return client.strategyPaperTrade.findFirst({ where: { strategyId, tradeDate, direction } });
    },

    /** The most recently closed trade of a strategy — a new entry must come after its exit. */
    findLastClosed(strategyId: string) {
      return client.strategyPaperTrade.findFirst({
        where: { strategyId, status: { not: STRATEGY_PAPER_TRADE_OPEN_STATUS } },
        orderBy: { closedAt: 'desc' },
      });
    },

    /** Newest first — the page reads the whole history, it stays small. */
    list(limit = 1000) {
      return client.strategyPaperTrade.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    },

    update(id: string, data: Prisma.StrategyPaperTradeUncheckedUpdateInput) {
      return client.strategyPaperTrade.update({ where: { id }, data });
    },

    /** A strategy's config row, created from `defaults` on first read. */
    async getConfig(
      id = PDHL_STRATEGY_ID,
      defaults: Partial<Prisma.StrategyPaperConfigUncheckedCreateInput> = {},
    ) {
      const existing = await client.strategyPaperConfig.findUnique({ where: { id } });
      if (existing) return existing;
      return client.strategyPaperConfig.create({ data: { docMarkdown: DEFAULT_STRATEGY_DOC, ...defaults, id } });
    },

    updateConfig(id: string, data: Record<string, unknown>) {
      return client.strategyPaperConfig.upsert({
        where: { id },
        create: { id, docMarkdown: DEFAULT_STRATEGY_DOC, ...data } as Prisma.StrategyPaperConfigUncheckedCreateInput,
        update: data as Prisma.StrategyPaperConfigUncheckedUpdateInput,
      });
    },
  };
}
