import { Body, Controller, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { OrdersService } from './orders.service';
import { CloseOrderDto } from './dto/close-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';

@ApiTags('Orders')
@ApiCookieAuth('market_analysis_session')
@Controller('orders')
export class OrdersController {
  constructor(
    @Inject(OrdersService)
    private readonly ordersService: OrdersService
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all orders' })
  listOrders() {
    return this.ordersService.listOrders();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an order by ID' })
  getOrderById(@Param('id') id: string) {
    return this.ordersService.getOrderById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new order' })
  createOrder(@Body() body: CreateOrderDto) {
    return this.ordersService.createOrder(body);
  }

  @Patch(':id/close')
  @ApiOperation({ summary: 'Close an open order' })
  closeOrder(@Param('id') id: string, @Body() body: CloseOrderDto) {
    return this.ordersService.closeOrder(id, body);
  }
}
