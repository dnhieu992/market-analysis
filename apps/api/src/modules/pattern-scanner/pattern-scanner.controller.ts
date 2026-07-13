import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AddCoinDto } from './dto/add-coin.dto';
import { UploadReferenceDto } from './dto/add-reference.dto';
import { ScanDto } from './dto/scan.dto';
import { PatternScannerService } from './pattern-scanner.service';

@ApiTags('Pattern Scanner')
@ApiCookieAuth('market_analysis_session')
@Controller('pattern-scanner')
export class PatternScannerController {
  constructor(
    @Inject(PatternScannerService)
    private readonly service: PatternScannerService,
  ) {}

  @Get('coins')
  @ApiOperation({ summary: 'List the pattern-scanner watchlist' })
  listCoins() {
    return this.service.listCoins();
  }

  @Post('coins')
  @ApiOperation({ summary: 'Add a coin to the watchlist' })
  addCoin(@Body() body: AddCoinDto) {
    return this.service.addCoin(body.symbol, body.name);
  }

  @Delete('coins/:symbol')
  @ApiOperation({ summary: 'Remove a coin from the watchlist' })
  removeCoin(@Param('symbol') symbol: string) {
    return this.service.removeCoin(symbol);
  }

  @Post('scan')
  @ApiOperation({ summary: 'Scan the watchlist for the selected chart patterns on-demand' })
  scan(@Body() body: ScanDto) {
    return this.service.scan(body.patterns, body.timeframe ?? '1d');
  }

  @Get('references/:pattern')
  @ApiOperation({ summary: 'List reference images for a pattern' })
  listReferences(@Param('pattern') pattern: string) {
    return this.service.listReferences(pattern);
  }

  @Post('references/upload')
  @ApiOperation({ summary: 'Upload a reference image for a pattern (multipart: file, pattern, notes?)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadReference(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadReferenceDto,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    return this.service.uploadReference(file, body.pattern, body.notes);
  }

  @Delete('references/:id')
  @ApiOperation({ summary: 'Remove a reference image (also deletes from R2)' })
  removeReference(@Param('id') id: string) {
    return this.service.removeReference(id);
  }
}
