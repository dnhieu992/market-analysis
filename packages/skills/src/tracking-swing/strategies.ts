/**
 * Spot Analytic strategies. One source of truth for both the chat skill (the ACTIVE strategy's rules
 * are injected into the system prompt) and the "Chiến lược" reference dialog on /tracking-coins
 * (served by GET /tracking-coins/strategies). Add new strategies as new entries (B, C…); switch the
 * chat to another one by changing ACTIVE_SPOT_STRATEGY.
 */
export type SpotStrategy = {
  id: string;
  name: string;
  status: 'active' | 'draft' | 'retired';
  createdAt: string; // YYYY-MM-DD
  /** One line: what the strategy trades and how. */
  summary: string;
  /** Yearly return the user should expect (from the backtest, conservative). */
  target: string;
  /** Rule groups, in the order the trader applies them. */
  rules: Array<{ title: string; items: string[] }>;
  /** Backtest headline numbers (portfolio simulation). */
  backtest: {
    period: string;
    universe: string;
    method: string;
    rows: Array<{ config: string; cagr: string; maxDd: string; note?: string }>;
    takeaways: string[];
  };
  /** What the strategy was learned from (market episodes, studies). */
  lessons: string[];
  limits: string[];
  /** Reports in the repo the numbers come from. */
  sources: string[];
};

export const SPOT_STRATEGIES: SpotStrategy[] = [
  {
    id: 'A',
    name: 'Chiến lược A — Alt quá bán theo độ rộng thị trường',
    status: 'active',
    createdAt: '2026-11-07',
    summary:
      'Mua spot altcoin thanh khoản cao khi RSI tuần < 35, chỉ mở lệnh khi nhiều alt cùng bị bán quá đà (breadth), DCA 3 phần, chốt +30% từ giá TB, không stoploss.',
    target: '15–25%/năm trên vốn spot alt; chấp nhận sụt giảm tạm thời −35% đến −50%. Mỗi lệnh +30%, ~15–20 lệnh/năm.',
    rules: [
      {
        title: '1. Chế độ thị trường (breadth)',
        items: [
          'Breadth = % TOÀN BỘ alt USDT trên Binance (niêm yết ≥ ~200 ngày, bỏ BTC/ETH/stable) có RSI tuần < 35 — đúng cách đã backtest; tool get_tracking_coins tính sẵn ở dòng đầu.',
          'Breadth ≥ 25% → MÙA MUA: mở lệnh bình thường.',
          'Breadth 10–25% → chỉ mua coin top 50 theo volume.',
          'Breadth < 10% → không mở lệnh mới, chỉ giữ và chờ TP (vùng này ~19% lệnh bị kẹt).',
        ],
      },
      {
        title: '2. Chọn coin',
        items: [
          'RSI tuần (nến tuần đã đóng) < 35, niêm yết ≥ 1 năm, nằm trong top 100 alt theo volume.',
          'Nhiều coin đạt điều kiện → ưu tiên coin có RSI tuần thấp nhất (bị bán quá đà nhất).',
          'Ưu tiên L1 / L2 / Infra; tránh fan token, Seed, coin BSC vốn hoá nhỏ.',
          'Không mua coin đã tăng nóng (RSI D1 > 70 hoặc +30–40% trong 30 ngày).',
        ],
      },
      {
        title: '3. Vốn và thang mua',
        items: [
          'Chia vốn spot alt thành 8–12 phần; mỗi coin tối đa 1 phần (~8–12% vốn).',
          'Mỗi phần chia 3 lệnh: 30% tại giá vào, 30% tại −15%, 40% tại −35% so với lệnh đầu.',
        ],
      },
      {
        title: '4. Thoát lệnh',
        items: [
          'TP = giá trung bình × 1.30 (có thể làm tròn sát dưới kháng cự gần nhất).',
          'Không stoploss, không cắt theo thời gian (backtest: cắt 180/365 ngày không cải thiện).',
          'Coin bị đưa vào Monitoring / có tin huỷ niêm yết → báo người dùng tự quyết.',
        ],
      },
      {
        title: '5. Thông số tham khảo (không dùng làm điều kiện)',
        items: [
          'F&G: không thêm edge so với RSI tuần — chỉ để mô tả tâm lý.',
          'USDT.D, TOTAL2/TOTAL3, nến tuần BTC: chưa có dữ liệu lịch sử để kiểm chứng — dùng làm bối cảnh.',
        ],
      },
    ],
    backtest: {
      period: '2022-01 → 2026-11 (nến ngày)',
      universe: '562 alt USDT Binance (379 còn sống + 183 đã huỷ niêm yết), bỏ BTC/ETH/stable',
      method: '8 phần vốn, thang 30/30/40, TP = TB × 1.3, không SL, phí 0.1%/chiều; 10 lần chạy chọn coin ngẫu nhiên, lấy trung vị',
      rows: [
        { config: 'Mua alt ngẫu nhiên (đối chứng)', cagr: '−17%', maxDd: '−70%' },
        { config: 'Alt ngẫu nhiên, chỉ khi breadth ≥ 25%', cagr: '+5–8%', maxDd: '−48%' },
        { config: 'Top 50, RSI tuần < 35', cagr: '+20% (15–22)', maxDd: '−35%' },
        { config: 'Top 100, RSI tuần < 35, không lọc breadth', cagr: '+8%', maxDd: '−49%' },
        { config: 'Top 100, RSI tuần < 35, breadth ≥ 25%', cagr: '+22% (11–27)', maxDd: '−49%' },
        { config: 'Như trên, ưu tiên RSI tuần thấp nhất', cagr: '+31%', maxDd: '−43%', note: '1 lần chạy (không ngẫu nhiên); top 30 không cải thiện' },
      ],
      takeaways: [
        'Lọc breadth biến "mua alt bất kỳ" từ lỗ thành có lãi; vũ trụ càng rộng càng cần lọc.',
        '91–99% lệnh chạm TP; giữ trung vị 25–45 ngày, p90 ~6 tháng.',
        'Thang 0/−15/−35 nhỉnh hơn 0/−15/−30; TP 20–40% gần như nhau, TP 50% kém hẳn.',
        '8–12 phần vốn tốt nhất; 5 phần drawdown sâu hơn.',
      ],
    },
    lessons: [
      'Đợt pump 8–10/2026: breadth 63–77% (tháng 2–4) → 41% (15/08) → 4% (01/10). Alt trung vị +21% từ đáy 17/08 tới đỉnh 26/09; 88% alt chạm +30% tính từ 15/08.',
      'Lệnh mua sẵn từ tháng 5–8 (chịu drawdown, DCA đủ 3 phần) chốt +30% trong tháng 9; lệnh mở sau pump (breadth < 25%) là lệnh kẹt hiện tại (XPL, TRUMP, ZKC, SAHARA).',
      'Coin tăng mạnh nhất bị bán quá đà hơn trước pump (RSI tuần 35.6 vs 40.3; −32% vs −21% trong 90 ngày). L1/L2/Infra/Storage tăng tốt.',
    ],
    limits: [
      'Chỉ một giai đoạn 2022–2026 (alt giảm dài hạn); kết quả nhạy với cách chọn coin.',
      'Lọc theo nhóm (L1/L2/Infra, tránh fan token) rút ra từ đợt pump, chưa backtest.',
      'Không stoploss → có lệnh kẹt nhiều tháng; vốn nằm không ~55% thời gian.',
    ],
    sources: [
      'claude-backtest/runs/2026-11-07-spot-alt-pump-regime.md',
      'claude-backtest/runs/2026-11-07-spot-30pct-strategy-scan.md',
    ],
  },
];

export const ACTIVE_SPOT_STRATEGY = 'A';

export function getSpotStrategy(id = ACTIVE_SPOT_STRATEGY): SpotStrategy {
  return SPOT_STRATEGIES.find((s) => s.id === id) ?? SPOT_STRATEGIES[0]!;
}

/** The strategy as prompt text for the chat skill. */
export function spotStrategyPrompt(s: SpotStrategy = getSpotStrategy()): string {
  return [
    `## ${s.name} (đang áp dụng)`,
    s.summary,
    `Mục tiêu: ${s.target}`,
    ...s.rules.flatMap((g) => [`### ${g.title}`, ...g.items.map((i) => `- ${i}`)]),
    '### Căn cứ (backtest, để trích dẫn khi người dùng hỏi)',
    ...s.backtest.rows.map((r) => `- ${r.config}: ${r.cagr}/năm, DD ${r.maxDd}${r.note ? ` (${r.note})` : ''}`),
    ...s.lessons.map((l) => `- ${l}`),
  ].join('\n');
}
