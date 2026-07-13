import { Module } from '@nestjs/common';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { EmaStochScannerController } from './ema-stoch-scanner.controller';
import { EmaStochScannerService } from './ema-stoch-scanner.service';

@Module({
  providers: [EmaStochScannerService, BinanceMarketDataService],
  controllers: [EmaStochScannerController],
})
export class EmaStochScannerModule {}
