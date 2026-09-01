/**
 * @jest-environment jsdom
 */

/**
 * Guards the one thing that makes tables safe to offer in the toolbar: a GFM pipe
 * table typed in the editor has to come back out as the same markdown, and markdown
 * loaded into the editor has to become a real table node rather than a paragraph of
 * pipes. Everything else about tables is TipTap's problem; this round trip is ours,
 * because it is what decides whether a saved review/journal survives a re-edit.
 */
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import { Markdown } from 'tiptap-markdown';

import { renderMarkdown } from '@web/shared/lib/markdown';

function editorWith(content: string): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ html: false, linkify: true, breaks: true, transformPastedText: true }),
    ],
    content,
  });
}

const TABLE = ['| Lệnh | R |', '| --- | --- |', '| Short 78300 | -1 |', '| Long 75600 | +2 |'].join(
  '\n',
);

describe('markdown editor tables', () => {
  it('parses a pipe table into table nodes instead of a paragraph', () => {
    const editor = editorWith(TABLE);
    const json = JSON.stringify(editor.getJSON());

    expect(json).toContain('"type":"table"');
    expect(json).toContain('"type":"tableHeader"');
    expect(json).toContain('Short 78300');
    editor.destroy();
  });

  it('serializes a table back to markdown that survives another round trip', () => {
    const first = editorWith(TABLE);
    const once = (first.storage.markdown.getMarkdown() as string).trim();
    first.destroy();

    const second = editorWith(once);
    const twice = (second.storage.markdown.getMarkdown() as string).trim();
    second.destroy();

    // Re-editing a saved table must not drift: whatever the first save produced is
    // exactly what the second one does. (The editor escapes a leading `-`, so `-1`
    // is written back as `\-1` — stable, and undone by the read-only renderer.)
    expect(twice).toBe(once);
    expect(once).toContain('| Lệnh | R |');
    expect(once).toContain('| --- | --- |');
    expect(once).toContain('Short 78300');
  });

  it('renders the serialized table without the escape backslashes', () => {
    const editor = editorWith(TABLE);
    const html = renderMarkdown(editor.storage.markdown.getMarkdown() as string);
    editor.destroy();

    expect(html).toContain('<table');
    expect(html).toContain('>-1<');
    expect(html).not.toContain('\\-1');
  });

  it('keeps surrounding prose intact around a table', () => {
    const doc = `## Rút ra\n\n${TABLE}\n\nGhi chú sau bảng.`;
    const editor = editorWith(doc);
    const markdown = (editor.storage.markdown.getMarkdown() as string).trim();

    expect(markdown).toContain('## Rút ra');
    expect(markdown).toContain('| --- | --- |');
    expect(markdown.endsWith('Ghi chú sau bảng.')).toBe(true);
    editor.destroy();
  });
});
