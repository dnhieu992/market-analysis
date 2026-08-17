import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { DeepseekClient, type DeepseekMessage } from './deepseek.client';
import {
  MarketSnapshotService,
  MIN_MOVER_VOLUME_USD,
  type MarketSnapshot,
  type MarketTicker,
} from './market-snapshot.service';

/**
 * The "Market Today" agent behind the /deepseek page's Analyze button.
 *
 * The split is deliberate: `MarketSnapshotService` produces the numbers and
 * DeepSeek only writes *about* them. The model has no live data, so any figure
 * it is not handed is a figure it would invent — the prompt says so explicitly,
 * and the snapshot is returned to the UI alongside the prose so the trader can
 * check every claim against the source.
 */

export type MarketAnalysisResult = {
  /** Markdown written by DeepSeek. */
  analysis: string;
  /** Chain of thought — only present when the model thought before answering. */
  reasoning: string | null;
  model: string;
  generatedAt: string;
  /** The exact data the model was given, for the table under the prose. */
  snapshot: MarketSnapshot;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
};

export type DeepseekStatus = {
  configured: boolean;
  model: string;
};

const SYSTEM_PROMPT = [
  'Bạn là một analyst thị trường crypto, viết bản tin thị trường bằng TIẾNG VIỆT cho một trader cá nhân.',
  '',
  'QUY TẮC BẮT BUỘC:',
  '- CHỈ dùng số liệu trong phần DỮ LIỆU được cung cấp. Tuyệt đối KHÔNG bịa giá, không bịa vốn hoá,',
  '  không bịa tin tức, không nhắc tới sự kiện nào mà dữ liệu không có.',
  '- Nếu một thông tin không có trong dữ liệu (tin tức, dòng tiền ETF, thanh lý, funding rate...),',
  '  hãy nói thẳng là "dữ liệu không có" thay vì suy đoán.',
  '- Dữ liệu là ảnh chụp 24h gần nhất từ Binance spot, không phải toàn thị trường.',
  '- Không đưa lời khuyên tài chính chắc nịch; nêu kịch bản kèm điều kiện.',
  '',
  'ĐỊNH DẠNG TRẢ LỜI (markdown, ngắn gọn, không lặp lại nguyên bảng số liệu):',
  '## Tổng quan',
  'Ba đến bốn câu: hôm nay thị trường xanh hay đỏ, dẫn dắt bởi coin nào, độ rộng thị trường nói lên điều gì.',
  '## Coin dẫn dắt',
  'Nhận xét BTC/ETH: biến động 24h so với 7 ngày và 30 ngày, đang mạnh hay yếu hơn phần còn lại.',
  '## Điểm đáng chú ý',
  'Gạch đầu dòng: các coin tăng/giảm mạnh nhất và điều đó gợi ý gì (dòng tiền đầu cơ, xả hàng, luân chuyển nhóm).',
  '## Rủi ro & kịch bản',
  'Gạch đầu dòng: 2-3 kịch bản kèm điều kiện xác nhận cụ thể theo số liệu đang có.',
].join('\n');

/** Compact USD formatting for the prompt (so the model reads clean numbers). */
function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return 'n/a';
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return `$${n.toPrecision(4)}`;
}

/** Signed percent with an explicit sign, so direction survives the prompt. */
function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function tickerLine(t: MarketTicker): string {
  return `- ${t.coin}: ${fmtUsd(t.price)} | 24h ${fmtPct(t.change24hPct)} | vol ${fmtUsd(t.volumeUsd)} | H ${fmtUsd(t.high24h)} / L ${fmtUsd(t.low24h)}`;
}

@Injectable()
export class DeepseekService {
  private readonly logger = new Logger(DeepseekService.name);

  constructor(
    private readonly client: DeepseekClient,
    private readonly snapshots: MarketSnapshotService,
  ) {}

  /** Whether the page can run an agent at all, and which model it would use. */
  status(): DeepseekStatus {
    return { configured: this.client.isConfigured(), model: this.client.model };
  }

  /**
   * Run the market agent: snapshot the market, ask DeepSeek to write the brief,
   * return both. Fails with 503 rather than a half-answer — a market brief with
   * no data behind it is worse than no brief.
   */
  async analyzeMarket(): Promise<MarketAnalysisResult> {
    if (!this.client.isConfigured()) {
      throw new ServiceUnavailableException(
        'Chưa cấu hình DEEPSEEK_API_KEY — thêm key vào .env rồi khởi động lại API.',
      );
    }

    let snapshot: MarketSnapshot;
    try {
      snapshot = await this.snapshots.build();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to build the market snapshot: ${msg}`);
      throw new ServiceUnavailableException(`Không lấy được dữ liệu thị trường từ Binance: ${msg}`);
    }

    const messages: DeepseekMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: this.buildPrompt(snapshot) },
    ];

    try {
      const reply = await this.client.chat(messages);
      this.logger.log(
        `DeepSeek market analysis done (${reply.model}, ${reply.usage?.totalTokens ?? '?'} tokens, ` +
          `${snapshot.breadth.pairs} pairs)`,
      );
      return {
        analysis: reply.content,
        reasoning: reply.reasoning,
        model: reply.model,
        generatedAt: new Date().toISOString(),
        snapshot,
        usage: reply.usage,
      };
    } catch (err) {
      const msg = this.describeError(err);
      this.logger.error(`DeepSeek market analysis failed: ${msg}`);
      throw new ServiceUnavailableException(`DeepSeek không phản hồi được: ${msg}`);
    }
  }

  /** Render the snapshot as the plain-text block the model reads. */
  private buildPrompt(s: MarketSnapshot): string {
    const b = s.breadth;
    return [
      `Thời điểm chụp dữ liệu: ${s.capturedAt} (UTC). Nguồn: Binance spot, thống kê 24h trượt.`,
      '',
      '### DỮ LIỆU',
      '',
      'Coin vốn hoá lớn:',
      ...s.majors.map(tickerLine),
      '',
      'Xu hướng nhiều khung thời gian:',
      ...s.anchors.map(
        (a) =>
          `- ${a.coin}: ${fmtUsd(a.price)} | 24h ${fmtPct(a.change24hPct)} | 7d ${fmtPct(a.change7dPct)} | 30d ${fmtPct(a.change30dPct)}`,
      ),
      '',
      'Độ rộng thị trường (toàn bộ cặp USDT trên Binance spot, đã loại stablecoin và token đòn bẩy):',
      `- Số cặp: ${b.pairs} | Tăng: ${b.advancing} | Giảm: ${b.declining} | Đứng giá: ${b.unchanged}`,
      `- Tỷ lệ cặp tăng giá: ${fmtPct(b.advancingPct)}`,
      `- Tổng khối lượng 24h: ${fmtUsd(b.totalVolumeUsd)}`,
      '',
      `Tăng mạnh nhất 24h (chỉ tính cặp có khối lượng ≥ ${fmtUsd(MIN_MOVER_VOLUME_USD)}):`,
      ...s.topGainers.map(tickerLine),
      '',
      'Giảm mạnh nhất 24h (cùng điều kiện khối lượng):',
      ...s.topLosers.map(tickerLine),
      '',
      '### YÊU CẦU',
      'Viết bản tin thị trường crypto hôm nay theo đúng cấu trúc đã quy định.',
    ].join('\n');
  }

  /** Turn an axios/DeepSeek failure into something a trader can act on. */
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
