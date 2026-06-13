'use client';

import { useEffect } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';

export type MarkdownEditorProps = Readonly<{
  /** Current value as a Markdown string. */
  value: string;
  /** Called with the new Markdown string on every change. */
  onChange: (markdown: string) => void;
  placeholder?: string;
  /** Set false for a read-only renderer. Defaults to true. */
  editable?: boolean;
  /** Minimum editing-area height in px. Defaults to 220. */
  minHeight?: number;
  /** Hide the formatting toolbar (e.g. read-only usage). Defaults to false. */
  hideToolbar?: boolean;
  autofocus?: boolean;
  className?: string;
}>;

type ToolbarButton = {
  label: string;
  title: string;
  isActive?: (e: Editor) => boolean;
  run: (e: Editor) => void;
};

const TOOLBAR: ReadonlyArray<ToolbarButton | 'sep'> = [
  { label: 'B', title: 'Đậm', isActive: (e) => e.isActive('bold'), run: (e) => e.chain().focus().toggleBold().run() },
  { label: 'I', title: 'Nghiêng', isActive: (e) => e.isActive('italic'), run: (e) => e.chain().focus().toggleItalic().run() },
  { label: 'S', title: 'Gạch ngang', isActive: (e) => e.isActive('strike'), run: (e) => e.chain().focus().toggleStrike().run() },
  'sep',
  { label: 'H1', title: 'Tiêu đề 1', isActive: (e) => e.isActive('heading', { level: 1 }), run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { label: 'H2', title: 'Tiêu đề 2', isActive: (e) => e.isActive('heading', { level: 2 }), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: 'H3', title: 'Tiêu đề 3', isActive: (e) => e.isActive('heading', { level: 3 }), run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  'sep',
  { label: '• List', title: 'Danh sách', isActive: (e) => e.isActive('bulletList'), run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: '1. List', title: 'Danh sách đánh số', isActive: (e) => e.isActive('orderedList'), run: (e) => e.chain().focus().toggleOrderedList().run() },
  { label: '❝', title: 'Trích dẫn', isActive: (e) => e.isActive('blockquote'), run: (e) => e.chain().focus().toggleBlockquote().run() },
  { label: '</>', title: 'Khối code', isActive: (e) => e.isActive('codeBlock'), run: (e) => e.chain().focus().toggleCodeBlock().run() },
];

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  editable = true,
  minHeight = 220,
  hideToolbar = false,
  autofocus = false,
  className,
}: MarkdownEditorProps) {
  const editor = useEditor({
    editable,
    autofocus,
    // Next.js App Router: avoid SSR hydration mismatch.
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Markdown.configure({ html: false, linkify: true, breaks: true, transformPastedText: true }),
      ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
    ],
    content: value,
    editorProps: {
      attributes: { class: 'md-editor__content' },
    },
    onUpdate: ({ editor: e }) => {
      onChange(e.storage.markdown.getMarkdown());
    },
  });

  // Sync external value changes (date switch, reset after save) without
  // clobbering the cursor while the user is typing. When the user types, the
  // parent `value` becomes equal to the editor markdown, so this is a no-op.
  useEffect(() => {
    if (!editor) return;
    const current = editor.storage.markdown.getMarkdown();
    if (value !== current) {
      editor.commands.setContent(value, false);
    }
  }, [value, editor]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  return (
    <div className={`md-editor${className ? ` ${className}` : ''}`}>
      {editable && !hideToolbar && (
        <div className="md-editor__toolbar">
          {TOOLBAR.map((item, i) =>
            item === 'sep' ? (
              <span key={`sep-${i}`} className="md-editor__sep" aria-hidden="true" />
            ) : (
              <button
                key={item.label}
                type="button"
                className={`md-editor__btn${editor && item.isActive?.(editor) ? ' md-editor__btn--active' : ''}`}
                title={item.title}
                aria-label={item.title}
                disabled={!editor}
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => editor && item.run(editor)}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
      <EditorContent editor={editor} className="md-editor__surface" style={{ minHeight }} />
    </div>
  );
}
