import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import type { Candle } from '@app/core';

import { DeepseekClient, type DeepseekMessage } from './deepseek.client';
import {
  BtcPaSnapshotService,
  SWING_LOOKBACK,
  VOLUME_AVG_LOOKBACK,
  type BtcPaSnapshot,
  type FibRetracement,
  type TimeframeReport,
  type TrendLine,
} from './btc-pa-snapshot.service';
import { renderBtcDaytradeChart } from './btc-daytrade-chart';
import {
  BtcDaytradeArchiveService,
  type DaytradeHistoryItem,
  type StoredDaytradeAnalysis,
} from './btc-daytrade-archive.service';

/**
 * The BTC day-trading agent behind the /deepseek page's Analyze button.
 *
 * The split is deliberate: `BtcPaSnapshotService` produces the numbers across
 * 1D / 4H / 1H / 15m and DeepSeek only reads them top-down into one intraday
 * setup. The model has no live data, so any figure it is not handed is a figure
 * it would invent — the prompt says so, the snapshot is returned to the UI
 * alongside the prose, and the trade geometry it proposes is re-checked here in
 * code before the answer leaves the API.
 *
 * The analysis is pure price action by design: structure, trend lines, Fibonacci
 * and raw candles. There are no indicators in the snapshot, so the prompt also
 * has to forbid *talking* about them — a model asked for a trade setup will reach
 * for "RSI is oversold" out of habit, and here that number would be invented.
 */

export type TradeDirection = 'LONG' | 'SHORT' | 'NO_TRADE';
export type Confidence = 'high' | 'medium' | 'low';
export type TimeframeBias = 'bullish' | 'bearish' | 'neutral';

/** The structured setup, parsed out of the model's JSON block. */
export type DaytradeSignal = {
  direction: TradeDirection;
  confidence: Confidence | null;
  /** Entry zone. `to` equals `from` when the model gives a single price. */
  entryFrom: number | null;
  entryTo: number | null;
  stopLoss: number | null;
  takeProfits: number[];
  /** Risk/reward as the model stated it. */
  riskRewardModel: number | null;
  /** Risk/reward recomputed here from entry mid / SL / TP1 — the one to trust. */
  riskReward: number | null;
  /** Percent of the entry mid that is at risk to the stop. */
  riskPct: number | null;
  timeframeBias: Partial<Record<string, TimeframeBias>>;
  invalidation: string | null;
  summary: string | null;
  /** Deterministic hard checks that failed. Empty means the geometry is sane. */
  warnings: string[];
};

export type BtcDaytradeResult = {
  /** Markdown written by DeepSeek, with the JSON block stripped out. */
  analysis: string;
  /** The setup itself. Null when the model's JSON block was missing or unparseable. */
  signal: DaytradeSignal | null;
  /** Chain of thought — only present when the model thought before answering. */
  reasoning: string | null;
  model: string;
  generatedAt: string;
  /** The exact data the model was given, for the tables under the prose. */
  snapshot: BtcPaSnapshot;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
};

export type DeepseekStatus = {
  configured: boolean;
  model: string;
};

/** Minimum reward/risk a setup must clear to be worth taking. */
const MIN_RISK_REWARD = 1.5;
/** Round-trip fee at the user's real rate (0.05%/side) — a TP must clear it. */
const ROUND_TRIP_FEE_PCT = 0.1;
/** How far the entry zone may sit from the live price before it is a limit order to flag. */
const MAX_ENTRY_DISTANCE_PCT = 2;

const SYSTEM_PROMPT = [
  'Bạn là trader day trading BTC theo trường phái PRICE ACTION THUẦN. Nhiệm vụ: đọc dữ liệu ĐA KHUNG',
  'THỜI GIAN của BTCUSDT và đưa ra MỘT tín hiệu vào lệnh trong ngày, kèm lý do, bằng TIẾNG VIỆT.',
  '',
  'CÔNG CỤ ĐƯỢC DÙNG — CHỈ ba thứ sau, không có gì khác:',
  '1. Price action: cấu trúc thị trường (HH/HL = tăng, LH/LL = giảm), swing high/low, vùng hỗ trợ –',
  '   kháng cự ngang, hành vi nến gần nhất (thân/râu, phá vỡ, retest, false break) và volume thô.',
  '2. Trend line: đường nối hai đáy gần nhất (đường dưới) hoặc hai đỉnh gần nhất (đường trên). Dữ liệu',
  '   đã cho sẵn giá trị đường tại thời điểm hiện tại, độ dốc, số lần chạm, và đã gãy hay chưa.',
  '3. Fibonacci: retracement 0.236 / 0.382 / 0.5 / 0.618 / 0.786 của chân sóng gần nhất, và extension',
  '   1.272 / 1.618 dùng làm mục tiêu.',
  '',
  'TUYỆT ĐỐI KHÔNG dùng và KHÔNG nhắc tới chỉ báo: EMA, MA, RSI, MACD, Bollinger, Stochastic, ATR,',
  'Ichimoku, volume profile… Dữ liệu KHÔNG có các chỉ báo này, nên mọi con số chỉ báo bạn viết ra đều là',
  'bịa. Nếu muốn nói về động lượng thì mô tả bằng hành vi giá (nến, biên độ, tốc độ, volume), không bằng',
  'chỉ báo.',
  '',
  'CÁCH PHÂN TÍCH (bắt buộc theo thứ tự top-down):',
  '1. 1D — bối cảnh: cấu trúc nền đang tăng / giảm / đi ngang, vùng giá lớn nào đang chi phối.',
  '2. 4H — xu hướng chính: chuỗi swing, trend line còn hiệu lực hay đã gãy, chân sóng fib hiện tại.',
  '3. 1H — xu hướng trong ngày: giá đang ở đâu trong chân sóng (đã hồi bao nhiêu %), gần mốc nào.',
  '4. 15m — điểm vào: vùng giá cụ thể, xác nhận bằng hành vi nến gần nhất và volume.',
  'Khung lớn quyết định HƯỚNG, khung nhỏ quyết định ĐIỂM VÀO. Không bao giờ vào ngược cấu trúc 4H chỉ vì',
  '15m đẹp.',
  '',
  'KỊCH BẢN VÀO LỆNH ƯU TIÊN (chọn một, nói rõ đang theo kịch bản nào):',
  '- Pullback thuận xu hướng về vùng fib 0.382–0.618 của chân sóng gần nhất, có hỗ trợ/kháng cự ngang',
  '  hoặc trend line trùng vào vùng đó (càng nhiều yếu tố trùng nhau càng tốt).',
  '- Test lại trend line còn hiệu lực (chưa gãy, đã có ít nhất 1 lần chạm sau khi vẽ).',
  '- Phá vỡ một mốc ngang rõ ràng rồi retest lại chính mốc đó.',
  '',
  'QUY TẮC RA TÍN HIỆU:',
  `- Reward/Risk tối thiểu ${MIN_RISK_REWARD}. Không đạt thì trả về NO_TRADE, không cố nặn ra lệnh.`,
  '- Khi cấu trúc 4H và 1H ngược nhau, hoặc cả ba khung lớn đều đi ngang và giá kẹt giữa vùng, ưu tiên',
  '  NO_TRADE.',
  '- Stop loss BẮT BUỘC nằm ngoài một mốc cấu trúc thật theo hướng lệnh: dưới đáy swing / mốc hỗ trợ gần',
  '  nhất với lệnh LONG, trên đỉnh swing / mốc kháng cự gần nhất với lệnh SHORT. Không đặt SL theo số tròn',
  '  cho đẹp, không đặt SL giữa vùng trống.',
  '- Take profit đặt tại mốc cấu trúc phía trước (hỗ trợ/kháng cự ngang, đỉnh/đáy swing) hoặc fib',
  '  extension 1.272 / 1.618. Nói rõ TP dựa vào mốc nào.',
  `- Phí thực tế ${ROUND_TRIP_FEE_PCT}% khứ hồi, nên TP1 phải cách điểm vào đủ xa để lãi thật sau phí.`,
  '- Đây là lệnh trong ngày: mục tiêu đóng trong vài giờ đến hết ngày, không phải lệnh swing nhiều tuần.',
  '- Không khuyên đòn bẩy, không khuyên khối lượng vốn, không hứa chắc thắng.',
  '',
  'QUY TẮC DỮ LIỆU:',
  '- CHỈ dùng số trong phần DỮ LIỆU. Tuyệt đối KHÔNG bịa giá, không bịa tin tức, không nhắc sự kiện nào',
  '  mà dữ liệu không có (tin tức, ETF, funding, thanh lý, open interest đều KHÔNG có trong dữ liệu này).',
  '- Nếu thiếu thông tin để kết luận, nói thẳng "dữ liệu không có" thay vì suy đoán.',
  '- Nến cuối cùng của khung 15m là nến CHƯA ĐÓNG (giá hiện tại), không được coi là tín hiệu đã xác nhận.',
  '',
  'ĐỊNH DẠNG TRẢ LỜI — bắt buộc đúng 2 phần, phần JSON đứng TRƯỚC:',
  '',
  '```json',
  '{',
  '  "direction": "LONG" | "SHORT" | "NO_TRADE",',
  '  "confidence": "high" | "medium" | "low",',
  '  "entry": { "from": <số>, "to": <số> },',
  '  "stopLoss": <số>,',
  '  "takeProfits": [<số>, <số>],',
  '  "riskReward": <số>,',
  '  "timeframeBias": { "1d": "bullish|bearish|neutral", "4h": "...", "1h": "...", "15m": "..." },',
  '  "invalidation": "<điều kiện huỷ setup, một câu>",',
  '  "summary": "<tóm tắt tín hiệu trong một câu>"',
  '}',
  '```',
  '',
  'Giá trong JSON là số thuần (không dấu $, không dấu phẩy). Nếu NO_TRADE thì entry/stopLoss/takeProfits để null.',
  '',
  'Sau khối JSON là phần giải thích markdown, ngắn gọn, KHÔNG chép lại nguyên bảng số liệu:',
  '## Cấu trúc đa khung',
  'Mỗi khung 1-2 câu: cấu trúc 1D, 4H, 1H, 15m đang nói gì, và chúng đồng thuận hay mâu thuẫn.',
  '## Trend line & Fibonacci',
  'Trend line nào còn hiệu lực, giá đang ở đâu so với nó; giá đã hồi bao nhiêu % của chân sóng gần nhất và',
  'đang nằm giữa hai mốc fib nào.',
  '## Tín hiệu vào lệnh',
  'Theo kịch bản nào, vùng vào cụ thể, vì sao SL đặt ở đó (mốc cấu trúc nào), vì sao TP đặt ở đó (mốc nào),',
  'R/R bao nhiêu.',
  '## Rủi ro & điều kiện huỷ setup',
  'Gạch đầu dòng: điều gì làm setup sai, mốc giá nào thì thoát, kịch bản ngược lại là gì.',
].join('\n');

/** Compact USD formatting for the prompt (so the model reads clean numbers). */
function fmtUsd(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/** Signed percent with an explicit sign, so direction survives the prompt. */
function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

const fmtNum = (n: number, digits = 2): string =>
  Number.isFinite(n) ? n.toFixed(digits) : 'n/a';

const fmtLevels = (levels: number[]): string =>
  levels.length > 0 ? levels.map((l) => fmtUsd(l)).join(', ') : 'n/a';

/** A finite number, or null — the model sometimes answers "null" or "-" in a price field. */
function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

@Injectable()
export class DeepseekService {
  private readonly logger = new Logger(DeepseekService.name);

  constructor(
    private readonly client: DeepseekClient,
    private readonly snapshots: BtcPaSnapshotService,
    private readonly archive: BtcDaytradeArchiveService,
  ) {}

  /** Whether the page can run an agent at all, and which model it would use. */
  status(): DeepseekStatus {
    return { configured: this.client.isConfigured(), model: this.client.model };
  }

  /**
   * Run the day-trading agent: snapshot BTC across four timeframes, ask DeepSeek
   * for one setup, verify its geometry, draw the chart, and log the day. Fails
   * with 503 rather than a half-answer — a trade signal with no data behind it
   * is worse than no signal at all.
   *
   * The chart and the DB write are the last steps and neither can fail the run:
   * by then the tokens are already spent, so an answer without a chart still
   * beats an error.
   */
  async analyzeBtcDaytrade(): Promise<StoredDaytradeAnalysis> {
    if (!this.client.isConfigured()) {
      throw new ServiceUnavailableException(
        'Chưa cấu hình DEEPSEEK_API_KEY — thêm key vào .env rồi khởi động lại API.',
      );
    }

    let snapshot: BtcPaSnapshot;
    let candles: Record<string, Candle[]>;
    try {
      ({ snapshot, candles } = await this.snapshots.build());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to build the BTC price-action snapshot: ${msg}`);
      throw new ServiceUnavailableException(`Không lấy được dữ liệu BTC từ Binance: ${msg}`);
    }

    const messages: DeepseekMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: this.buildPrompt(snapshot) },
    ];

    let result: BtcDaytradeResult;
    try {
      const reply = await this.client.chat(messages, { temperature: 0.2 });
      const { prose, signal } = this.parseAnswer(reply.content, snapshot);
      this.logger.log(
        `DeepSeek BTC day-trade signal: ${signal?.direction ?? 'unparsed'} ` +
          `(${reply.model}, ${reply.usage?.totalTokens ?? '?'} tokens` +
          `${signal?.warnings.length ? `, ${signal.warnings.length} warning(s)` : ''})`,
      );
      result = {
        analysis: prose,
        signal,
        reasoning: reply.reasoning,
        model: reply.model,
        generatedAt: new Date().toISOString(),
        snapshot,
        usage: reply.usage,
      };
    } catch (err) {
      const msg = this.describeError(err);
      this.logger.error(`DeepSeek BTC day-trade analysis failed: ${msg}`);
      throw new ServiceUnavailableException(`DeepSeek không phản hồi được: ${msg}`);
    }

    const chart = await this.renderChart(result, candles);
    return this.archive.save(result, chart);
  }

  /** Today's stored analysis (Vietnam calendar day), or null before the first run. */
  today(): Promise<StoredDaytradeAnalysis | null> {
    return this.archive.today();
  }

  /** One stored day, by its `YYYY-MM-DD` key in Vietnam time. */
  byDate(date: string): Promise<StoredDaytradeAnalysis | null> {
    return this.archive.findByDate(date);
  }

  history(limit?: number): Promise<DaytradeHistoryItem[]> {
    return this.archive.history(limit);
  }

  /** Draw the 4H + 15m chart. Never throws — a missing chart must not sink the answer. */
  private async renderChart(
    result: BtcDaytradeResult,
    candles: Record<string, Candle[]>,
  ): Promise<Buffer | null> {
    try {
      return await renderBtcDaytradeChart({
        snapshot: result.snapshot,
        candles,
        signal: result.signal,
        capturedLabel: this.vnLabel(result.snapshot.capturedAt),
      });
    } catch (err) {
      this.logger.warn(`Failed to render the BTC day-trade chart: ${(err as Error).message}`);
      return null;
    }
  }

  /** `DD/MM/YYYY HH:mm` in Vietnam time, for the chart header. */
  private vnLabel(iso: string): string {
    const vn = new Date(new Date(iso).getTime() + 7 * 3600_000);
    const p = (n: number) => String(n).padStart(2, '0');
    return (
      `${p(vn.getUTCDate())}/${p(vn.getUTCMonth() + 1)}/${vn.getUTCFullYear()} ` +
      `${p(vn.getUTCHours())}:${p(vn.getUTCMinutes())}`
    );
  }

  /** Render the snapshot as the plain-text block the model reads. */
  private buildPrompt(s: BtcPaSnapshot): string {
    return [
      `Thời điểm chụp dữ liệu: ${s.capturedAt} (UTC). Nguồn: Binance spot ${s.symbol}.`,
      '',
      '### DỮ LIỆU',
      '',
      'Giá hiện tại:',
      `- ${s.symbol}: ${fmtUsd(s.price)} | 24h ${fmtPct(s.change24hPct)} | H24 ${fmtUsd(s.high24h)} / L24 ${fmtUsd(s.low24h)}`,
      s.forming
        ? `- Nến 15m đang chạy (CHƯA ĐÓNG): O ${fmtUsd(s.forming.open)} H ${fmtUsd(s.forming.high)} L ${fmtUsd(s.forming.low)} C ${fmtUsd(s.forming.close)}`
        : '',
      '',
      ...s.timeframes.flatMap((tf) => this.timeframeBlock(tf)),
      '### YÊU CẦU',
      'Đọc top-down 1D → 4H → 1H → 15m bằng price action, trend line và Fibonacci, rồi đưa ra một tín hiệu',
      'day trading BTC theo đúng định dạng đã quy định (khối JSON trước, phần giải thích markdown sau).',
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  /** One timeframe's price action, as the model sees it. */
  private timeframeBlock(tf: TimeframeReport): string[] {
    const structureVi = {
      uptrend: 'TĂNG (đỉnh sau cao hơn, đáy sau cao hơn)',
      downtrend: 'GIẢM (đỉnh sau thấp hơn, đáy sau thấp hơn)',
      range: 'ĐI NGANG / chưa rõ',
    }[tf.structure];

    return [
      `Khung ${tf.label} — ${tf.role} (số liệu tính trên nến đã đóng lúc ${tf.closedAt}):`,
      `- Nến cuối: đóng ${fmtUsd(tf.close)} (${fmtPct(tf.changePct)})`,
      `- Cấu trúc: ${structureVi} — pivot gần nhất: ${tf.structureNote}`,
      `- Chuỗi pivot gần nhất: ${
        tf.pivots.length > 0
          ? tf.pivots.map((p) => `${p.label} ${fmtUsd(p.price)} (${p.time})`).join(' → ')
          : 'n/a'
      }`,
      `- Swing ${SWING_LOOKBACK} nến: cao ${fmtUsd(tf.swingHigh)} / thấp ${fmtUsd(tf.swingLow)} (biên ${fmtNum(tf.swingRangePct)}% giá)`,
      `- Hỗ trợ ngang: ${fmtLevels(tf.supports)} | Kháng cự ngang: ${fmtLevels(tf.resistances)}`,
      ...this.trendLineLines(tf),
      ...this.fibLines(tf.fib),
      `- ${tf.recentCandles.length} nến gần nhất (O/H/L/C, volume — volume trung bình ${VOLUME_AVG_LOOKBACK} nến khung này: ${fmtNum(tf.avgVolume, 1)}):`,
      ...tf.recentCandles.map(
        (c) =>
          `  · ${c.time}: ${fmtUsd(c.open)} / ${fmtUsd(c.high)} / ${fmtUsd(c.low)} / ${fmtUsd(c.close)} | vol ${fmtNum(c.volume, 1)}`,
      ),
      '',
    ];
  }

  /** Both trend lines, or an explicit "none" so the model does not assume one exists. */
  private trendLineLines(tf: TimeframeReport): string[] {
    if (tf.trendLines.length === 0) return ['- Trend line: chưa đủ pivot để vẽ'];
    return tf.trendLines.map((line: TrendLine) => {
      const name = line.kind === 'support' ? 'Trend line dưới (nối 2 đáy)' : 'Trend line trên (nối 2 đỉnh)';
      const state = line.broken ? 'ĐÃ GÃY (có nến đóng xuyên qua)' : 'còn hiệu lực';
      return (
        `- ${name}: qua ${fmtUsd(line.from.price)} (${line.from.time}) → ${fmtUsd(line.to.price)} (${line.to.time}); ` +
        `hiện ở ${fmtUsd(line.priceNow)}, giá ${fmtPct(line.distancePct)} so với đường, ` +
        `độ dốc ${fmtUsd(line.slopePerBar)}/nến, chạm lại ${line.touches} lần, ${state}`
      );
    });
  }

  /** The fib leg and its levels — the anchor points are given so the model can sanity-check them. */
  private fibLines(fib: FibRetracement | null): string[] {
    if (!fib) return ['- Fibonacci: chân sóng gần nhất quá nhỏ, không vẽ'];
    const leg = fib.legDirection === 'up' ? 'tăng (đáy → đỉnh)' : 'giảm (đỉnh → đáy)';
    return [
      `- Fibonacci chân sóng ${leg}: ${fmtUsd(fib.from.price)} (${fib.from.time}) → ${fmtUsd(fib.to.price)} (${fib.to.time}), ` +
        `biên ${fmtNum(fib.legSizePct)}%; giá đã hồi ${fmtNum(fib.retracedPct)}% chân sóng` +
        `${fib.nearest ? `, gần mốc ${fib.nearest.ratio} (${fmtUsd(fib.nearest.price)}) nhất` : ''}`,
      `  · Retracement: ${fib.retracements.map((l) => `${l.ratio} ${fmtUsd(l.price)}`).join(' | ')}`,
      `  · Extension (mục tiêu): ${fib.extensions.map((l) => `${l.ratio} ${fmtUsd(l.price)}`).join(' | ')}`,
    ];
  }

  /**
   * Split the answer into the JSON setup and the prose. The block is stripped
   * from the markdown because the UI renders the setup as a card — showing the
   * raw JSON above it would just be the same thing twice.
   */
  private parseAnswer(
    content: string,
    snapshot: BtcPaSnapshot,
  ): { prose: string; signal: DaytradeSignal | null } {
    const fenced = content.match(/```json\s*([\s\S]*?)```/i);
    const raw = fenced?.[1] ?? this.firstJsonObject(content);
    if (!raw) {
      // Not fatal: the explanation is still worth reading, the card is just absent.
      this.logger.warn('DeepSeek answer had no JSON signal block');
      return { prose: content.trim(), signal: null };
    }

    const prose = (fenced ? content.replace(fenced[0], '') : content.replace(raw, '')).trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      this.logger.warn(`DeepSeek signal block is not valid JSON: ${(err as Error).message}`);
      return { prose, signal: null };
    }

    return { prose, signal: this.toSignal(parsed, snapshot) };
  }

  /** Brace-matched fallback for when the model forgets the ```json fence. */
  private firstJsonObject(content: string): string | null {
    const start = content.indexOf('{');
    if (start === -1) return null;
    let depth = 0;
    for (let i = start; i < content.length; i++) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}' && --depth === 0) return content.slice(start, i + 1);
    }
    return null;
  }

  /** Normalise the model's JSON, then run the deterministic checks over it. */
  private toSignal(parsed: Record<string, unknown>, snapshot: BtcPaSnapshot): DaytradeSignal {
    const direction = String(parsed.direction ?? '')
      .toUpperCase()
      .replace(/[\s-]/g, '_');
    const entry = (parsed.entry ?? {}) as Record<string, unknown>;
    const entryFrom = toNumber(entry.from ?? parsed.entryFrom);
    const entryTo = toNumber(entry.to ?? parsed.entryTo) ?? entryFrom;
    const takeProfits = (Array.isArray(parsed.takeProfits) ? parsed.takeProfits : [])
      .map(toNumber)
      .filter((n): n is number => n != null);

    const signal: DaytradeSignal = {
      direction: direction === 'LONG' || direction === 'SHORT' ? direction : 'NO_TRADE',
      confidence: this.toConfidence(parsed.confidence),
      entryFrom,
      entryTo,
      stopLoss: toNumber(parsed.stopLoss),
      takeProfits,
      riskRewardModel: toNumber(parsed.riskReward),
      riskReward: null,
      riskPct: null,
      timeframeBias: this.toBias(parsed.timeframeBias),
      invalidation: this.toText(parsed.invalidation),
      summary: this.toText(parsed.summary),
      warnings: [],
    };

    return this.verify(signal, snapshot);
  }

  private toConfidence(v: unknown): Confidence | null {
    const s = String(v ?? '').toLowerCase();
    return s === 'high' || s === 'medium' || s === 'low' ? s : null;
  }

  private toBias(v: unknown): Partial<Record<string, TimeframeBias>> {
    if (!v || typeof v !== 'object') return {};
    const out: Partial<Record<string, TimeframeBias>> = {};
    for (const [tf, bias] of Object.entries(v as Record<string, unknown>)) {
      const s = String(bias ?? '').toLowerCase();
      if (s === 'bullish' || s === 'bearish' || s === 'neutral') out[tf] = s;
    }
    return out;
  }

  private toText(v: unknown): string | null {
    const s = typeof v === 'string' ? v.trim() : '';
    return s.length > 0 ? s : null;
  }

  /**
   * Deterministic hard checks — the same idea as the analysis pipeline's checks
   * after the LLM validator. The model's own risk/reward is not trusted: it is
   * recomputed from the prices it gave, and the two are compared. Failures are
   * reported as warnings rather than dropping the signal, because a setup with a
   * stop in the wrong place is still useful to see — as long as it is labelled.
   */
  private verify(signal: DaytradeSignal, snapshot: BtcPaSnapshot): DaytradeSignal {
    if (signal.direction === 'NO_TRADE') return signal;

    const warnings: string[] = [];
    const { entryFrom, entryTo, stopLoss } = signal;

    const tp1 = signal.takeProfits[0];
    if (entryFrom == null || stopLoss == null || tp1 == null) {
      warnings.push('Model không đưa đủ giá vào lệnh / SL / TP — không kiểm tra được setup.');
      return { ...signal, warnings };
    }

    const entryMid = (entryFrom + (entryTo ?? entryFrom)) / 2;
    const long = signal.direction === 'LONG';

    if (long ? stopLoss >= entryMid : stopLoss <= entryMid) {
      warnings.push(
        `SL ${fmtUsd(stopLoss)} nằm sai phía so với điểm vào ${fmtUsd(entryMid)} cho lệnh ${signal.direction}.`,
      );
    }
    const badTps = signal.takeProfits.filter((tp) => (long ? tp <= entryMid : tp >= entryMid));
    if (badTps.length > 0) {
      warnings.push(`TP ${badTps.map((t) => fmtUsd(t)).join(', ')} nằm sai phía so với điểm vào.`);
    }

    const risk = Math.abs(entryMid - stopLoss);
    const reward = Math.abs(tp1 - entryMid);
    const riskReward = risk > 0 ? reward / risk : null;
    const riskPct = entryMid > 0 ? (risk / entryMid) * 100 : null;

    if (riskReward != null && riskReward < MIN_RISK_REWARD) {
      warnings.push(
        `R/R thực tế tới TP1 chỉ ${fmtNum(riskReward)} — dưới ngưỡng ${MIN_RISK_REWARD} của chính quy tắc.`,
      );
    }
    if (
      riskReward != null &&
      signal.riskRewardModel != null &&
      Math.abs(riskReward - signal.riskRewardModel) > 0.2 * Math.max(riskReward, 1)
    ) {
      warnings.push(
        `Model khai R/R ${fmtNum(signal.riskRewardModel)} nhưng tính từ giá của nó ra ${fmtNum(riskReward)}.`,
      );
    }

    const structural = this.structuralStop(snapshot, long, entryMid);
    if (structural && (long ? stopLoss > structural.level : stopLoss < structural.level)) {
      warnings.push(
        `SL ${fmtUsd(stopLoss)} chưa ra ngoài ${structural.source} ${fmtUsd(structural.level)} — ` +
          'còn nằm trong cấu trúc, dễ bị quét trước khi setup thật sự sai.',
      );
    }

    const tpPct = entryMid > 0 ? (reward / entryMid) * 100 : 0;
    if (tpPct <= ROUND_TRIP_FEE_PCT * 3) {
      warnings.push(
        `TP1 chỉ cách điểm vào ${fmtNum(tpPct)}% — quá mỏng so với phí khứ hồi ${ROUND_TRIP_FEE_PCT}%.`,
      );
    }

    const distancePct = snapshot.price > 0 ? ((entryMid - snapshot.price) / snapshot.price) * 100 : 0;
    if (Math.abs(distancePct) > MAX_ENTRY_DISTANCE_PCT) {
      warnings.push(
        `Vùng vào lệnh cách giá hiện tại ${fmtPct(distancePct)} — là lệnh chờ, không vào được ngay.`,
      );
    }

    return { ...signal, riskReward, riskPct, warnings };
  }

  /**
   * The structural level a stop has to sit beyond: the nearest 15m pivot level on
   * the far side of the entry, falling back to the 15m swing extreme when the
   * entry is already past every pivot. This replaces the old ATR distance check —
   * with no indicators in the snapshot, "far enough" is defined by structure, not
   * by a volatility band, which is also the rule the prompt states.
   */
  private structuralStop(
    snapshot: BtcPaSnapshot,
    long: boolean,
    entryMid: number,
  ): { level: number; source: string } | null {
    const entryTf = snapshot.timeframes.find((tf) => tf.timeframe === '15m');
    if (!entryTf) return null;

    const pivots = long
      ? entryTf.supports.filter((s) => s < entryMid)
      : entryTf.resistances.filter((r) => r > entryMid);

    const nearest = long ? Math.max(...pivots) : Math.min(...pivots);
    if (pivots.length > 0 && Number.isFinite(nearest)) {
      return { level: nearest, source: long ? 'mốc hỗ trợ 15m gần nhất' : 'mốc kháng cự 15m gần nhất' };
    }

    const swing = long ? entryTf.swingLow : entryTf.swingHigh;
    if (!Number.isFinite(swing) || (long ? swing >= entryMid : swing <= entryMid)) return null;
    return { level: swing, source: long ? `đáy swing ${SWING_LOOKBACK} nến 15m` : `đỉnh swing ${SWING_LOOKBACK} nến 15m` };
  }

  private describeError(err: unknown): string {
    const res = (err as { response?: { status?: number; data?: { error?: { message?: string } } } })?.response;
    if (res?.status === 401) return 'DEEPSEEK_API_KEY không hợp lệ (401)';
    if (res?.status === 402) return 'Tài khoản DeepSeek hết số dư (402)';
    if (res?.status === 429) return 'DeepSeek đang giới hạn tần suất (429) — thử lại sau ít phút';
    const detail = res?.data?.error?.message;
    if (detail) return `${detail}${res?.status ? ` (${res.status})` : ''}`;
    return err instanceof Error ? err.message : String(err);
  }
}
