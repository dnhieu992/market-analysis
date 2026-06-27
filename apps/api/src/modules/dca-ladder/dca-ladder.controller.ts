import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DcaLadderService } from './dca-ladder.service';
import { UpdateDcaLadderSettingsDto } from './dto/update-settings.dto';
import { FillOrderDto } from './dto/fill-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { CloseCycleDto } from './dto/close-cycle.dto';

@ApiTags('dca-ladder')
@ApiCookieAuth('market_analysis_session')
@Controller('dca-ladder')
export class DcaLadderController {
  constructor(private readonly service: DcaLadderService) {}

  @Get()
  @ApiOperation({ summary: 'Get full DCA ladder state (settings, cycle, orders, summary)' })
  getState() {
    return this.service.getState();
  }

  @Get('settings')
  @ApiOperation({ summary: 'Get DCA ladder settings' })
  getSettings() {
    return this.service.getSettings();
  }

  @Put('settings')
  @ApiOperation({ summary: 'Update DCA ladder settings' })
  updateSettings(@Body() dto: UpdateDcaLadderSettingsDto) {
    return this.service.updateSettings(dto);
  }

  @Post('orders/:id/fill')
  @ApiOperation({ summary: 'Confirm an order fill (BUY tier or TP SELL)' })
  fillOrder(@Param('id') id: string, @Body() dto: FillOrderDto) {
    return this.service.fillOrder(id, dto.fillPrice);
  }

  @Post('orders/:id/unfill')
  @ApiOperation({ summary: 'Revert an order fill' })
  unfillOrder(@Param('id') id: string) {
    return this.service.unfillOrder(id);
  }

  @Patch('orders/:id')
  @ApiOperation({ summary: 'Edit a planned or fill price' })
  updateOrder(@Param('id') id: string, @Body() dto: UpdateOrderDto) {
    return this.service.updateOrder(id, dto);
  }

  @Post('close')
  @ApiOperation({ summary: 'Confirm the TP sell, realize P&L, open the next cycle' })
  close(@Body() dto: CloseCycleDto) {
    return this.service.closeCycle(dto.sellPrice);
  }
}
