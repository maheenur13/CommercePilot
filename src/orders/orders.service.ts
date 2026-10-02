import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { PaginationQueryDto } from '../common/pagination.dto.js';
import { PrismaService } from '../common/prisma.module.js';
import type { Prisma } from '../generated/prisma/client.js';
import { MAX_QTY_PER_LINE, type OrderLineDto } from './dto/order.dto.js';
import { orderInclude, type OrderWithItems } from './dto/order-response.dto.js';
import type { PreparedQuote, QuoteLine } from './dto/quote-response.dto.js';

/** `Order.totalCents` is a Postgres INTEGER. */
export const MAX_ORDER_TOTAL_CENTS = 2_147_483_647;
/** How long a shopper has to confirm an assistant quote. */
export const QUOTE_TTL_MS = 10 * 60_000;

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

type PricedProduct = { id: string; priceCents: number; currency: string };

/** Unit prices from DB rows, the total, and the order's single currency. Shared by quote and place. */
export function priceLines(products: PricedProduct[], lines: OrderLineDto[]) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const currencies = new Set(products.map((p) => p.currency));
  if (currencies.size > 1) {
    throw new BadRequestException({
      code: 'MIXED_CURRENCY',
      message: 'Mixed-currency orders are not supported',
    });
  }
  const items: QuoteLine[] = lines.map(({ productId, quantity }) => ({
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
  return { items, totalCents, currency: products[0]!.currency };
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async place(customerId: string, rawLines: OrderLineDto[]): Promise<OrderWithItems> {
    return this.prisma.$transaction((tx) => this.placeIn(tx, customerId, rawLines));
  }

  /**
   * Places an order inside the caller's transaction.
   * 1. Each row is locked by a conditional decrement (`active AND stock >= qty`), so concurrent
   *    orders can never oversell or buy a product deactivated mid-flight.
   * 2. Prices are read only after the rows are locked, so the order uses the committed price.
   * Any failure rolls back everything.
   */
  private async placeIn(
    tx: Prisma.TransactionClient,
    customerId: string,
    rawLines: OrderLineDto[],
  ): Promise<OrderWithItems> {
    const lines = mergeLines(rawLines);

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
        if (!product) throw productNotFound(productId);
        throw new ConflictException({
          code: 'INSUFFICIENT_STOCK',
          message: `Insufficient stock for "${product.name}" (requested ${quantity})`,
        });
      }
    }

    const products = await tx.product.findMany({
      where: { id: { in: lines.map((l) => l.productId) } },
    });
    const { items, totalCents, currency } = priceLines(products, lines);
    return tx.order.create({
      data: { customerId, totalCents, currency, items: { create: items } },
      include: orderInclude,
    });
  }

  /**
   * Prices a would-be order and stores it as a short-lived quote. Nothing is reserved: stock is
   * only checked here and is enforced again, under lock, when the quote is confirmed.
   */
  async quote(customerId: string, rawLines: OrderLineDto[]): Promise<PreparedQuote> {
    const lines = mergeLines(rawLines);
    const products = await this.prisma.product.findMany({
      where: { id: { in: lines.map((l) => l.productId) }, active: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const { productId, quantity } of lines) {
      const p = byId.get(productId);
      if (!p) throw productNotFound(productId);
      if (p.stock < quantity) {
        throw new ConflictException({
          code: 'INSUFFICIENT_STOCK',
          message: `Only ${p.stock} of "${p.name}" in stock (requested ${quantity})`,
        });
      }
    }

    const { items, totalCents, currency } = priceLines(products, lines);
    // Housekeeping: the customer's expired, never-confirmed quotes can't be used any more.
    await this.prisma.orderQuote.deleteMany({
      where: { customerId, confirmedAt: null, expiresAt: { lt: new Date() } },
    });
    const quote = await this.prisma.orderQuote.create({
      data: {
        customerId,
        lines: items,
        totalCents,
        currency,
        expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
      },
    });
    return {
      id: quote.id,
      items: items.map((i) => ({
        ...i,
        sku: byId.get(i.productId)!.sku,
        name: byId.get(i.productId)!.name,
      })),
      totalCents,
      currency,
      expiresAt: quote.expiresAt,
    };
  }

  /**
   * Turns the caller's quote into an order, once. The claim (`confirmedAt`) row-locks the quote,
   * so a concurrent or repeated confirm waits and then gets the already-placed order back.
   * An expired quote or a price that changed since quoting rolls everything back.
   */
  async confirmQuote(
    customerId: string,
    quoteId: string,
  ): Promise<{ order: OrderWithItems; alreadyPlaced: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const quote = await tx.orderQuote.findFirst({ where: { id: quoteId, customerId } });
      if (!quote) {
        throw new NotFoundException({ code: 'QUOTE_NOT_FOUND', message: 'Quote not found' });
      }

      const { count } = await tx.orderQuote.updateMany({
        where: { id: quoteId, confirmedAt: null },
        data: { confirmedAt: new Date() },
      });
      if (count === 0) {
        const { order } = await tx.orderQuote.findUniqueOrThrow({
          where: { id: quoteId },
          select: { order: { include: orderInclude } },
        });
        // Unreachable in practice: the claim and the order link commit together.
        if (!order) {
          throw new ConflictException({
            code: 'QUOTE_ALREADY_USED',
            message: 'Quote already used',
          });
        }
        return { order, alreadyPlaced: true };
      }

      if (quote.expiresAt.getTime() <= Date.now()) {
        throw new ConflictException({
          code: 'QUOTE_EXPIRED',
          message: 'This quote has expired; ask the assistant for a new one',
        });
      }

      const quoted = quote.lines as unknown as QuoteLine[];
      const order = await this.placeIn(tx, customerId, quoted);
      const quotedPrice = new Map(quoted.map((l) => [l.productId, l.unitPriceCents]));
      const changed =
        order.currency !== quote.currency ||
        order.items.some((i) => i.unitPriceCents !== quotedPrice.get(i.productId));
      if (changed) {
        throw new ConflictException({
          code: 'PRICE_CHANGED',
          message: 'A price changed since this quote was made; ask the assistant for a new one',
        });
      }

      await tx.orderQuote.update({ where: { id: quoteId }, data: { orderId: order.id } });
      return { order, alreadyPlaced: false };
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

function productNotFound(productId: string) {
  return new NotFoundException({
    code: 'PRODUCT_NOT_FOUND',
    message: `Product ${productId} not found`,
  });
}
