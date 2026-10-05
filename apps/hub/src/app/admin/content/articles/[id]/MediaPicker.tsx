'use client';

// Media library panel for the article editor. Three jobs:
//
//   1. Upload a new image (multipart form against uploadMediaAction).
//      Surfaces upload progress, errors, and file-type / size
//      validation at the client edge too so Luke doesn't wait on a
//      pointless round trip.
//   2. List existing media attached to the article (featured + inline).
//   3. Offer three affordances per image: "insert inline" (writes an
//      <img> + optional <figcaption> back through the onInsertInline
//      callback into the editor), "make featured" / "clear featured",
//      and "edit alt/caption/attribution".

import { useId, useRef, useState, useTransition } from 'react';
import {
  uploadMediaAction,
  updateMediaMetaAction,
  setFeaturedMediaAction,
  detachMediaFromArticleAction,
} from './media-actions';

export interface ArticleMediaItem {
  id: string;
  publicUrl: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  caption: string | null;
  attribution: string | null;
  roles: Array<'featured' | 'og' | 'inline'>;
}

export interface MediaPickerProps {
  articleId: string;
  media: ArticleMediaItem[];
  featuredMediaId: string | null;
  onInsertInline: (opts: { url: string; alt: string | null; caption: string | null; mediaId: string }) => void;
  /** Called when a media mutation lands so the parent can clear its
   *  "dirty" state hint for things it owns. */
  onMediaChanged?: () => void;
}

// Keep in sync with ALLOWED_MIME in src/server/content/media.ts.
// SVG is excluded — stored XSS risk on a public same-origin bucket.
const CLIENT_MIME_WHITELIST = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
];
const CLIENT_MAX_BYTES = 15 * 1024 * 1024;

export function MediaPicker({ articleId, media, featuredMediaId, onInsertInline, onMediaChanged }: MediaPickerProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [, start] = useTransition();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const inputId = useId();

  const handleFileChange = async (file: File | null) => {
    if (!file) return;
    setUploadError(null);
    if (!CLIENT_MIME_WHITELIST.includes(file.type)) {
      setUploadError(`Unsupported file type (${file.type}). Allowed: JPG, PNG, WebP, GIF, AVIF.`);
      return;
    }
    if (file.size > CLIENT_MAX_BYTES) {
      setUploadError(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB (max 15 MB).`);
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set('articleId', articleId);
      fd.set('file', file);
      const r = await uploadMediaAction(fd);
      if (!r.ok || !r.media) {
        setUploadError(r.error ?? 'upload failed');
        return;
      }
      onMediaChanged?.();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <section style={{ border: '1px solid #E6E6E6', borderRadius: 6, padding: 10 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h3 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#333', margin: 0 }}>
          Media library ({media.length})
        </h3>
        <label htmlFor={inputId} style={{
          padding: '3px 8px', fontSize: 11, border: '1px solid #1A1A1A',
          background: '#1A1A1A', color: '#fff', borderRadius: 4,
          cursor: uploading ? 'wait' : 'pointer', opacity: uploading ? 0.6 : 1,
        }}>
          {uploading ? 'Uploading…' : '+ Upload image'}
        </label>
        <input
          id={inputId}
          ref={fileInputRef}
          type="file"
          accept={CLIENT_MIME_WHITELIST.join(',')}
          onChange={(e) => void handleFileChange(e.currentTarget.files?.[0] ?? null)}
          disabled={uploading}
          style={{ display: 'none' }}
        />
      </header>

      {uploadError && (
        <div style={{ padding: 6, background: '#FFEAEA', border: '1px solid #F5B5B5', color: '#8A1C27', fontSize: 11, borderRadius: 4, marginBottom: 8 }}>
          {uploadError}
        </div>
      )}

      {media.length === 0 ? (
        <div style={{ fontSize: 12, color: '#777' }}>
          No media uploaded for this article yet. Images uploaded here can be inserted into the body or set as the featured image.
        </div>
      ) : (
        <ul style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, listStyle: 'none', padding: 0, margin: 0 }}>
          {media.map((m) => {
            const isFeatured = featuredMediaId === m.id || m.roles.includes('featured');
            return (
              <li
                key={m.id}
                style={{
                  border: isFeatured ? '2px solid #0A5BB7' : '1px solid #E6E6E6',
                  borderRadius: 6, padding: 6, background: '#fff',
                  display: 'flex', flexDirection: 'column', gap: 4,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.publicUrl}
                  alt={m.altText ?? m.fileName}
                  style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 4, background: '#F3F3F3' }}
                />
                <div style={{ fontSize: 10, color: '#555', wordBreak: 'break-word' }}>
                  {m.fileName}
                  {m.width && m.height ? <span style={{ color: '#999' }}> · {m.width}×{m.height}</span> : null}
                </div>
                {isFeatured && (
                  <div style={{ fontSize: 10, color: '#0A5BB7', fontWeight: 700 }}>Featured</div>
                )}
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    style={smallBtn}
                    onClick={() =>
                      onInsertInline({
                        url: m.publicUrl,
                        alt: m.altText,
                        caption: m.caption,
                        mediaId: m.id,
                      })
                    }
                  >
                    Insert
                  </button>
                  {isFeatured ? (
                    <button
                      type="button"
                      style={smallBtn}
                      onClick={() =>
                        start(async () => {
                          await setFeaturedMediaAction(articleId, null);
                          onMediaChanged?.();
                        })
                      }
                    >
                      Clear featured
                    </button>
                  ) : (
                    <button
                      type="button"
                      style={smallBtn}
                      onClick={() =>
                        start(async () => {
                          await setFeaturedMediaAction(articleId, m.id);
                          onMediaChanged?.();
                        })
                      }
                    >
                      Make featured
                    </button>
                  )}
                </div>
                <details>
                  <summary style={{ fontSize: 10, color: '#777', cursor: 'pointer' }}>Meta</summary>
                  <MediaMetaForm media={m} articleId={articleId} onChanged={onMediaChanged} />
                </details>
                <button
                  type="button"
                  style={{ ...smallBtn, color: '#8A1C27', borderColor: '#F5B5B5' }}
                  onClick={() =>
                    start(async () => {
                      if (!window.confirm('Detach this image from the article? The file stays in storage.')) return;
                      await detachMediaFromArticleAction(articleId, m.id);
                      onMediaChanged?.();
                    })
                  }
                >
                  Detach
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function MediaMetaForm({
  media,
  articleId,
  onChanged,
}: {
  media: ArticleMediaItem;
  articleId: string;
  onChanged?: () => void;
}) {
  const [altText, setAltText] = useState(media.altText ?? '');
  const [caption, setCaption] = useState(media.caption ?? '');
  const [attribution, setAttribution] = useState(media.attribution ?? '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.set('mediaId', media.id);
      fd.set('articleId', articleId);
      fd.set('altText', altText);
      fd.set('caption', caption);
      fd.set('attribution', attribution);
      const r = await updateMediaMetaAction(fd);
      if (!r.ok) setMsg(r.error ?? 'error');
      else {
        setMsg('saved');
        onChanged?.();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
      <input
        placeholder="Alt text (describes the image)"
        value={altText}
        onChange={(e) => setAltText(e.currentTarget.value)}
        style={metaInput}
      />
      <input
        placeholder="Caption"
        value={caption}
        onChange={(e) => setCaption(e.currentTarget.value)}
        style={metaInput}
      />
      <input
        placeholder="Attribution / credit"
        value={attribution}
        onChange={(e) => setAttribution(e.currentTarget.value)}
        style={metaInput}
      />
      <button type="button" style={smallBtn} onClick={() => void save()} disabled={saving}>
        {saving ? 'Saving…' : 'Save meta'}
      </button>
      {msg && <span style={{ fontSize: 10, color: msg === 'saved' ? '#0A6B2A' : '#8A1C27' }}>{msg}</span>}
    </div>
  );
}

const smallBtn: React.CSSProperties = {
  padding: '3px 6px',
  fontSize: 10,
  background: '#fff',
  color: '#1A1A1A',
  border: '1px solid #D4D4D4',
  borderRadius: 4,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const metaInput: React.CSSProperties = {
  padding: '3px 6px',
  fontSize: 11,
  border: '1px solid #D4D4D4',
  borderRadius: 4,
  fontFamily: 'inherit',
};
