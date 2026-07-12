import { Injectable } from '@nestjs/common';

import { StorageService } from '../storage/storage.service';

@Injectable()
export class UploadService {
  constructor(private readonly storage: StorageService) {}

  async uploadImages(files: Express.Multer.File[], symbol?: string, side?: string): Promise<string[]> {
    const date = this.formatDate(new Date());
    const base = symbol && side
      ? `${symbol.toUpperCase()}-${side.toLowerCase()}-${date}`
      : symbol
        ? `${symbol.toUpperCase()}-${date}`
        : date;

    const uploads = files.map((file, index) => this.uploadOne(file, base, index + 1));
    return Promise.all(uploads);
  }

  private formatDate(date: Date): string {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }

  // Upload one file to Cloudflare R2 under a human-readable key and return its
  // public URL (keeps the historical string[] contract of POST /upload/images).
  private async uploadOne(file: Express.Multer.File, base: string, seq: number): Promise<string> {
    const ext = (file.originalname.split('.').pop() ?? 'bin')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 8);
    const key = `trades/${base}-${seq}.${ext}`;
    const stored = await this.storage.uploadFile(file, key);
    return stored.url;
  }
}
