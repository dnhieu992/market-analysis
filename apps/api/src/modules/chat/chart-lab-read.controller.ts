import { BadRequestException, Body, Controller, Logger, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

import { ChartLabService } from '../chart-lab/chart-lab.service';
import { ClaudeChatProvider, type ChatImage } from './providers/claude-chat.provider';

class ReadChartDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(4) @IsString({ each: true }) imageUrls!: string[];
}

export type ChartRead = {
  symbol: string | null;
  side: 'LONG' | 'SHORT' | null;
  entryZone: string | null;
  tp: number | null;
  sl: number | null;
  openedAt: string | null;
  closedAt: string | null;
  tags: string[];
  reason: string | null;
};

const SYSTEM = `You read trading screenshots (price charts from TradingView / exchanges, or order / position screens) and extract the trade's parameters for a journal form.
Reply with ONLY one JSON object, no markdown, no prose:
{"symbol": string|null, "side": "LONG"|"SHORT"|null, "entryZone": string|null, "tp": number|null, "sl": number|null, "openedAt": string|null, "closedAt": string|null, "tags": string[], "reason": string|null}
Rules:
- symbol: Binance-style pair, e.g. "BTCUSDT" (perpetual / .P / -SWAP → plain pair).
- entryZone: the entry price or zone as short text, e.g. "64,250" or "0.4120 - 0.4180". Use the order/position entry price, a drawn entry line / long-short tool box, or a marked zone.
- tp / sl: take-profit / stop-loss prices if visible (position tool box, TP/SL lines or labels, order fields). Never invent them.
- openedAt / closedAt: ISO 8601 with offset. Screens usually show Vietnam time: use +07:00 unless the image states another zone (e.g. "UTC" → Z). If only the chart's time axis is visible, use the time of the entry candle / marker. Missing year → assume the current year given below. closedAt only for a closed trade.
- tags: 0–5 lowercase-kebab technical-analysis setup tags in English you can see (e.g. "breakout", "retest", "double-top", "ema-bounce", "liquidity-sweep").
- reason: 1–3 short sentences in Vietnamese describing the setup visible on the chart (structure, levels, indicators). null if nothing meaningful is visible.
- Unknown / not visible → null. Prefer null over guessing.`;

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/,/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const iso = (v: unknown) => {
  if (typeof v !== 'string' || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** Claude reads the trade screenshots the user just uploaded in the Add dialog, to pre-fill the form. */
@ApiTags('Chart Lab')
@ApiCookieAuth('market_analysis_session')
@Controller('chart-lab')
export class ChartLabReadController {
  private readonly logger = new Logger(ChartLabReadController.name);

  constructor(
    private readonly lab: ChartLabService,
    private readonly claude: ClaudeChatProvider,
  ) {}

  @Post('read-chart')
  @ApiOperation({ summary: 'Claude reads uploaded trade screenshots (our R2 only) → suggested form values. Nothing is saved.' })
  async read(@Body() body: ReadChartDto): Promise<ChartRead> {
    const images: ChatImage[] = [];
    for (const url of body.imageUrls) images.push(await this.lab.fetchImage(url)); // throws for non-R2 URLs
    const now = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
    const reply = await this.claude.askWithImages(SYSTEM, `Now (Vietnam time): ${now}. Read ${images.length > 1 ? `these ${images.length} screenshots of the same trade` : 'this screenshot'}.`, images, {
      timeoutMs: 120_000,
    });
    const m = reply.match(/\{[\s\S]*\}/);
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(m?.[0] ?? '') as Record<string, unknown>;
    } catch {
      this.logger.warn(`read-chart: not JSON: ${reply.slice(0, 200)}`);
      throw new BadRequestException('Claude không đọc được thông số từ ảnh này');
    }
    const side = typeof j.side === 'string' ? j.side.toUpperCase() : null;
    return {
      symbol: str(j.symbol, 30)?.toUpperCase().replace(/[^A-Z0-9]/g, '') || null,
      side: side === 'LONG' || side === 'SHORT' ? side : null,
      entryZone: str(j.entryZone, 120),
      tp: num(j.tp),
      sl: num(j.sl),
      openedAt: iso(j.openedAt),
      closedAt: iso(j.closedAt),
      tags: Array.isArray(j.tags)
        ? j.tags
            .filter((t): t is string => typeof t === 'string')
            .map((t) => t.trim().toLowerCase().replace(/\s+/g, '-'))
            .filter(Boolean)
            .slice(0, 5)
        : [],
      reason: str(j.reason, 2000),
    };
  }
}
