'use client';

import { useRef, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { ImageRef } from '@web/shared/api/types';

type ImageUploaderProps = Readonly<{
  value: ImageRef[];
  onChange: (images: ImageRef[]) => void;
  label?: string;
}>;

/**
 * Reusable image picker + uploader backed by Cloudflare R2. Uploads selected
 * files immediately (POST /uploads/images) and reports the resulting image refs
 * through onChange. Shows thumbnails with a remove button.
 *
 * Unlike `ImageUpload` (deferred flow — parent uploads on submit via
 * `uploadImages()`), this uploads on select and hands back full `ImageRef`s
 * (key + public url). Both paths store to Cloudflare R2.
 */
export function ImageUploader({ value, onChange, label = 'Images' }: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded = await createApiClient().uploadImagesR2(files);
      onChange([...value, ...uploaded]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function remove(key: string) {
    onChange(value.filter((img) => img.key !== key));
  }

  return (
    <div className="image-upload">
      {value.length > 0 && (
        <div className="image-upload-grid">
          {value.map((img) => (
            <div key={img.key} className="image-upload-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.name ?? 'uploaded image'} />
              <button
                type="button"
                className="image-upload-remove"
                onClick={() => remove(img.key)}
                aria-label="Remove image"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <label className="image-upload-btn">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          onChange={onSelect}
          disabled={uploading}
          style={{ display: 'none' }}
        />
        {uploading ? 'Uploading…' : `+ ${label}`}
      </label>

      {error && <p className="image-upload-error">{error}</p>}
    </div>
  );
}
