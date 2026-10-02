import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { type AuthedCustomer, CurrentCustomer, CustomerAuthGuard } from '../common/auth/auth.js';
import { ApiEnvelope, Paginated } from '../common/http/envelope.js';
import { PaginationQueryDto } from '../common/pagination.dto.js';
import { CreateOrderDto } from './dto/order.dto.js';
import { OrderResponseDto, toOrderResponse } from './dto/order-response.dto.js';
import { OrdersService } from './orders.service.js';

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(CustomerAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** Places an order. Prices and totals are resolved server-side. */
  @Post()
  @ApiEnvelope(OrderResponseDto, { status: 201 })
  async place(
    @CurrentCustomer() customer: AuthedCustomer,
    @Body() dto: CreateOrderDto,
  ): Promise<OrderResponseDto> {
    return toOrderResponse(await this.orders.place(customer.id, dto.items));
  }

  /** The caller's orders, newest first. */
  @Get()
  @ApiEnvelope(OrderResponseDto, { paginated: true })
  async list(
    @CurrentCustomer() customer: AuthedCustomer,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<OrderResponseDto>> {
    return Paginated.of(await this.orders.listForCustomer(customer.id, query), toOrderResponse);
  }

  /** One of the caller's orders (404 for anyone else's). */
  @Get(':id')
  @ApiEnvelope(OrderResponseDto)
  async get(
    @CurrentCustomer() customer: AuthedCustomer,
    @Param('id') id: string,
  ): Promise<OrderResponseDto> {
    return toOrderResponse(await this.orders.getForCustomer(customer.id, id));
  }
}
