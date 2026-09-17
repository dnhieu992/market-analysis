/**
 * Manual trigger for the Bitget QQE H4 alert — run it on demand instead of
 * waiting for the H4-close cron.
 *
 * Two modes:
 *   (default)   Run the EXACT production path — BitgetQqeAlertService.checkAndAlert().
 *               Sends a Telegram only if a Setup-tab coin's just-closed 4h candle
 *               is a fresh Long/Short flip (so it may legitimately send nothing).
 *   --preview   Send a clearly-labelled "manual test" Telegram listing the CURRENT
 *               QQE regime (bull/bear) of every Setup coin, regardless of freshness.
 *               Use this to confirm the whole DB → Binance → QQE → Telegram chain
 *               works right now.
 *
 * Run (on the server, where .env has DATABASE_URL / TELEGRAM_*):
 *   pnpm --filter worker qqe:trigger              # production path
 *   pnpm --filter worker qqe:trigger -- --preview # guaranteed end-to-end test
 */
import * as path from 'node:path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

import { NestFactory } from '@nestjs/core';

import { BitgetQqeAlertModule } from '../modules/bitget-qqe-alert/bitget-qqe-alert.module';
import { BitgetQqeAlertService } from '../modules/bitget-qqe-alert/bitget-qqe-alert.service';
import { TelegramService } from '../modules/telegram/telegram.service';

async function main(): Promise<void> {
  const preview = process.argv.includes('--preview');
  const ctx = await NestFactory.createApplicationContext(BitgetQqeAlertModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const service = ctx.get(BitgetQqeAlertService);

    if (!preview) {
      // eslint-disable-next-line no-console
      console.log('[qqe:trigger] running production checkAndAlert() ...');
      await service.checkAndAlert();
      // eslint-disable-next-line no-console
      console.log('[qqe:trigger] done — check the logs above for whether anything flipped.');
      return;
    }

    // eslint-disable-next-line no-console
    console.log('[qqe:trigger] --preview: computing CURRENT QQE state per Setup coin ...');
    const states = await service.previewCurrentStates();
    if (states.length === 0) {
      // eslint-disable-next-line no-console
      console.log('[qqe:trigger] Setup tab is empty or no coin has a QQE state — nothing to send.');
      return;
    }

    const lines = states.map((s) =>
      s.state === 'long'
        ? `🟢 <b>${s.symbol}</b> — QQE hiện <b>BULL</b> (Long)`
        : `🔴 <b>${s.symbol}</b> — QQE hiện <b>BEAR</b> (Short)`,
    );
    const message = [
      '🧪 <b>QQE H4 — TEST THỦ CÔNG (không phải tín hiệu mới)</b>',
      'Trạng thái QQE hiện tại của các coin trong Setup tab:',
      '',
      ...lines,
    ].join('\n');

    const telegram = ctx.get(TelegramService);
    const res = await telegram.sendToChat(process.env.TELEGRAM_CHAT_ID ?? '', message);
    // eslint-disable-next-line no-console
    console.log(
      `[qqe:trigger] preview sent to Telegram: ${res.success ? 'OK' : 'FAILED'} — ${states
        .map((s) => `${s.symbol}:${s.state}`)
        .join(', ')}`,
    );
  } finally {
    await ctx.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[qqe:trigger] failed:', err);
    process.exit(1);
  });
