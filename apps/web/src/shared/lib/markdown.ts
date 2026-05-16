const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const htmlEsc = (s: string) => s.replace(/[&<>]/g, (c) => ESC[c] ?? c);

function applyInline(s: string): string {
  return htmlEsc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

const TH = 'background:#f3f4f6;padding:5px 10px;text-align:left;border:1px solid #d1d5db;font-weight:600;font-size:0.78rem;white-space:nowrap;';
const TD = 'padding:5px 10px;border:1px solid #e5e7eb;font-size:0.78rem;vertical-align:top;line-height:1.4;';

function renderTable(lines: string[]): string {
  const isSep = (l: string) => /^\|[-:\s|]+\|$/.test(l.trim());
  const parseRow = (l: string) =>
    l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

  const sepIdx = lines.findIndex(isSep);
  const hasHeader = sepIdx >= 1;

  let html = '<div style="overflow-x:auto;margin:8px 0;"><table style="border-collapse:collapse;width:100%;">';

  if (hasHeader) {
    html += `<thead><tr>${parseRow(lines[0]!).map((c) => `<th style="${TH}">${applyInline(c)}</th>`).join('')}</tr></thead>`;
    html += '<tbody>';
    lines.slice(sepIdx + 1).forEach((l, i) => {
      const rowStyle = i % 2 === 1 ? 'background:#f9fafb;' : '';
      html += `<tr style="${rowStyle}">${parseRow(l).map((c) => `<td style="${TD}">${applyInline(c)}</td>`).join('')}</tr>`;
    });
    html += '</tbody>';
  } else {
    html += '<tbody>';
    lines.filter((l) => !isSep(l)).forEach((l, i) => {
      const rowStyle = i % 2 === 1 ? 'background:#f9fafb;' : '';
      html += `<tr style="${rowStyle}">${parseRow(l).map((c) => `<td style="${TD}">${applyInline(c)}</td>`).join('')}</tr>`;
    });
    html += '</tbody>';
  }

  html += '</table></div>';
  return html;
}

function renderNonTable(raw: string): string {
  let s = applyInline(raw);

  s = s
    .replace(/^### (.+)$/gm, '<h3 style="margin:8px 0 3px;font-size:0.88rem;font-weight:700;">$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2 style="margin:10px 0 4px;font-size:0.95rem;font-weight:700;">$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1 style="margin:10px 0 4px;font-size:1.05rem;font-weight:700;">$1</h1>');

  s = s.replace(/^[-•] (.+)$/gm, '<li style="margin:2px 0;">$1</li>');
  s = s.replace(/(<li[^>]*>[\s\S]*?<\/li>\n?)+/g, (m) =>
    `<ul style="margin:4px 0;padding-left:1.3em;">${m}</ul>`
  );

  s = s.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br/>');
  return s;
}

export function renderMarkdown(text: string): string {
  const lines = text.split('\n');
  const segments: { table: boolean; lines: string[] }[] = [];

  for (const line of lines) {
    const isTableLine = line.trimStart().startsWith('|');
    const last = segments[segments.length - 1];
    if (last && last.table === isTableLine) {
      last.lines.push(line);
    } else {
      segments.push({ table: isTableLine, lines: [line] });
    }
  }

  return segments
    .map((seg) =>
      seg.table ? renderTable(seg.lines) : renderNonTable(seg.lines.join('\n'))
    )
    .join('');
}
