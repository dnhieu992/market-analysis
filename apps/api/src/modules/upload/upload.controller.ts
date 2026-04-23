import {
  Controller,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
  BadRequestException
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiCookieAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { UploadService } from './upload.service';

@ApiTags('Upload')
@ApiCookieAuth('market_analysis_session')
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('images')
  @ApiOperation({ summary: 'Upload multiple images to Cloudinary' })
  @ApiConsumes('multipart/form-data')
  @ApiQuery({ name: 'symbol', required: false })
  @ApiQuery({ name: 'side', required: false })
  @UseInterceptors(FilesInterceptor('files', 10, { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadImages(
    @UploadedFiles() files: Express.Multer.File[],
    @Query('symbol') symbol?: string,
    @Query('side') side?: string
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files provided');
    }
    const urls = await this.uploadService.uploadImages(files, symbol, side);
    return { urls };
  }
}
