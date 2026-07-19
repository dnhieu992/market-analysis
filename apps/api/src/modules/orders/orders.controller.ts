import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { OrdersService } from './orders.service';
import { OrderJournalService } from './order-journal.service';
import { CloseOrderDto } from './dto/close-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreateOrderJournalDto } from './dto/create-order-journal.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { UpdateOrderJournalDto } from './dto/update-order-journal.dto';

@ApiTags('Orders')
@ApiCookieAuth('market_analysis_session')
@Controller('orders')
export class OrdersController {
  constructor(
    @Inject(OrdersService)
    private readonly ordersService: OrdersService,
    @Inject(OrderJournalService)
    private readonly journalService: OrderJournalService
  ) {}

  // NOTE: /orders/brokers MUST come before /orders/:id to avoid route conflict
  @Get('brokers')
  @ApiOperation({ summary: 'List distinct broker names across all orders' })
  listBrokers() {
    return this.ordersService.listBrokers();
  }

  // NOTE: /orders/journal* MUST be declared before /orders/:id to avoid route conflict
  @Get('journal')
  @ApiOperation({ summary: 'List journal notes for an order (oldest first)' })
  listJournal(@Query('orderId') orderId: string) {
    return this.journalService.list(orderId?.trim() ?? '');
  }

  @Post('journal')
  @ApiOperation({ summary: 'Add a manual journal note to an order' })
  createJournal(@Body() dto: CreateOrderJournalDto) {
    return this.journalService.create(dto);
  }

  @Put('journal/:id')
  @ApiOperation({ summary: 'Edit a manual journal note' })
  updateJournal(@Param('id') id: string, @Body() dto: UpdateOrderJournalDto) {
    return this.journalService.update(id, dto);
  }

  @Delete('journal/:id')
  @ApiOperation({ summary: 'Delete a manual journal note' })
  removeJournal(@Param('id') id: string) {
    return this.journalService.remove(id);
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
