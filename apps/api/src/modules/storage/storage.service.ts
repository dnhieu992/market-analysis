import {
  Injectable,
  Logger,
  ServiceUnavailableException
} from '@nestjs/common';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

/** Metadata stored/returned for each uploaded object. */
export interface StoredFile {
  key: string;
  url: string;
  name: string;
  size: number;
  type: string;
}

/** A file as produced by multer (memory storage). */
export interface UploadInput {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

/**
 * Common storage service for Cloudflare R2 (S3-compatible). Reused anywhere in
 * the app that needs to store/delete binary files. Degrades safely: if the R2_*
 * env vars aren't set, uploads throw a clear 503 while the rest of the app runs.
 *
 * Reads config from `process.env` directly (same convention as UploadService).
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string;
  private readonly publicUrl: string;
  readonly enabled: boolean;

  constructor() {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    this.bucket = process.env.R2_BUCKET ?? '';
    this.publicUrl = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');

    this.enabled = !!(
      accountId &&
      accessKeyId &&
      secretAccessKey &&
      this.bucket &&
      this.publicUrl
    );

    if (!this.enabled) {
      this.logger.warn(
        'R2 storage not configured — file uploads disabled until R2_* env vars are set.'
      );
      this.client = null;
    } else {
      this.client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: accessKeyId!,
          secretAccessKey: secretAccessKey!
        }
      });
    }
  }

  private assertEnabled(): void {
    if (!this.enabled || !this.client) {
      throw new ServiceUnavailableException(
        'Image storage (Cloudflare R2) is not configured.'
      );
    }
  }

  /** Derive a safe file extension from an original filename. */
  private extOf(originalname: string): string {
    return (originalname.split('.').pop() ?? 'bin')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 8);
  }

  /**
   * Upload one file and return its public URL + metadata. Pass `key` to control
   * the object key (e.g. a human-readable path); otherwise a random
   * `uploads/<uuid>.<ext>` key is generated.
   */
  async uploadFile(file: UploadInput, key?: string): Promise<StoredFile> {
    this.assertEnabled();
    const finalKey = key ?? `uploads/${randomUUID()}.${this.extOf(file.originalname)}`;
    await this.client!.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: finalKey,
        Body: file.buffer,
        ContentType: file.mimetype
      })
    );
    return {
      key: finalKey,
      url: `${this.publicUrl}/${finalKey}`,
      name: file.originalname,
      size: file.size,
      type: file.mimetype
    };
  }

  async uploadMany(files: UploadInput[]): Promise<StoredFile[]> {
    return Promise.all(files.map((f) => this.uploadFile(f)));
  }

  /** Best-effort delete; never throws (cleanup shouldn't block the request). */
  async deleteByKey(key: string): Promise<void> {
    if (!this.enabled || !this.client || !key) return;
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
      );
    } catch (e) {
      this.logger.warn(`Failed to delete ${key} from R2: ${(e as Error).message}`);
    }
  }

  async deleteMany(keys: string[]): Promise<void> {
    await Promise.all((keys ?? []).map((k) => this.deleteByKey(k)));
  }
}
