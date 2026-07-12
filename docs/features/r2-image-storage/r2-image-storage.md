## Description
Cloudflare R2 (S3-compatible) image storage for the API. Provides a reusable
`StorageService` and a `POST /uploads/images` endpoint that stores uploaded
images in an R2 bucket and returns their public URLs + metadata (`key`, `url`,
`name`, `size`, `type`). Ported from the personal-kb repo.

**All image uploads in the app go to Cloudflare R2.** There are two endpoints,
both backed by R2:

- `POST /uploads/images` (`modules/storage`) — returns full image refs
  (`{ key, url, name, size, type }`), so images can later be deleted by key.
  Backs the `ImageUploader` web component (immediate upload).
- `POST /upload/images` (`modules/upload`) — the historical endpoint used by the
  trade/transaction forms. Returns `{ urls: string[] }` and now routes through
  `StorageService` (previously Cloudinary). Object keys are human-readable:
  `trades/<SYMBOL>-<side>-<dd-mm-yyyy>-<n>.<ext>`. Backs the `ImageUpload`
  web component (deferred upload on form submit).

Use `/uploads/images` when you need addressable/deletable objects; use
`/upload/images` for the existing trade-screenshot flow.

## Main Flow
1. Client sends `multipart/form-data` with one or more `files` to
   `POST /uploads/images` (auth-protected by the global session-cookie guard).
2. `R2UploadController` validates each file's mimetype (jpeg/png/webp/gif) and
   size (≤5 MB each, ≤10 files); rejects with `400` otherwise.
3. `StorageService.uploadMany()` puts each file to R2 under
   `uploads/<uuid>.<ext>` via `PutObjectCommand`.
4. Returns an array of `StoredFile` refs: `{ key, url, name, size, type }`.
   `url` = `${R2_PUBLIC_URL}/${key}` — served directly from the public bucket /
   custom domain (the "get image" path is just the returned URL).
5. `StorageService.deleteByKey()` / `deleteMany()` (best-effort, never throws)
   remove objects when the owning record is deleted.

## Edge Cases
- **R2 not configured** — if any `R2_*` env var is missing, `enabled` is false;
  uploads throw a clear `503 ServiceUnavailable` and the rest of the app runs
  normally. A warning is logged once at startup.
- **No files / empty body** — `400 BadRequest`.
- **Unsupported mimetype** — `400 BadRequest` listing the allowed types.
- **Oversized file** — multer rejects at the `fileSize` limit (5 MB) before it
  reaches the handler.
- **Delete failures** — logged as a warning and swallowed; cleanup never blocks
  the request or throws.

## Frontend
- `ImageUploader` (`apps/web/src/shared/ui/image-uploader/image-uploader.tsx`) — a
  reusable picker that uploads selected files to R2 **immediately** and reports
  back `ImageRef[]` via `onChange({ value, onChange })`. Contrast with the
  existing `ImageUpload` (`shared/ui/image-upload`), which defers upload to the
  Cloudinary endpoint on form submit. Use `ImageUploader` when you want the
  parent to hold full image refs (key + public URL) as they are added.
- The client method `createApiClient().uploadImagesR2(files)` POSTs to
  `/uploads/images` and returns `ImageRef[]`.

## Related Files (FE / BE / Worker)
- `apps/web/src/shared/ui/image-uploader/image-uploader.tsx` — R2 upload component (FE)
- `apps/web/src/shared/api/client.ts` — `uploadImagesR2()` method (FE)
- `apps/web/src/shared/api/types.ts` — `ImageRef` type (FE)
- `apps/web/src/app/globals.css` — `.image-upload-error` style; reuses `.image-upload-*` classes (FE)
- `apps/api/src/modules/storage/storage.service.ts` — R2 S3 client; upload/delete logic (BE)
- `apps/api/src/modules/storage/upload.controller.ts` — `POST /uploads/images` endpoint + validation (BE)
- `apps/api/src/modules/storage/dto/image-ref.dto.ts` — `ImageRefDto` shape for attaching images to other records (BE)
- `apps/api/src/modules/storage/storage.module.ts` — `@Global()` module exporting `StorageService` (BE)
- `apps/api/src/app.module.ts` — registers `StorageModule` (BE)
- `apps/api/package.json` — adds `@aws-sdk/client-s3` dependency (BE)
- `.env.example` — documents the `R2_*` env vars
