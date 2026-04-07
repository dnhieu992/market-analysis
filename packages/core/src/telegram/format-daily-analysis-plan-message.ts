import type { DailyAnalysisPlan } from '../validation/daily-analysis-plan.schema';

type DailyAnalysisTrend = 'bullish' | 'bearish' | 'neutral';

type TimeframeAnalysis = {
  trend: DailyAnalysisTrend;
  s1: number;
  s2: number;
  r1: number;
  r2: number;
};

type H4Indicators = {
  ema20: number;
  ema50: number;
  ema200: number;
  rsi14: number;
  macd: {
    macd: number;
    signal: number;
    histogram: number;
  };
  atr14: number;
  volumeRatio: number;
};

type TradeDirection = 'long' | 'short' | 'wait';

export function formatDailyAnalysisPlanMessage(input: {
  symbol: string;
  date: Date;
  d1: TimeframeAnalysis;
  h4: TimeframeAnalysis;
  h4Indicators: H4Indicators;
  plan: DailyAnalysisPlan;
}) {
  const date = input.date.toISOString().slice(0, 10);
  const tradeDirection = deriveTradeDirection(input.d1, input.plan.bias);
  const triggerLevel =
    tradeDirection === 'short' ? formatPrice(input.h4.s2) : formatPrice(input.h4.r2);
  const higherTimeframeBreak =
    tradeDirection === 'short' ? formatPrice(input.d1.r1) : formatPrice(input.d1.s1);

  return [
    `${input.symbol} Daily Plan — ${date}`,
    '1) Tóm tắt nhanh',
    '',
    `Bias: ${formatBias(input.plan.bias)}`,
    `Confidence: ${input.plan.confidence}%`,
    `Time horizon: ${formatTimeHorizon(input.plan.timeHorizon)}`,
    '',
    'Kết luận nhanh:',
    deriveQuickActionLine(input.d1, input.h4, input.plan, tradeDirection),
    input.plan.analysis,
    '',
    '2) Bối cảnh thị trường',
    'Khung D1',
    `Xu hướng chính: ${formatTrend(input.d1.trend)}`,
    'Hỗ trợ:',
    `S1: ${formatPrice(input.d1.s1)}`,
    `S2: ${formatPrice(input.d1.s2)}`,
    'Kháng cự:',
    `R1: ${formatPrice(input.d1.r1)}`,
    `R2: ${formatPrice(input.d1.r2)}`,
    '',
    `=> ${describeDailyContext(input.d1)}`,
    '',
    'Khung H4',
    `Xu hướng ngắn hạn: ${formatTrend(input.h4.trend)}`,
    `${describeH4RangeLead(input.h4)}`,
    `H4 support: ${formatPrice(input.h4.s1)} / ${formatPrice(input.h4.s2)}`,
    `H4 resistance: ${formatPrice(input.h4.r1)} / ${formatPrice(input.h4.r2)}`,
    '',
    `=> ${describeH4Context(input.d1, input.h4)}`,
    '',
    '3) Tín hiệu kỹ thuật chính',
    `EMA200: ${formatPrice(input.h4Indicators.ema200)}`,
    `EMA50: ${formatPrice(input.h4Indicators.ema50)}`,
    `EMA20: ${formatPrice(input.h4Indicators.ema20)}`,
    '',
    `${describeEmaState(input.h4Indicators)}`,
    '',
    `RSI14: ${formatNumber(input.h4Indicators.rsi14)}`,
    `=> ${describeRsi(input.h4Indicators.rsi14)}`,
    `MACD: ${formatNumber(input.h4Indicators.macd.macd)}`,
    `Signal: ${formatNumber(input.h4Indicators.macd.signal)}`,
    `Histogram: ${formatNumber(input.h4Indicators.macd.histogram)}`,
    '',
    `=> ${describeMacd(input.h4Indicators.macd.histogram)}`,
    '',
    `Volume ratio: ${formatNumber(input.h4Indicators.volumeRatio)}`,
    `=> ${describeVolume(input.h4Indicators.volumeRatio)}`,
    `ATR14: ${formatNumber(input.h4Indicators.atr14)}`,
    `=> ${describeAtr(input.h4Indicators.atr14, input.h4Indicators.ema200)}`,
    '',
    '4) Kế hoạch giao dịch chính',
    formatTradeSetupTitle(tradeDirection),
    '',
    'Điều kiện kích hoạt',
    deriveTriggerLine(tradeDirection, input.h4),
    'Có volume tăng rõ ràng',
    '',
    'Entry',
    input.plan.tradePlan.entryZone,
    '',
    'Stop loss',
    input.plan.tradePlan.stopLoss,
    '',
    'Take profit',
    input.plan.tradePlan.takeProfit,
    '',
    'Invalidation',
    input.plan.tradePlan.invalidation,
    deriveHigherTimeframeInvalidation(tradeDirection, input.d1, higherTimeframeBreak),
    '',
    '5) Scenarios',
    tradeDirection === 'short' ? 'Bearish scenario' : 'Bullish scenario',
    '',
    tradeDirection === 'short'
      ? input.plan.scenarios.bearishScenario
      : input.plan.scenarios.bullishScenario,
    '',
    tradeDirection === 'short' ? 'Bullish scenario' : 'Bearish scenario',
    '',
    tradeDirection === 'short'
      ? input.plan.scenarios.bullishScenario
      : input.plan.scenarios.bearishScenario,
    '',
    '6) Điều cần tránh',
    ...buildAvoidLines(input.d1, input.h4, input.h4Indicators, tradeDirection, input.plan.riskNote),
    '',
    '7) Kết luận hành động',
    deriveActionSummary(input.d1, input.h4, tradeDirection),
    'Kèo đẹp nhất là:',
    deriveBestSetupLine(tradeDirection, triggerLevel),
    deriveActionInvalidationLine(tradeDirection, input.h4, higherTimeframeBreak)
  ].join('\n');
}

function formatBias(bias: DailyAnalysisPlan['bias']): string {
  if (bias === 'bullish') return 'Bullish';
  if (bias === 'bearish') return 'Bearish';
  return 'Neutral';
}

function formatTrend(trend: DailyAnalysisTrend): string {
  if (trend === 'bullish') return 'Bullish';
  if (trend === 'bearish') return 'Bearish';
  return 'Neutral';
}

function formatTimeHorizon(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'intraday to 1 day') {
    return 'Intraday đến 1 ngày';
  }

  if (normalized === '1 to 3 days') {
    return '1 đến 3 ngày';
  }

  return value;
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) {
    return '—';
  }

  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '—';
  }

  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6
  });
}

function deriveTradeDirection(
  d1: TimeframeAnalysis,
  bias: DailyAnalysisPlan['bias']
): TradeDirection {
  if (d1.trend === 'bullish') {
    return 'long';
  }

  if (d1.trend === 'bearish') {
    return 'short';
  }

  if (bias === 'bullish') {
    return 'long';
  }

  if (bias === 'bearish') {
    return 'short';
  }

  return 'wait';
}

function deriveQuickActionLine(
  d1: TimeframeAnalysis,
  h4: TimeframeAnalysis,
  plan: DailyAnalysisPlan,
  tradeDirection: TradeDirection
): string {
  if (plan.bias === 'neutral' || d1.trend !== h4.trend) {
    return 'Hiện tại chưa có kèo đẹp để vào ngay.';
  }

  if (tradeDirection === 'short') {
    return 'Ưu tiên chờ xác nhận breakdown rồi mới theo kèo short.';
  }

  if (tradeDirection === 'long') {
    return 'Ưu tiên chờ xác nhận breakout rồi mới theo kèo long.';
  }

  return 'Ưu tiên đứng ngoài chờ phá vỡ rõ ràng trước khi vào lệnh.';
}

function describeDailyContext(d1: TimeframeAnalysis): string {
  if (d1.trend === 'bullish') {
    return 'D1 vẫn giữ cấu trúc tăng, miễn là giá còn đứng trên vùng hỗ trợ chính.';
  }

  if (d1.trend === 'bearish') {
    return 'D1 vẫn giữ cấu trúc giảm, miễn là giá chưa lấy lại vùng kháng cự chính.';
  }

  return 'D1 đang trung tính, chưa cho xu hướng đủ rõ để vào lệnh sớm.';
}

function describeH4RangeLead(h4: TimeframeAnalysis): string {
  if (isTightRange(h4)) {
    return 'Giá đang đi ngang và nén chặt trong vùng:';
  }

  return 'Vùng cần theo dõi trên H4:';
}

function describeH4Context(d1: TimeframeAnalysis, h4: TimeframeAnalysis): string {
  if (d1.trend !== 'neutral' && h4.trend !== 'neutral' && d1.trend !== h4.trend) {
    return 'H4 đang cho tín hiệu mâu thuẫn với D1, nên không phù hợp để vào lệnh sớm.';
  }

  if (h4.trend === 'neutral') {
    return 'H4 đang sideway, nên ưu tiên chờ phá vỡ rõ ràng trước khi vào lệnh.';
  }

  if (d1.trend === h4.trend) {
    return 'H4 đang đồng thuận với D1, có thể dùng làm khung chính để chờ breakout xác nhận.';
  }

  return 'H4 đang là khung chính để chờ tín hiệu xác nhận trước khi kích hoạt kế hoạch.';
}

function describeEmaState(h4Indicators: H4Indicators): string {
  const emaValues = [h4Indicators.ema20, h4Indicators.ema50, h4Indicators.ema200];
  const spread = (Math.max(...emaValues) - Math.min(...emaValues)) / Math.max(1, h4Indicators.ema200);

  if (spread <= 0.01) {
    return '=> Các EMA đang nằm sát nhau, cho thấy thị trường đang sideway / consolidation.';
  }

  if (h4Indicators.ema20 > h4Indicators.ema50 && h4Indicators.ema50 > h4Indicators.ema200) {
    return '=> EMA đang xếp chồng bullish, xu hướng tăng trên H4 vẫn được giữ.';
  }

  if (h4Indicators.ema20 < h4Indicators.ema50 && h4Indicators.ema50 < h4Indicators.ema200) {
    return '=> EMA đang xếp chồng bearish, áp lực giảm trên H4 vẫn chiếm ưu thế.';
  }

  return '=> EMA đang đan xen, cho thấy cấu trúc H4 chưa đủ sạch để vào lệnh sớm.';
}

function describeRsi(rsi14: number): string {
  if (rsi14 >= 60) {
    return 'RSI đang nghiêng bullish, lực mua vẫn còn lợi thế.';
  }

  if (rsi14 <= 40) {
    return 'RSI đang nghiêng bearish, áp lực bán vẫn còn chiếm ưu thế.';
  }

  return 'Trung tính, chưa có lợi thế rõ cho bên mua hoặc bán.';
}

function describeMacd(histogram: number): string {
  if (histogram > 0) {
    return 'Động lượng bullish đang được cải thiện.';
  }

  if (histogram < 0) {
    return 'Động lượng bullish đang yếu đi.';
  }

  return 'Động lượng đang cân bằng, cần thêm tín hiệu xác nhận.';
}

function describeVolume(volumeRatio: number): string {
  if (volumeRatio < 0.8) {
    return 'Khối lượng thấp, breakout nếu có cũng cần xác nhận thêm volume.';
  }

  if (volumeRatio > 1.2) {
    return 'Khối lượng đang hỗ trợ chuyển động giá, breakout đáng tin cậy hơn nếu được giữ vững.';
  }

  return 'Khối lượng ở mức trung bình, vẫn cần xác nhận thêm khi giá breakout.';
}

function describeAtr(atr14: number, ema200: number): string {
  const atrRatio = atr14 / Math.max(1, ema200);

  if (atrRatio >= 0.012) {
    return 'Biến động nền vẫn lớn, nên nếu breakout xảy ra có thể chạy khá mạnh.';
  }

  if (atrRatio <= 0.006) {
    return 'Biến động nền đang thu hẹp, dễ tạo pha nén trước khi bứt phá.';
  }

  return 'Biến động nền ở mức trung bình, nên ưu tiên chờ xác nhận rõ trước khi vào lệnh.';
}

function formatTradeSetupTitle(tradeDirection: TradeDirection): string {
  if (tradeDirection === 'short') {
    return 'Kèo Short';
  }

  if (tradeDirection === 'long') {
    return 'Kèo Long';
  }

  return 'Kèo chờ xác nhận';
}

function deriveTriggerLine(tradeDirection: TradeDirection, h4: TimeframeAnalysis): string {
  if (tradeDirection === 'short') {
    return `Nến H4 đóng dưới ${formatPrice(h4.s2)}`;
  }

  if (tradeDirection === 'long') {
    return `Nến H4 đóng trên ${formatPrice(h4.r2)}`;
  }

  return `Nến H4 đóng ra khỏi vùng ${formatPrice(h4.s2)} - ${formatPrice(h4.r2)}`;
}

function deriveHigherTimeframeInvalidation(
  tradeDirection: TradeDirection,
  d1: TimeframeAnalysis,
  higherTimeframeBreak: string
): string {
  if (tradeDirection === 'short' && d1.trend === 'bearish') {
    return `Nếu giá vượt lại ${higherTimeframeBreak}, bias bearish của D1 bị phá vỡ.`;
  }

  if (tradeDirection === 'long' && d1.trend === 'bullish') {
    return `Nếu giá rơi sâu dưới ${higherTimeframeBreak}, bias bullish của D1 bị phá vỡ.`;
  }

  return '';
}

function buildAvoidLines(
  d1: TimeframeAnalysis,
  h4: TimeframeAnalysis,
  h4Indicators: H4Indicators,
  tradeDirection: TradeDirection,
  riskNote: string
): string[] {
  const lines: string[] = [];

  if (isTightRange(h4) || d1.trend !== h4.trend) {
    lines.push('Không vào lệnh khi giá vẫn còn nằm trong vùng nén H4');
  }

  if (h4Indicators.volumeRatio < 1) {
    lines.push('Không tin breakout nếu không có volume xác nhận');
  }

  if (tradeDirection !== 'wait') {
    lines.push('Không đuổi giá nếu cây breakout đã chạy quá xa entry chuẩn');
  }

  lines.push(riskNote);

  return [...new Set(lines)];
}

function deriveActionSummary(
  d1: TimeframeAnalysis,
  h4: TimeframeAnalysis,
  tradeDirection: TradeDirection
): string {
  if (d1.trend !== h4.trend || tradeDirection === 'wait') {
    return 'Hôm nay ưu tiên chờ, không vào sớm.';
  }

  if (tradeDirection === 'short') {
    return 'Hôm nay ưu tiên chờ breakdown xác nhận rồi mới vào kèo short.';
  }

  return 'Hôm nay ưu tiên chờ breakout xác nhận rồi mới vào kèo long.';
}

function deriveBestSetupLine(tradeDirection: TradeDirection, triggerLevel: string): string {
  if (tradeDirection === 'short') {
    return `Short khi H4 close dưới ${triggerLevel} + volume tốt`;
  }

  if (tradeDirection === 'long') {
    return `Long khi H4 close trên ${triggerLevel} + volume tốt`;
  }

  return `Chỉ vào lệnh khi H4 đóng thoát khỏi vùng sideway với volume xác nhận`;
}

function deriveActionInvalidationLine(
  tradeDirection: TradeDirection,
  h4: TimeframeAnalysis,
  higherTimeframeBreak: string
): string {
  if (tradeDirection === 'short') {
    return `Nếu giá lấy lại ${formatPrice(h4.r2)}, bỏ kịch bản short và chờ tín hiệu mới`;
  }

  if (tradeDirection === 'long') {
    return `Nếu thủng ${formatPrice(h4.s2)}, bỏ kịch bản long. Theo dõi thêm mốc ${higherTimeframeBreak} cho cấu trúc D1`;
  }

  return `Nếu chưa có breakout rõ ràng, tiếp tục đứng ngoài và chờ tín hiệu mới`;
}

function isTightRange(h4: TimeframeAnalysis): boolean {
  const mid = (h4.s2 + h4.r2) / 2;

  if (!Number.isFinite(mid) || mid === 0) {
    return false;
  }

  return Math.abs(h4.r2 - h4.s2) / mid <= 0.015;
}
