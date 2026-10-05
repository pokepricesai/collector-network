'use client';

// TipTap-based rich-text editor for Collector Network OS articles.
// The parent owns:
//   * initial HTML (from body_rich.html, or markdownToEditorHtml on
//     a legacy row)
//   * the save flow (receives an onChange callback)
//   * the media picker (passes it into the "Insert image" slot)
//
// The editor itself just exposes:
//   * a toolbar (paragraph / H2 / H3 / bold / italic / link / list /
//     quote / insert image)
//   * contenteditable surface
//   * onChange firing with the current HTML after every edit
//
// Server-side sanitisation runs on save (not here) — so even if the
// editor emits something unexpected, the final persisted html is
// clean.

import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { useCallback, useEffect } from 'react';

export interface RichEditorProps {
  initialHtml: string;
  onChange: (html: string) => void;
  onRequestInsertImage: () => void;
  placeholder?: string;
}

export function RichEditor({ initialHtml, onChange, onRequestInsertImage, placeholder }: RichEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // We don't support headings above H3 or below H3. Articles
        // get their title from the page template; H1 inside the body
        // creates duplicate top-levels.
        heading: { levels: [2, 3] },
        // Hide syntax we don't support in the sanitiser.
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
      Image.configure({
        inline: false,
        allowBase64: false,
        HTMLAttributes: { loading: 'lazy' },
      }),
      Placeholder.configure({ placeholder: placeholder ?? 'Write…' }),
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
    immediatelyRender: false,
  });

  // If the parent swaps `initialHtml` (e.g. "Reset to markdown
  // source"), reflect that in the editor without clobbering focus
  // during a normal typing session.
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() === initialHtml) return;
    editor.commands.setContent(initialHtml || '', false);
  }, [editor, initialHtml]);

  if (!editor) return <div style={{ padding: 12, color: '#777', fontSize: 12 }}>Loading editor…</div>;

  return (
    <div style={{ border: '1px solid #D4D4D4', borderRadius: 6, display: 'flex', flexDirection: 'column', minHeight: 420 }}>
      <Toolbar editor={editor} onRequestInsertImage={onRequestInsertImage} />
      <div style={{ padding: '12px 14px', flex: 1 }}>
        <EditorContent editor={editor} />
      </div>
      <RichEditorStyles />
    </div>
  );
}

function Toolbar({ editor, onRequestInsertImage }: { editor: Editor; onRequestInsertImage: () => void }) {
  const setLink = useCallback(() => {
    const prev = editor.getAttributes('link')['href'] as string | undefined;
    const url = window.prompt('Link URL (https://…). Clear to remove.', prev ?? '');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      window.alert('Links must start with http:// or https://.');
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  return (
    <div style={{
      display: 'flex', gap: 4, flexWrap: 'wrap', padding: '6px 8px',
      borderBottom: '1px solid #E6E6E6', background: '#FAFAFA',
      position: 'sticky', top: 0, zIndex: 1,
    }}>
      <ToolbarBtn label="Paragraph" active={editor.isActive('paragraph')} onClick={() => editor.chain().focus().setParagraph().run()} />
      <ToolbarBtn label="H2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
      <ToolbarBtn label="H3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
      <Divider />
      <ToolbarBtn label="B" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} style={{ fontWeight: 700 }} />
      <ToolbarBtn label="I" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} style={{ fontStyle: 'italic' }} />
      <ToolbarBtn label="Link" active={editor.isActive('link')} onClick={setLink} />
      <Divider />
      <ToolbarBtn label="• List" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} />
      <ToolbarBtn label="1. List" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
      <ToolbarBtn label="Quote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
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

/**
 * Minimal styling for the editor surface. Mirrors the public article
 * typography enough that the rich surface looks like what will ship.
 * Scoped via a unique class name on the editor root.
 */
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
          .rich-editor-surface figcaption { font-size: 12px; color: #666; margin-top: 4px; }
          .rich-editor-surface p.is-editor-empty:first-child::before {
            content: attr(data-placeholder); float: left; color: #AAA; pointer-events: none; height: 0;
          }
        `,
      }}
    />
  );
}
