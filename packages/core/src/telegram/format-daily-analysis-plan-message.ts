import type { DailyAnalysisMarketData } from '../validation/daily-analysis-market-data.schema';
import type { DailyAnalysisPlan } from '../validation/daily-analysis-plan.schema';

export function formatDailyAnalysisPlanMessage(input: {
  symbol: string;
  date: Date;
  marketData: DailyAnalysisMarketData;
  plan: DailyAnalysisPlan;
}) {
  const date = input.date.toISOString().slice(0, 10);
  const d1 = input.marketData.timeframes.D1;
  const h4 = input.marketData.timeframes.H4;
  const currentPrice = input.marketData.currentPrice;
  const d1Support1 = firstLevel(d1.levels.support);
  const d1Support2 = secondLevel(d1.levels.support);
  const d1Resistance1 = firstLevel(d1.levels.resistance);
  const d1Resistance2 = secondLevel(d1.levels.resistance);
  const h4Support1 = firstLevel(h4.levels.support);
  const h4Support2 = secondLevel(h4.levels.support);
  const h4Resistance1 = firstLevel(h4.levels.resistance);
  const h4Resistance2 = secondLevel(h4.levels.resistance);

  return [
    `${input.symbol} Daily Plan — ${date}`,
    '1) Tóm tắt nhanh',
    '',
    `Bias: ${input.plan.bias}`,
    `Confidence: ${input.plan.confidence}%`,
    `Time horizon: Intraday đến 1 ngày`,
    '',
    'Kết luận nhanh:',
    input.plan.summary,
    '',
    '2) Bối cảnh thị trường',
    'Khung D1',
    `Xu hướng chính: ${capitalizeTrend(d1.trend)}`,
    'Hỗ trợ:',
    `S1: ${formatPrice(d1Support1)}`,
    `S2: ${formatPrice(d1Support2)}`,
    'Kháng cự:',
    `R1: ${formatPrice(d1Resistance1)}`,
    `R2: ${formatPrice(d1Resistance2)}`,
    '',
    `=> ${buildD1Commentary(d1.trend, h4.trend)}`,
    '',
    'Khung H4',
    `Xu hướng ngắn hạn: ${capitalizeTrend(h4.trend)}`,
    buildH4StructureIntro(input.plan.marketState.trendCondition),
    `H4 support: ${formatPrice(h4Support1)} / ${formatPrice(h4Support2)}`,
    `H4 resistance: ${formatPrice(h4Resistance1)} / ${formatPrice(h4Resistance2)}`,
    '',
    `=> ${buildH4Commentary(d1.trend, h4.trend)}`,
    '',
    '3) Tín hiệu kỹ thuật chính',
    `EMA200: ${formatPrice(h4.ema200)}`,
    `EMA50: ${formatPrice(h4.ema50)}`,
    `EMA20: ${formatPrice(h4.ema20)}`,
    '',
    `${buildEmaCommentary(h4.ema20, h4.ema50, h4.ema200)}`,
    '',
    `RSI14: ${formatDecimal(h4.rsi14)}`,
    `=> ${buildRsiCommentary(h4.rsi14)}`,
    `MACD: ${formatDecimal(h4.macd.line)}`,
    `Signal: ${formatDecimal(h4.macd.signal)}`,
    `Histogram: ${formatDecimal(h4.macd.histogram)}`,
    '',
    `=> ${buildMacdCommentary(h4.macd.histogram)}`,
    '',
    `Volume ratio: ${formatDecimal(h4.volumeRatio)}`,
    `=> ${buildVolumeCommentary(input.plan.marketState.volumeCondition, h4.volumeRatio)}`,
    `ATR14: ${formatDecimal(h4.atr14)}`,
    `=> ${buildAtrCommentary(h4.atr14, currentPrice)}`,
    '4) Kế hoạch giao dịch chính',
    '',
    `${buildTradeHeading(input.plan.primarySetup.direction)}`,
    '',
    `${buildTradeIntro(input.plan.status, input.plan.primarySetup.direction)}`,
    'Điều kiện kích hoạt',
    input.plan.primarySetup.trigger,
    '',
    'Entry',
    input.plan.primarySetup.entry,
    '',
    'Stop loss',
    input.plan.primarySetup.stopLoss,
    '',
    'Take profit',
    `${input.plan.primarySetup.takeProfit1}${input.plan.primarySetup.takeProfit2 ? ` / ${input.plan.primarySetup.takeProfit2}` : ''}`,
    '',
    'Invalidation',
    input.plan.primarySetup.invalidation,
    '',
    ...(input.plan.secondarySetup.direction !== 'none'
      ? [
          'Kèo dự phòng',
          `Direction: ${capitalizeDirection(input.plan.secondarySetup.direction)}`,
          `Trigger: ${input.plan.secondarySetup.trigger}`,
          `Entry: ${input.plan.secondarySetup.entry}`,
          `Stop loss: ${input.plan.secondarySetup.stopLoss}`,
          `Take profit 1: ${input.plan.secondarySetup.takeProfit1}`,
          `Take profit 2: ${input.plan.secondarySetup.takeProfit2}`,
          `Invalidation: ${input.plan.secondarySetup.invalidation}`,
          ''
        ]
      : []),
    '5) Scenarios',
    '',
    'Bullish scenario',
    buildBullishScenario(input.plan.primarySetup.trigger, input.plan.primarySetup.takeProfit1, input.plan.primarySetup.takeProfit2),
    '',
    'Bearish scenario',
    buildBearishScenario(input.plan.primarySetup.invalidation, input.plan.status),
    '',
    '6) Điều cần tránh',
    input.plan.noTradeZone,
    buildAvoidanceNote(input.plan.status, input.plan.marketState.volumeCondition, input.plan.marketState.trendCondition),
    '',
    '7) Kết luận hành động',
    input.plan.finalAction,
    buildActionSummary(input.plan.status, input.plan.primarySetup.direction, input.plan.primarySetup.trigger, input.plan.primarySetup.invalidation)
  ]
    .filter((line, index, array) => !(line === '' && array[index - 1] === ''))
    .join('\n');
}

function buildD1Commentary(d1Trend: string, h4Trend: string): string {
  if (d1Trend === 'bullish' && h4Trend === 'bearish') {
    return 'D1 vẫn giữ cấu trúc tăng, miễn là giá còn đứng trên vùng hỗ trợ chính.';
  }

  if (d1Trend === 'bearish' && h4Trend === 'bullish') {
    return 'D1 vẫn giữ cấu trúc giảm, nhưng H4 đang cần thêm xác nhận.';
  }

  if (d1Trend === 'bullish') {
    return 'D1 vẫn nghiêng bullish, miễn là hỗ trợ chính còn được giữ.';
  }

  if (d1Trend === 'bearish') {
    return 'D1 vẫn nghiêng bearish, miễn là kháng cự chính chưa bị phá.';
  }

  return 'D1 đang trung tính, ưu tiên chờ tín hiệu rõ ràng hơn.';
}

function buildH4Commentary(d1Trend: string, h4Trend: string): string {
  if (d1Trend !== h4Trend && h4Trend !== 'neutral') {
    return 'H4 đang cho tín hiệu mâu thuẫn với D1, nên không phù hợp để vào lệnh sớm.';
  }

  if (h4Trend === 'bullish') {
    return 'H4 đang ủng hộ xu hướng tăng, nhưng vẫn cần breakout xác nhận.';
  }

  if (h4Trend === 'bearish') {
    return 'H4 đang nghiêng giảm, cần chờ cấu trúc rõ hơn trước khi vào lệnh.';
  }

  return 'H4 đang trung tính, nên ưu tiên chờ xác nhận.';
}

function buildH4StructureIntro(trendCondition: DailyAnalysisPlan['marketState']['trendCondition']): string {
  if (trendCondition === 'compressed') {
    return 'Giá đang đi ngang và nén chặt trong vùng:';
  }

  if (trendCondition === 'trending') {
    return 'Giá đang vận động theo xu hướng chính, các vùng cần theo dõi là:';
  }

  if (trendCondition === 'ranging') {
    return 'Giá đang dao động trong biên, các vùng cần theo dõi là:';
  }

  return 'Giá đang chuyển pha, ưu tiên theo dõi các vùng phản ứng chính:';
}

function buildEmaCommentary(ema20: number, ema50: number, ema200: number): string {
  const spread = Math.max(ema20, ema50, ema200) - Math.min(ema20, ema50, ema200);
  const spreadRatio = spread / Math.max(1, ema200);

  if (spreadRatio < 0.01) {
    return 'Các EMA đang nằm sát nhau, cho thấy thị trường đang sideway / consolidation.';
  }

  if (ema20 > ema50 && ema50 > ema200) {
    return 'EMA đang xếp theo thứ tự tăng, xu hướng trung hạn vẫn còn khỏe.';
  }

  if (ema20 < ema50 && ema50 < ema200) {
    return 'EMA đang xếp theo thứ tự giảm, xu hướng trung hạn vẫn còn áp lực.';
  }

  return 'EMA đang giao nhau, cần thêm xác nhận trước khi theo breakout.';
}

function buildRsiCommentary(rsi14: number): string {
  if (rsi14 >= 45 && rsi14 <= 55) {
    return 'Trung tính, chưa có lợi thế cho bên mua hoặc bán.';
  }

  if (rsi14 > 55) {
    return 'Động lượng đang nghiêng về bên mua.';
  }

  return 'Động lượng đang yếu đi, cần thận trọng với lệnh long.';
}

function buildMacdCommentary(histogram: number): string {
  if (histogram < 0) {
    return 'Động lượng bullish đang yếu đi.';
  }

  if (histogram > 0) {
    return 'Động lượng đang cải thiện theo hướng tăng.';
  }

  return 'MACD đang trung tính, chưa cho tín hiệu rõ ràng.';
}

function buildVolumeCommentary(volumeCondition: string, volumeRatio: number): string {
  if (volumeCondition === 'very_weak' || volumeRatio < 0.3) {
    return 'Khối lượng rất thấp, breakout nếu có cũng cần xác nhận thêm volume.';
  }

  if (volumeCondition === 'weak' || volumeRatio < 0.8) {
    return 'Khối lượng chưa thật sự mạnh, cần thêm xác nhận.';
  }

  return 'Khối lượng đang ủng hộ breakout.';
}

function buildAtrCommentary(atr14: number, currentPrice: number): string {
  const ratio = atr14 / Math.max(1, currentPrice);

  if (ratio > 0.01) {
    return 'Biến động nền vẫn lớn, nên nếu breakout xảy ra có thể chạy khá mạnh.';
  }

  return 'Biến động nền đang ở mức vừa phải.';
}

function buildTradeHeading(direction: string): string {
  if (direction === 'long') {
    return 'Kèo Long';
  }

  if (direction === 'short') {
    return 'Kèo Short';
  }

  return 'Kèo chờ';
}

function buildTradeIntro(status: string, direction: string): string {
  if (direction === 'long' && status !== 'TRADE_READY') {
    return 'Chỉ xem xét Long khi có:';
  }

  if (direction === 'short' && status !== 'TRADE_READY') {
    return 'Chỉ xem xét Short khi có:';
  }

  if (direction === 'none') {
    return 'Hiện tại chưa có kèo rõ ràng.';
  }

  return 'Có thể theo dõi setup sau khi breakout được xác nhận:';
}

function buildBullishScenario(trigger: string, takeProfit1: string, takeProfit2: string): string {
  const triggerLevel = parseFirstNumber(trigger);
  const tp1 = takeProfit1.trim();
  const tp2 = takeProfit2.trim();

  if (triggerLevel != null) {
    return `Nếu giá breakout lên trên ${formatPrice(triggerLevel)} và giữ được phía trên vùng này với volume tốt, có thể ưu tiên theo kịch bản tăng:\n\nTP1: ${tp1}\nTP2: ${tp2}`;
  }

  return `Nếu breakout được xác nhận và volume tốt, có thể ưu tiên theo kịch bản tăng:\n\nTP1: ${tp1}\nTP2: ${tp2}`;
}

function buildBearishScenario(invalidation: string, status: string): string {
  const invalidationLevel = parseFirstNumber(invalidation);

  if (invalidationLevel != null) {
    return `Nếu giá không giữ được cấu trúc hiện tại và nến H4 đóng dưới ${formatPrice(invalidationLevel)}, setup hiện tại không còn hiệu lực.\nKhi đó ưu tiên:\n\nđứng ngoài\nchờ cấu trúc mới\nkhông đuổi theo breakout chưa xác nhận`;
  }

  if (status === 'NO_TRADE') {
    return 'Nếu điều kiện thị trường không cải thiện, ưu tiên đứng ngoài và chờ cấu trúc mới.';
  }

  return 'Nếu tín hiệu xác nhận thất bại, ưu tiên đứng ngoài và chờ cấu trúc mới.';
}

function buildAvoidanceNote(status: string, volumeCondition: string, trendCondition: string): string {
  const lines = [
    'Không vào lệnh khi giá vẫn còn nằm trong vùng nén H4',
    'Không tin breakout nếu không có volume xác nhận',
    'Không đuổi giá nếu cây breakout đã chạy quá xa entry chuẩn'
  ];

  if (status !== 'TRADE_READY' || volumeCondition === 'very_weak' || trendCondition === 'compressed') {
    lines.unshift('Hôm nay ưu tiên chờ, không vào sớm.');
  }

  return lines.join('\n');
}

function buildActionSummary(
  status: string,
  direction: string,
  trigger: string,
  invalidation: string
): string {
  const triggerLevel = parseFirstNumber(trigger);
  const invalidationLevel = parseFirstNumber(invalidation);

  if (status !== 'TRADE_READY') {
    const action = direction === 'long' ? 'Long' : direction === 'short' ? 'Short' : 'setup';

    if (triggerLevel != null && invalidationLevel != null && direction !== 'none') {
      return `Kèo đẹp nhất là:\n\n${action} khi H4 close trên ${formatPrice(triggerLevel)} + volume tốt\nNếu thủng ${formatPrice(
        invalidationLevel
      )}, bỏ kịch bản ${action.toLowerCase()} và chờ tín hiệu mới`;
    }

    return 'Đứng ngoài, chờ cấu trúc rõ hơn và volume xác nhận.';
  }

  return 'Kịch bản đã sẵn sàng theo dõi, nhưng vẫn nên chờ xác nhận nến H4.';
}

function capitalizeTrend(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function capitalizeDirection(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatPrice(value: number): string {
  const normalized = Number.isInteger(value) ? value : Number(value.toFixed(2));
  return normalized.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(normalized) ? 0 : 2,
    maximumFractionDigits: 2
  });
}

function formatDecimal(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function parseFirstNumber(value: string): number | null {
  const matches = value.match(/-?\d+(?:\.\d+)?/g);

  if (!matches || matches.length === 0) {
    return null;
  }

  const parsed = matches
    .map((candidate) => Number(candidate))
    .filter((candidate) => Number.isFinite(candidate));

  if (parsed.length === 0) {
    return null;
  }

  return parsed.reduce((highest, candidate) => (Math.abs(candidate) > Math.abs(highest) ? candidate : highest));
}

function firstLevel(levels: number[]): number {
  return levels[0] ?? 0;
}

function secondLevel(levels: number[]): number {
  return levels[1] ?? levels[0] ?? 0;
}
