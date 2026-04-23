'use client';

import { useRef, useState } from 'react';

export type ImageUploadValue = {
  existingUrls: string[];
  newFiles: File[];
};

type ImageUploadProps = Readonly<{
  existingUrls?: string[];
  onChange: (value: ImageUploadValue) => void;
  uploading?: boolean;
}>;

export function ImageUpload({ existingUrls: initialUrls = [], onChange, uploading }: ImageUploadProps) {
  const [existingUrls, setExistingUrls] = useState<string[]>(initialUrls);
  const [previews, setPreviews] = useState<{ file: File; objectUrl: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  function emit(urls: string[], files: { file: File; objectUrl: string }[]) {
    onChange({ existingUrls: urls, newFiles: files.map((p) => p.file) });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const newPreviews = files.map((file) => ({
      file,
      objectUrl: URL.createObjectURL(file)
    }));
    const updated = [...previews, ...newPreviews];
    setPreviews(updated);
    emit(existingUrls, updated);

    if (inputRef.current) inputRef.current.value = '';
  }

  function removeNew(index: number) {
    const removed = previews[index];
    if (removed) URL.revokeObjectURL(removed.objectUrl);
    const updated = previews.filter((_, i) => i !== index);
    setPreviews(updated);
    emit(existingUrls, updated);
  }

  function removeExisting(url: string) {
    const updated = existingUrls.filter((u) => u !== url);
    setExistingUrls(updated);
    emit(updated, previews);
  }

  const hasImages = existingUrls.length > 0 || previews.length > 0;

  return (
    <div className="image-upload">
      {hasImages && (
        <div className="image-upload-grid">
          {existingUrls.map((url) => (
            <div key={url} className="image-upload-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="trade screenshot" />
              <button
                type="button"
                className="image-upload-remove"
                onClick={() => removeExisting(url)}
                aria-label="Remove image"
              >
                ✕
              </button>
            </div>
          ))}
          {previews.map((p, i) => (
            <div key={p.objectUrl} className="image-upload-thumb image-upload-thumb--pending">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.objectUrl} alt="pending upload" />
              <button
                type="button"
                className="image-upload-remove"
                onClick={() => removeNew(i)}
                aria-label="Remove image"
              >
                ✕
              </button>
              {uploading && <span className="image-upload-badge">uploading…</span>}
            </div>
          ))}
        </div>
      )}
      <label className="image-upload-btn">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        + Add Images
      </label>
    </div>
  );
}
