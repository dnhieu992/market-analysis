import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { OrdersService } from './orders.service';
import { CloseOrderDto } from './dto/close-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { UpdateOrderDto } from './dto/update-order.dto';

@ApiTags('Orders')
@ApiCookieAuth('market_analysis_session')
@Controller('orders')
export class OrdersController {
  constructor(
    @Inject(OrdersService)
    private readonly ordersService: OrdersService
  ) {}

  // NOTE: /orders/brokers MUST come before /orders/:id to avoid route conflict
  @Get('brokers')
  @ApiOperation({ summary: 'List distinct broker names across all orders' })
  listBrokers() {
    return this.ordersService.listBrokers();
  }

  @Get()
  @ApiOperation({ summary: 'List orders with optional filter and pagination' })
  listOrders(@Query() query: ListOrdersQueryDto) {
    return this.ordersService.listOrders(query);
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

  @Patch(':id')
  @ApiOperation({ summary: 'Update an order' })
  updateOrder(@Param('id') id: string, @Body() body: UpdateOrderDto) {
    return this.ordersService.updateOrder(id, body);
  }

  @Patch(':id/close')
  @ApiOperation({ summary: 'Close an open order' })
  closeOrder(@Param('id') id: string, @Body() body: CloseOrderDto) {
    return this.ordersService.closeOrder(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an order' })
  removeOrder(@Param('id') id: string) {
    return this.ordersService.removeOrder(id);
  }
}
