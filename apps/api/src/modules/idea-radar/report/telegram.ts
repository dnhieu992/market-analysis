/**
 * Telegram notifier for the weekly report: an HTML summary message + the full Markdown file as a document.
 * Uses its own target so it doesn't land in the trading chat:
 *   IDEA_RADAR_TELEGRAM_CHAT_ID    (required — empty = notifications off)
 *   IDEA_RADAR_TELEGRAM_BOT_TOKEN  (optional, falls back to TELEGRAM_BOT_TOKEN)
 */

export type TelegramTarget = { token: string; chatId: string };

export function telegramTarget(env: NodeJS.ProcessEnv = process.env): TelegramTarget | null {
  const chatId = env.IDEA_RADAR_TELEGRAM_CHAT_ID?.trim();
  const token = (env.IDEA_RADAR_TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN || '').trim();
  return chatId && token ? { token, chatId } : null;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

async function call(fetchImpl: FetchLike, t: TelegramTarget, method: string, body: BodyInit, headers?: Record<string, string>) {
  const res = await fetchImpl(`https://api.telegram.org/bot${t.token}/${method}`, {
    method: 'POST',
    body,
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  // Never include the URL (it carries the bot token) in errors.
  if (!res.ok || !json.ok) throw new Error(`Telegram ${method} failed: ${json.description ?? res.status}`);
}

export async function sendReport(
  t: TelegramTarget,
  summaryHtml: string,
  fileName: string,
  markdown: string,
  fetchImpl: FetchLike = (u, i) => fetch(u, i),
): Promise<void> {
  await call(
    fetchImpl,
    t,
    'sendMessage',
    JSON.stringify({ chat_id: t.chatId, text: summaryHtml, parse_mode: 'HTML', disable_web_page_preview: true }),
    { 'content-type': 'application/json' },
  );
  const form = new FormData();
  form.append('chat_id', t.chatId);
  form.append('document', new Blob([markdown], { type: 'text/markdown' }), fileName);
  await call(fetchImpl, t, 'sendDocument', form);
}
