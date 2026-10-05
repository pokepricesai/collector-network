// Custom TipTap node extension for editorial media figures. Needed
// because StarterKit does not model `<figure>` + `<figcaption>` as a
// first-class block, and because we carry a `data-media-id` attribute
// that must round-trip through parse → DOM → render → save.
//
// The node is `atom: true` — the caption and alt text are stored as
// node attributes, not editable ProseMirror children. Editing caption/
// alt happens in the media picker's meta form, which is the single
// source of truth so a caption change is reflected everywhere the
// image is referenced.
//
// Portable DOM shape (what reaches the sanitiser and the public
// renderer):
//
//   <figure data-media-id="<uuid>">
//     <img src="<bucket>/..." alt="..." data-media-id="<uuid>" loading="lazy" />
//     <figcaption>caption text</figcaption>  <!-- omitted when no caption -->
//   </figure>

import { Node, mergeAttributes, type CommandProps } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mediaFigure: {
      insertMediaFigure: (attrs: {
        mediaId: string;
        src: string;
        alt?: string | null;
        caption?: string | null;
      }) => ReturnType;
    };
  }
}

export const MediaFigure = Node.create({
  name: 'mediaFigure',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  isolating: true,

  addAttributes() {
    return {
      mediaId: {
        default: null as string | null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-media-id'),
        renderHTML: (attrs) =>
          attrs['mediaId'] ? { 'data-media-id': attrs['mediaId'] as string } : {},
      },
      src: {
        default: null as string | null,
        parseHTML: (el) =>
          (el as HTMLElement).querySelector('img')?.getAttribute('src') ?? null,
        renderHTML: () => ({}),
      },
      alt: {
        default: null as string | null,
        parseHTML: (el) =>
          (el as HTMLElement).querySelector('img')?.getAttribute('alt') ?? null,
        renderHTML: () => ({}),
      },
      caption: {
        default: null as string | null,
        parseHTML: (el) => {
          const cap = (el as HTMLElement).querySelector('figcaption');
          const txt = cap?.textContent ?? null;
          return txt && txt.trim().length > 0 ? txt : null;
        },
        renderHTML: () => ({}),
      },
    };
  },

  // Only match <figure> elements that carry a data-media-id — raw
  // figures without that attribute would be user-authored decoration
  // we don't support yet. Keeping the match narrow prevents accidental
  // capture of other content.
  parseHTML() {
    return [{ tag: 'figure[data-media-id]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs as {
      mediaId: string | null;
      src: string | null;
      alt: string | null;
      caption: string | null;
    };
    const children: Array<[string, Record<string, string | number>] | [string, Record<string, string | number>, string]> = [
      [
        'img',
        {
          src: attrs.src ?? '',
          alt: attrs.alt ?? '',
          ...(attrs.mediaId ? { 'data-media-id': attrs.mediaId } : {}),
          loading: 'lazy',
        },
      ],
    ];
    if (attrs.caption) {
      children.push(['figcaption', {}, attrs.caption]);
    }
    return ['figure', mergeAttributes(HTMLAttributes), ...children];
  },

  addCommands() {
    return {
      insertMediaFigure:
        (attrs) =>
        ({ chain }: CommandProps) =>
          chain()
            .insertContent({ type: this.name, attrs })
            .run(),
    };
  },
});
