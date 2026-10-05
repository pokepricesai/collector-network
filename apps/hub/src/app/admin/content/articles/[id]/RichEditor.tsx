'use client';

// TipTap-based rich-text editor for Collector Network OS articles.
//
// Owner responsibilities:
//   * Pass initialHtml ONCE on mount — the editor is the source of
//     truth after that. Do not re-sync.
//   * Receive onChange(html) on every document update.
//   * Hold a ref to this component to insert media at the saved
//     selection without the editor needing focus.
//
// This component owns:
//   * Toolbar (paragraph / H2 / H3 / bold / italic / link / list /
//     quote / insert image).
//   * Selection tracking so that an insert-media call from outside
//     the editor (e.g. from the media picker, which steals focus
//     before clicking Insert) lands at the user's last cursor
//     position, not at the end of the document.
//   * A custom MediaFigure node extension for figure/img/figcaption
//     with a data-media-id attribute (round-trips through save).

import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { MediaFigure } from './MediaFigure';

export interface RichEditorProps {
  initialHtml: string;
  onChange: (html: string) => void;
  onRequestInsertImage: () => void;
  placeholder?: string;
}

export interface RichEditorHandle {
  /** Insert a <figure data-media-id> at the last-known selection.
   *  The caller does not need the editor to be focused — selection
   *  is restored from the saved blur position. */
  insertFigure: (attrs: {
    mediaId: string;
    src: string;
    alt?: string | null;
    caption?: string | null;
  }) => void;
}

export const RichEditor = forwardRef<RichEditorHandle, RichEditorProps>(function RichEditor(
  { initialHtml, onChange, onRequestInsertImage, placeholder },
  ref,
) {
  // Saved selection — written on every blur so an Insert click from
  // the sidebar picker (which steals focus from the editor) still
  // knows where the cursor was. Null until the editor is focused
  // for the first time; in that case we insert at the document end
  // on the first media insert.
  const savedSelectionRef = useRef<{ from: number; to: number } | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        codeBlock: false,
        code: false,
        strike: false,
        horizontalRule: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        protocols: ['http', 'https'],
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Placeholder.configure({ placeholder: placeholder ?? 'Write…' }),
      MediaFigure,
    ],
    content: initialHtml || '',
    editorProps: {
      attributes: {
        class: 'rich-editor-surface',
        spellcheck: 'true',
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    onBlur: ({ editor }) => {
      const { from, to } = editor.state.selection;
      savedSelectionRef.current = { from, to };
    },
    onSelectionUpdate: ({ editor }) => {
      // Keep the saved selection fresh while focused too — if the
      // editor was focused and the user clicked a toolbar button
      // (which does not blur), we still want the current cursor.
      if (editor.isFocused) {
        const { from, to } = editor.state.selection;
        savedSelectionRef.current = { from, to };
      }
    },
    // Important for SSR + hydration stability. Without this the
    // editor can be constructed twice during React's strict-mode
    // double invocation, which has been observed to flash scroll on
    // mount.
    immediatelyRender: false,
  });

  // Expose an imperative insert API. We intentionally do NOT re-sync
  // via a setContent effect on `initialHtml` changes — doing so would
  // destroy the editor's selection and scroll state on every parent
  // state change, which was the root cause of the previous "page
  // jumps to top" symptom.
  useImperativeHandle(
    ref,
    (): RichEditorHandle => ({
      insertFigure(attrs) {
        if (!editor) return;
        const docSize = editor.state.doc.content.size;
        const saved = savedSelectionRef.current;
        // Clamp the saved position to the current doc size (defensive
        // against stale selections after an edit).
        const pos = saved
          ? Math.min(Math.max(0, saved.from), docSize)
          : docSize;

        editor
          .chain()
          // Place the cursor at the saved position. {scrollIntoView:
          // false} is critical — otherwise focus() would scroll the
          // selection into view and could shift the viewport.
          .focus(pos, { scrollIntoView: false })
          .insertContentAt(pos, { type: 'mediaFigure', attrs })
          .run();
      },
    }),
    [editor],
  );

  const setLink = useCallback(() => {
    if (!editor) return;
    const prev = editor.getAttributes('link')['href'] as string | undefined;
    const url = window.prompt('Link URL (https://…). Clear to remove.', prev ?? '');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus(undefined, { scrollIntoView: false }).extendMarkRange('link').unsetLink().run();
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      window.alert('Links must start with http:// or https://.');
      return;
    }
    editor
      .chain()
      .focus(undefined, { scrollIntoView: false })
      .extendMarkRange('link')
      .setLink({ href: url })
      .run();
  }, [editor]);

  if (!editor) {
    return <div style={{ padding: 12, color: '#777', fontSize: 12 }}>Loading editor…</div>;
  }

  return (
    <div style={{ border: '1px solid #D4D4D4', borderRadius: 6, display: 'flex', flexDirection: 'column', minHeight: 420 }}>
      <Toolbar editor={editor} onRequestInsertImage={onRequestInsertImage} onSetLink={setLink} />
      <div style={{ padding: '12px 14px', flex: 1 }}>
        <EditorContent editor={editor} />
      </div>
      <RichEditorStyles />
    </div>
  );
});

function Toolbar({
  editor,
  onRequestInsertImage,
  onSetLink,
}: {
  editor: Editor;
  onRequestInsertImage: () => void;
  onSetLink: () => void;
}) {
  // All toolbar commands use focus({ scrollIntoView: false }) so
  // clicking a button never jerks the viewport back to the top.
  const noScrollFocus = { scrollIntoView: false } as const;
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        flexWrap: 'wrap',
        padding: '6px 8px',
        borderBottom: '1px solid #E6E6E6',
        background: '#FAFAFA',
      }}
      // Prevent mousedown from blurring the editor before the command
      // runs. Without this, every toolbar click would blur the
      // contenteditable, lose the selection, and only then run the
      // command — which TipTap would run against a de-selected doc.
      onMouseDown={(e) => e.preventDefault()}
    >
      <ToolbarBtn label="Paragraph" active={editor.isActive('paragraph')} onClick={() => editor.chain().focus(undefined, noScrollFocus).setParagraph().run()} />
      <ToolbarBtn label="H2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus(undefined, noScrollFocus).toggleHeading({ level: 2 }).run()} />
      <ToolbarBtn label="H3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus(undefined, noScrollFocus).toggleHeading({ level: 3 }).run()} />
      <Divider />
      <ToolbarBtn label="B" active={editor.isActive('bold')} onClick={() => editor.chain().focus(undefined, noScrollFocus).toggleBold().run()} style={{ fontWeight: 700 }} />
      <ToolbarBtn label="I" active={editor.isActive('italic')} onClick={() => editor.chain().focus(undefined, noScrollFocus).toggleItalic().run()} style={{ fontStyle: 'italic' }} />
      <ToolbarBtn label="Link" active={editor.isActive('link')} onClick={onSetLink} />
      <Divider />
      <ToolbarBtn label="• List" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus(undefined, noScrollFocus).toggleBulletList().run()} />
      <ToolbarBtn label="1. List" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus(undefined, noScrollFocus).toggleOrderedList().run()} />
      <ToolbarBtn label="Quote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus(undefined, noScrollFocus).toggleBlockquote().run()} />
      <Divider />
      <ToolbarBtn label="Insert image…" onClick={onRequestInsertImage} />
    </div>
  );
}

function ToolbarBtn({
  label,
  active = false,
  onClick,
  style,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 8px',
        fontSize: 11,
        background: active ? '#1A1A1A' : '#fff',
        color: active ? '#fff' : '#1A1A1A',
        border: '1px solid #D4D4D4',
        borderRadius: 4,
        cursor: 'pointer',
        fontFamily: 'inherit',
        ...style,
      }}
    >
      {label}
    </button>
  );
}

function Divider() {
  return <span aria-hidden style={{ width: 1, background: '#D4D4D4', margin: '0 4px' }} />;
}

function RichEditorStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
          .rich-editor-surface { font-size: 15px; line-height: 1.65; color: #1a1a1a; outline: none; min-height: 320px; font-family: inherit; }
          .rich-editor-surface p { margin: 0 0 12px; }
          .rich-editor-surface h2 { font-size: 22px; margin: 20px 0 8px; letter-spacing: -0.01em; }
          .rich-editor-surface h3 { font-size: 17px; margin: 16px 0 6px; letter-spacing: -0.005em; }
          .rich-editor-surface ul, .rich-editor-surface ol { margin: 0 0 12px 20px; padding: 0; }
          .rich-editor-surface li { margin: 0 0 4px; }
          .rich-editor-surface blockquote { margin: 12px 0; padding: 0 14px; border-left: 3px solid #D4D4D4; color: #555; }
          .rich-editor-surface a { color: #0A5BB7; text-decoration: underline; }
          .rich-editor-surface img { max-width: 100%; height: auto; display: block; border-radius: 6px; margin: 8px 0; }
          .rich-editor-surface figure { margin: 12px 0; }
          .rich-editor-surface figure.ProseMirror-selectednode { outline: 2px solid #0A5BB7; border-radius: 6px; }
          .rich-editor-surface figcaption { font-size: 12px; color: #666; margin-top: 4px; }
          .rich-editor-surface p.is-editor-empty:first-child::before {
            content: attr(data-placeholder); float: left; color: #AAA; pointer-events: none; height: 0;
          }
        `,
      }}
    />
  );
}
