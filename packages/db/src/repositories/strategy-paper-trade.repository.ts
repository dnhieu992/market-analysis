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

export type StrategyPaperTradeInput = Pick<
  Prisma.StrategyPaperTradeUncheckedCreateInput,
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

    /** All currently OPEN trades (engine keeps ≤1 in practice, but return the list). */
    findOpen() {
      return client.strategyPaperTrade.findMany({
        where: { status: STRATEGY_PAPER_TRADE_OPEN_STATUS },
        orderBy: { openedAt: 'asc' },
      });
    },

    /** Has this side already been taken for this UTC day? (dedupe guard) */
    findByDateDirection(tradeDate: string, direction: string) {
      return client.strategyPaperTrade.findUnique({
        where: { tradeDate_direction: { tradeDate, direction } },
      });
    },

    /** Newest first — the page reads the whole history, it stays small. */
    list(limit = 300) {
      return client.strategyPaperTrade.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    },

    update(id: string, data: Prisma.StrategyPaperTradeUncheckedUpdateInput) {
      return client.strategyPaperTrade.update({ where: { id }, data });
    },

    /** The singleton config row, created with the default doc on first read. */
    async getConfig(defaultDoc = DEFAULT_STRATEGY_DOC) {
      const id = 'pdhl-btc';
      const existing = await client.strategyPaperConfig.findUnique({ where: { id } });
      if (existing) return existing;
      return client.strategyPaperConfig.create({ data: { id, docMarkdown: defaultDoc } });
    },

    updateConfig(data: Record<string, unknown>) {
      return client.strategyPaperConfig.upsert({
        where: { id: 'pdhl-btc' },
        create: { id: 'pdhl-btc', docMarkdown: DEFAULT_STRATEGY_DOC, ...data } as Prisma.StrategyPaperConfigUncheckedCreateInput,
        update: data as Prisma.StrategyPaperConfigUncheckedUpdateInput,
      });
    },
  };
}
