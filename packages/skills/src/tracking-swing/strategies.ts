/**
 * Spot Analytic strategies. One source of truth for both the chat skill (the ACTIVE strategy's rules
 * are injected into the system prompt) and the "Chiến lược" reference dialog on /tracking-coins
 * (served by GET /tracking-coins/strategies). Every strategy with status 'active' goes into the chat
 * prompt (A and B since 2026-11-07); ACTIVE_SPOT_STRATEGY is only the dialog's default tab.
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
    /** Labels of the two number columns; default ['Lãi/năm', 'Sụt giảm tối đa'] (CAGR / max DD). */
    columns?: [string, string];
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
  {
    id: 'B',
    name: 'Chiến lược B — Bắt cú hồi sau khi sập mạnh',
    status: 'active',
    createdAt: '2026-11-07',
    summary:
      'Mua spot alt ngay sau một cú sập nhanh nhiều ngày (3d ≤ −20% / 7d ≤ −25% / 30d ≤ −40%), chốt +10% (tối đa +15% khi sập rất mạnh), giữ tối đa 14 ngày. Lệnh ngắn, tách vốn khỏi Chiến lược A.',
    target: 'Mỗi lệnh +10%; trung bình +4–7%/lệnh sau phí (đã tính cả lệnh không chạm TP). Ít cơ hội: vài chục lệnh/năm trên cả watchlist, dồn vào các đợt sập.',
    rules: [
      {
        title: '1. Tín hiệu (nến D1 đã đóng, giảm tính close-to-close)',
        items: [
          'Coin giảm ≥ 20% trong 3 ngày, HOẶC ≥ 25% trong 7 ngày, HOẶC ≥ 40% trong 30 ngày → tín hiệu B.',
          'Coin giảm ≥ 25% trong 3 ngày hoặc ≥ 30% trong 7 ngày → tín hiệu B+ (mạnh): ~83–87% chạm +10%, ~70% chạm +15% trong 14 ngày.',
          'Thị trường sập kiểu B (alt trung vị watchlist 3d ≤ −15% / 7d ≤ −25% / 30d ≤ −30%) → cả danh sách có lợi thế; ưu tiên coin tốt nhất thay vì coin rơi sâu nhất.',
          'KHÔNG mua chỉ vì sập 1 ngày (BTC −5% hoặc alt −7% trong ngày): backtest = mua bừa, còn dễ rơi thêm −10% trước khi hồi.',
          'Không dùng ngưỡng nông hơn (3d −10%, 7d −15%, 30d −25%): tỷ lệ hồi ≈ ngày bình thường.',
        ],
      },
      {
        title: '2. Vào lệnh',
        items: [
          'Giá vào = giá đóng cửa nến D1 kích hoạt (sigBEntry). Tín hiệu còn hiệu lực 1–2 ngày sau nến kích hoạt nếu giá chưa hồi quá +5% so với giá vào; quá đó → bỏ, không đuổi.',
          'Mua 1 lần (không DCA thang như A). Mỗi lệnh ~3–5% vốn spot alt, tối đa ~5 lệnh B cùng lúc (đề xuất, chưa mô phỏng danh mục).',
          'Ưu tiên coin nhiều sao, thanh khoản cao (volRank thấp), L1/L2/Infra; tránh coin có tin xấu riêng (hack, huỷ niêm yết) — sập vì tin riêng không phải bán tháo cả thị trường.',
        ],
      },
      {
        title: '3. Thoát lệnh',
        items: [
          'TP = giá vào × 1.10 (đặt lệnh limit ngay sau khi mua). Tín hiệu B+ có thể để TP +15%.',
          'Không chạm TP sau 14 ngày → bán ở giá đóng cửa ngày 14 (backtest: trung vị lệnh không chạm TP vẫn quanh hoà vốn).',
          'Không stoploss (backtest không dùng SL). Rủi ro đuôi: đợt sập tiếp kiểu FTX 11/2022 (−15% sau 14 ngày) — giữ tỷ trọng nhỏ.',
          'Coin vừa có tín hiệu A vừa có B → ưu tiên kế hoạch A (giữ dài, TP +30%); không mở 2 lệnh cho cùng coin.',
        ],
      },
    ],
    backtest: {
      period: '2022-01 → 2026-11 (nến ngày)',
      universe: '39 alt của watchlist /tracking-coins (41 coin, bỏ BTC/ETH)',
      method: 'Mua ở close nến kích hoạt, TP +10% (hoặc +15%) theo high, không chạm → bán close ngày 14, không SL, phí 0.05%/chiều. Đối chứng = mua mọi ngày.',
      columns: ['Chạm +10% / +15% (≤14 ngày)', 'Lời TB/lệnh (TP +10%)'],
      rows: [
        { config: 'Đối chứng: mua ngày bất kỳ', cagr: '51% / 36%', maxDd: '−0.2%' },
        { config: 'Sập 1 ngày: BTC −5% / alt −7%', cagr: '53% / 34–37%', maxDd: '0.0 / +0.6%', note: 'không có lợi thế' },
        { config: 'Coin 3d ≤ −20% (343 lệnh)', cagr: '69% / 52%', maxDd: '+4.1%' },
        { config: 'Coin 3d ≤ −25% (128 lệnh)', cagr: '87% / 71%', maxDd: '+7.1%' },
        { config: 'Coin 7d ≤ −25% (374 lệnh)', cagr: '75% / 57%', maxDd: '+5.2%' },
        { config: 'Coin 7d ≤ −30% (174 lệnh)', cagr: '83% / 68%', maxDd: '+7.0%' },
        { config: 'Coin 30d ≤ −40% (302 lệnh)', cagr: '75% / 56%', maxDd: '+4.6%' },
        { config: 'Thị trường 7d ≤ −25% (10 đợt)', cagr: '91% / 72%', maxDd: '+8.7%' },
        { config: 'Thị trường 3d ≤ −15% (19 đợt)', cagr: '63% / 44%', maxDd: '+4.0%', note: '14/19 đợt có lời' },
      ],
      takeaways: [
        'Giảm càng nhanh càng hồi mạnh: cùng −30%, sập trong 3 ngày (95% chạm +10%) tốt hơn giảm dần 30 ngày (64%).',
        'Mục tiêu thực tế là +10%; +15% chỉ đáng đặt với tín hiệu B+.',
        'Khung 30 ngày yếu nhất — giảm dài thường là xu hướng giảm, không phải hoảng loạn.',
      ],
    },
    lessons: [
      'Các nhịp hồi tốt: LUNA 05/2022, 07/2024, 12/2024, 10/10/2025, 11/2025, 02/2026 (giỏ alt +8–10% trong ≤14 ngày).',
      'Nhịp xấu: FTX 11/2022 (sập tiếp, giỏ −14.7%), 01/2022, 04/2024, 02/2025, 31/01/2026.',
    ],
    limits: [
      'Danh sách coin chọn hôm nay → survivorship bias; năm 2022 chỉ 23 coin có dữ liệu.',
      'Ngưỡng ở mức thị trường chỉ có 10–19 đợt; ngưỡng cực sâu (3d −30%, 30d −50%) 1–3 đợt — không đủ tin.',
      'Chưa mô phỏng danh mục (tỷ trọng, số lệnh đồng thời, lãi kép); nến chạm cả TP và −10% cùng ngày tính là thua.',
    ],
    sources: ['claude-backtest/runs/2026-11-07-crash-rebound-alts.md'],
  },
];

export const ACTIVE_SPOT_STRATEGY = 'A';

export function getSpotStrategy(id = ACTIVE_SPOT_STRATEGY): SpotStrategy {
  return SPOT_STRATEGIES.find((s) => s.id === id) ?? SPOT_STRATEGIES[0]!;
}

/** All strategies the chat applies (status 'active'), as one prompt block. */
export function activeSpotStrategiesPrompt(): string {
  return SPOT_STRATEGIES.filter((s) => s.status === 'active').map((s) => spotStrategyPrompt(s)).join('\n\n');
}

/** The strategy as prompt text for the chat skill. */
export function spotStrategyPrompt(s: SpotStrategy = getSpotStrategy()): string {
  return [
    `## ${s.name}${s.status === 'active' ? ' (đang áp dụng)' : ''}`,
    s.summary,
    `Mục tiêu: ${s.target}`,
    ...s.rules.flatMap((g) => [`### ${g.title}`, ...g.items.map((i) => `- ${i}`)]),
    '### Căn cứ (backtest, để trích dẫn khi người dùng hỏi)',
    ...s.backtest.rows.map((r) => s.backtest.columns
      ? `- ${r.config}: ${s.backtest.columns[0]} ${r.cagr}; ${s.backtest.columns[1]} ${r.maxDd}${r.note ? ` (${r.note})` : ''}`
      : `- ${r.config}: ${r.cagr}/năm, DD ${r.maxDd}${r.note ? ` (${r.note})` : ''}`),
    ...s.lessons.map((l) => `- ${l}`),
  ].join('\n');
}
