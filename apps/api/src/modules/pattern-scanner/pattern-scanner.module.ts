import { Module } from '@nestjs/common';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { PatternScannerController } from './pattern-scanner.controller';
import { PatternScannerService } from './pattern-scanner.service';

@Module({
  providers: [PatternScannerService, BinanceMarketDataService],
  controllers: [PatternScannerController],
})
export class PatternScannerModule {}
