## Description
A shared WYSIWYG rich-text editor component (`MarkdownEditor`) built on **TipTap v2** with the **tiptap-markdown** extension. Users type and see formatted text inline (like CKEditor/Notion) instead of raw Markdown syntax, while the value is still read/written as a **Markdown string** — keeping stored content clean and LLM-friendly. Intended to be reused anywhere the app needs rich note/comment input. First consumer: the tracking-coin Journal dialog (replaced `@uiw/react-md-editor`, which showed a split source/preview pane).

## Main Flow
1. Consumer renders `<MarkdownEditor value={markdown} onChange={setMarkdown} />`.
2. The component instantiates a TipTap editor with `StarterKit` (bold, italic, strike, headings, lists, blockquote, code block, history) + the four table extensions (`Table`/`TableRow`/`TableHeader`/`TableCell`, resizable columns) + `Markdown` (serialize/parse) + optional `Placeholder`.
3. A toolbar exposes the common formatting actions; active marks/nodes are highlighted. `▦` inserts a 3×3 table with a header row, and a second toolbar group (+/− column, +/− row, delete table) appears only while the caret is inside a table.
4. On every edit, `onUpdate` calls `editor.storage.markdown.getMarkdown()` and forwards the Markdown string to `onChange`.
5. When the parent passes a new `value` (e.g. switching journal date, reset after save), an effect calls `editor.commands.setContent(value, false)` only if it differs from the current Markdown — so typing never resets the cursor.

## Edge Cases
- **SSR/hydration**: `immediatelyRender: false` avoids Next.js App Router hydration mismatch; consumers additionally lazy-load it via `next/dynamic({ ssr: false })` to keep TipTap out of the initial route bundle.
- **External value sync loop**: the value-sync effect compares against the editor's current Markdown, so the parent→child update caused by the user's own typing is a no-op (no cursor jump).
- **Read-only**: pass `editable={false}` (toolbar hidden, content not editable); `setEditable` is also re-applied when the prop changes.
- **Empty content**: placeholder text shows via the Placeholder extension + CSS on `p.is-editor-empty:first-child`.
- **HTML input**: `Markdown.configure({ html: false })` — pasted/embedded raw HTML is not rendered as HTML, keeping output Markdown-pure.
- **Tables round-trip as GFM pipe tables.** markdown-it parses them on the way in, tiptap-markdown's own serializer writes them back out. Covered by `markdown-table.spec.ts`, which asserts a second save produces byte-identical markdown — the property that decides whether a saved note survives re-editing.
- **No merged cells.** Markdown cannot express colspan/rowspan or a multi-block cell; tiptap-markdown falls back to raw HTML for such a table, which then never parses back as a table. So merge/split commands are deliberately left off the toolbar.
- **The serializer escapes leading punctuation** — a cell holding `-1` is written as `\-1` so it cannot be read back as a list item. `renderMarkdown` strips those backslashes last (after the inline/heading/list rules), so read-only views show `-1`.

## Related Files (FE / BE / Worker)
- `apps/web/src/shared/ui/markdown-editor/markdown-editor.tsx` — the shared `MarkdownEditor` component (TipTap + tiptap-markdown + Placeholder, toolbar, value sync)
- `apps/web/src/app/globals.css` — `.md-editor*` styles (toolbar, buttons, prose content, placeholder)
- `apps/web/src/shared/ui/markdown-editor/markdown-table.spec.ts` — table parse/serialize round-trip tests (jsdom)
- `apps/web/src/shared/lib/markdown.ts` — `renderMarkdown`, the read-only counterpart (renders pipe tables, unescapes `\x`)
- `apps/web/src/widgets/tracking-coin-journal/tracking-coin-journal.tsx` — first consumer; lazy-loads `MarkdownEditor` via `next/dynamic`
- `apps/web/src/widgets/strategy-backtest/review-dialog.tsx` — setup post-mortems; the reason tables were added
- `apps/web/package.json` — deps `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm`, `@tiptap/extension-placeholder`, `@tiptap/extension-table{,-row,-header,-cell}`, `tiptap-markdown` (removed `@uiw/react-md-editor`); dev dep `jest-environment-jsdom`
