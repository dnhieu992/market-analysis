import { Module } from '@nestjs/common';
import { BitgetService } from './bitget.service';
import { BitgetWebSocketService } from './bitget-websocket.service';
import { SetupAnalyzerService } from './setup-analyzer.service';
import { SignalExecutorService } from './signal-executor.service';
import { ResultMonitorService } from './result-monitor.service';
import { DayTradingService } from './day-trading.service';

@Module({
  providers: [
    BitgetService,
    BitgetWebSocketService,
    SetupAnalyzerService,
    SignalExecutorService,
    ResultMonitorService,
    DayTradingService,
  ],
  exports: [DayTradingService],
})
export class DayTradingModule {}
