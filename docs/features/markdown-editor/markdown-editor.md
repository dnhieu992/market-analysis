## Description
A shared WYSIWYG rich-text editor component (`MarkdownEditor`) built on **TipTap v2** with the **tiptap-markdown** extension. Users type and see formatted text inline (like CKEditor/Notion) instead of raw Markdown syntax, while the value is still read/written as a **Markdown string** — keeping stored content clean and LLM-friendly. Intended to be reused anywhere the app needs rich note/comment input. First consumer: the tracking-coin Journal dialog (replaced `@uiw/react-md-editor`, which showed a split source/preview pane).

## Main Flow
1. Consumer renders `<MarkdownEditor value={markdown} onChange={setMarkdown} />`.
2. The component instantiates a TipTap editor with `StarterKit` (bold, italic, strike, headings, lists, blockquote, code block, history) + `Markdown` (serialize/parse) + optional `Placeholder`.
3. A toolbar exposes the common formatting actions; active marks/nodes are highlighted.
4. On every edit, `onUpdate` calls `editor.storage.markdown.getMarkdown()` and forwards the Markdown string to `onChange`.
5. When the parent passes a new `value` (e.g. switching journal date, reset after save), an effect calls `editor.commands.setContent(value, false)` only if it differs from the current Markdown — so typing never resets the cursor.

## Edge Cases
- **SSR/hydration**: `immediatelyRender: false` avoids Next.js App Router hydration mismatch; consumers additionally lazy-load it via `next/dynamic({ ssr: false })` to keep TipTap out of the initial route bundle.
- **External value sync loop**: the value-sync effect compares against the editor's current Markdown, so the parent→child update caused by the user's own typing is a no-op (no cursor jump).
- **Read-only**: pass `editable={false}` (toolbar hidden, content not editable); `setEditable` is also re-applied when the prop changes.
- **Empty content**: placeholder text shows via the Placeholder extension + CSS on `p.is-editor-empty:first-child`.
- **HTML input**: `Markdown.configure({ html: false })` — pasted/embedded raw HTML is not rendered as HTML, keeping output Markdown-pure.

## Related Files (FE / BE / Worker)
- `apps/web/src/shared/ui/markdown-editor/markdown-editor.tsx` — the shared `MarkdownEditor` component (TipTap + tiptap-markdown + Placeholder, toolbar, value sync)
- `apps/web/src/app/globals.css` — `.md-editor*` styles (toolbar, buttons, prose content, placeholder)
- `apps/web/src/widgets/tracking-coin-journal/tracking-coin-journal.tsx` — first consumer; lazy-loads `MarkdownEditor` via `next/dynamic`
- `apps/web/package.json` — deps `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm`, `@tiptap/extension-placeholder`, `tiptap-markdown` (removed `@uiw/react-md-editor`)
