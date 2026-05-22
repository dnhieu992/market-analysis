import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { MarketModule } from '../market/market.module';
import { ScannerController } from './scanner.controller';
import { ScannerService } from './scanner.service';

@Module({
  imports: [DatabaseModule, MarketModule],
  controllers: [ScannerController],
  providers: [ScannerService]
})
export class ScannerModule {}
