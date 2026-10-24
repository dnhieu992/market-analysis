import { Marked } from 'marked';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ESC[c] ?? c);

/**
 * GFM markdown for chat replies (tables, nested lists, headings). The text comes from the model,
 * so raw HTML is shown as text and only http(s) links are kept.
 */
const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html(html: string) {
      return escapeHtml(html);
    },
    link(href: string, _title: string | null | undefined, text: string) {
      if (!/^https?:\/\//i.test(href)) return text;
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
    image(_href: string, _title: string | null, text: string) {
      return escapeHtml(text);
    },
    // Wide tables scroll inside their own box instead of stretching the thread.
    table(header: string, body: string) {
      return `<div class="md-table"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
    },
  },
});

export function renderChatMarkdown(text: string): string {
  return marked.parse(text, { async: false }) as string;
}

