import { Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

@Injectable()
export class UploadService {
  async uploadImages(files: Express.Multer.File[], symbol?: string, side?: string): Promise<string[]> {
    const date = this.formatDate(new Date());
    const base = symbol && side
      ? `${symbol.toUpperCase()}-${side.toLowerCase()}-${date}`
      : date;

    const uploads = files.map((file, index) =>
      this.uploadOne(file, `${base}-${index + 1}`)
    );
    return Promise.all(uploads);
  }

  private formatDate(date: Date): string {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }

  private uploadOne(file: Express.Multer.File, publicId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const base64 = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
      cloudinary.uploader.upload(
        base64,
        { folder: 'trades', public_id: publicId, resource_type: 'image' },
        (error, result) => {
          if (error || !result) {
            reject(error ?? new Error('Upload failed'));
          } else {
            resolve(result.secure_url);
          }
        }
      );
    });
  }
}
