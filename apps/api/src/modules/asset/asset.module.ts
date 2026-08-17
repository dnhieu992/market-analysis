import { Module } from '@nestjs/common';

import { BitgetTradeClient } from '../bitget/bitget-trade.client';
import { MexcTradeClient } from '../mexc/mexc-trade.client';
import { OkxTradeClient } from '../okx/okx-trade.client';
import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { AssetController } from './asset.controller';
import { AssetService } from './asset.service';

@Module({
  controllers: [AssetController],
  // Binance prices value the spot book and the open manual trades so /my-asset
  // can report unrealized PnL; the exchange clients read live account equity for
  // the Bitget, MEXC and OKX buckets. All three clients take their credentials
  // from env and hold no state, so plain class providers are enough.
  providers: [
    AssetService,
    BinanceMarketDataService,
    BitgetTradeClient,
    MexcTradeClient,
    OkxTradeClient,
  ],
})
export class AssetModule {}
