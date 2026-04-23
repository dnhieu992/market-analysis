import { Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

@Injectable()
export class UploadService {
  async uploadImages(files: Express.Multer.File[]): Promise<string[]> {
    const uploads = files.map((file) => this.uploadOne(file));
    return Promise.all(uploads);
  }

  private uploadOne(file: Express.Multer.File): Promise<string> {
    return new Promise((resolve, reject) => {
      const base64 = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
      cloudinary.uploader.upload(
        base64,
        { folder: 'trades', resource_type: 'image' },
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
