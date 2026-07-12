import {
  BadRequestException,
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiConsumes,
  ApiCookieAuth,
  ApiOperation,
  ApiTags
} from '@nestjs/swagger';

import { StorageService } from './storage.service';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_FILES = 10;
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB each

@ApiTags('uploads')
@ApiCookieAuth('market_analysis_session')
@Controller('uploads')
export class R2UploadController {
  constructor(private readonly storage: StorageService) {}

  @Post('images')
  @ApiOperation({ summary: 'Upload up to 10 images (≤5MB each) to Cloudflare R2' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, { limits: { fileSize: MAX_SIZE } })
  )
  async uploadImages(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files?.length) {
      throw new BadRequestException('No files uploaded.');
    }
    for (const f of files) {
      if (!ALLOWED_TYPES.includes(f.mimetype)) {
        throw new BadRequestException(
          `Unsupported file type: ${f.mimetype}. Allowed: ${ALLOWED_TYPES.join(', ')}.`
        );
      }
    }
    return this.storage.uploadMany(files);
  }
}
