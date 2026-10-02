import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { PaginationQueryDto } from '../common/pagination.dto.js';
import { PrismaService } from '../common/prisma.module.js';
import { MAX_QTY_PER_LINE, type OrderLineDto } from './dto/order.dto.js';
import { orderInclude } from './dto/order-response.dto.js';

/** `Order.totalCents` is a Postgres INTEGER. */
export const MAX_ORDER_TOTAL_CENTS = 2_147_483_647;

/**
 * Collapse repeated product ids into one line so stock is checked against the real total, and
 * sort by id so concurrent orders always lock rows in the same order (no deadlocks).
 */
export function mergeLines(lines: OrderLineDto[]): OrderLineDto[] {
  const byProduct = new Map<string, number>();
  for (const { productId, quantity } of lines) {
    byProduct.set(productId, (byProduct.get(productId) ?? 0) + quantity);
  }
  return [...byProduct]
    .map(([productId, quantity]) => {
      if (quantity > MAX_QTY_PER_LINE) {
        throw new BadRequestException({
          code: 'QUANTITY_LIMIT_EXCEEDED',
          message: `Quantity for ${productId} exceeds ${MAX_QTY_PER_LINE}`,
        });
      }
      return { productId, quantity };
    })
    .sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Places an order atomically.
   * 1. Each row is locked by a conditional decrement (`active AND stock >= qty`), so concurrent
   *    orders can never oversell or buy a product deactivated mid-flight.
   * 2. Prices are read only after the rows are locked, so the order uses the committed price.
   * Any failure rolls back everything.
   */
  async place(customerId: string, rawLines: OrderLineDto[]) {
    const lines = mergeLines(rawLines);

    return this.prisma.$transaction(async (tx) => {
      for (const { productId, quantity } of lines) {
        const { count } = await tx.product.updateMany({
          where: { id: productId, active: true, stock: { gte: quantity } },
          data: { stock: { decrement: quantity } },
        });
        if (count === 0) {
          const product = await tx.product.findFirst({
            where: { id: productId, active: true },
            select: { name: true },
          });
          if (!product) {
            throw new NotFoundException({
              code: 'PRODUCT_NOT_FOUND',
              message: `Product ${productId} not found`,
            });
          }
          throw new ConflictException({
            code: 'INSUFFICIENT_STOCK',
            message: `Insufficient stock for "${product.name}" (requested ${quantity})`,
          });
        }
      }

      const products = await tx.product.findMany({
        where: { id: { in: lines.map((l) => l.productId) } },
      });
      const byId = new Map(products.map((p) => [p.id, p]));

      const currencies = new Set(products.map((p) => p.currency));
      if (currencies.size > 1) {
        throw new BadRequestException({
          code: 'MIXED_CURRENCY',
          message: 'Mixed-currency orders are not supported',
        });
      }

      const items = lines.map(({ productId, quantity }) => ({
        productId,
        quantity,
        unitPriceCents: byId.get(productId)!.priceCents,
      }));
      const totalCents = items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
      if (totalCents > MAX_ORDER_TOTAL_CENTS) {
        throw new BadRequestException({
          code: 'ORDER_TOTAL_TOO_LARGE',
          message: 'Order total exceeds the maximum allowed amount',
        });
      }

      return tx.order.create({
        data: {
          customerId,
          totalCents,
          currency: products[0]!.currency,
          items: { create: items },
        },
        include: orderInclude,
      });
    });
  }

  async listForCustomer(customerId: string, { page, pageSize }: PaginationQueryDto) {
    const where = { customerId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: orderInclude,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  /** Scoped by customer; another customer's order is reported as not found, not forbidden. */
  async getForCustomer(customerId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, customerId },
      include: orderInclude,
    });
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: `Order ${orderId} not found`,
      });
    }
    return order;
  }
}
