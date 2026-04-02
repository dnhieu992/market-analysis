import { Body, Controller, Get, Inject, Param, Patch, Post } from '@nestjs/common';

import { OrdersService } from './orders.service';
import type { CloseOrderDto } from './dto/close-order.dto';
import type { CreateOrderDto } from './dto/create-order.dto';

@Controller('orders')
export class OrdersController {
  constructor(
    @Inject(OrdersService)
    private readonly ordersService: OrdersService
  ) {}

  @Get()
  listOrders() {
    return this.ordersService.listOrders();
  }

  @Get(':id')
  getOrderById(@Param('id') id: string) {
    return this.ordersService.getOrderById(id);
  }

  @Post()
  createOrder(@Body() body: CreateOrderDto) {
    return this.ordersService.createOrder(body);
  }

  @Patch(':id/close')
  closeOrder(@Param('id') id: string, @Body() body: CloseOrderDto) {
    return this.ordersService.closeOrder(id, body);
  }
}
