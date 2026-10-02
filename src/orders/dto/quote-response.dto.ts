import { type MoneyDto, toMoney } from '../../common/http/money.js';
import { type OrderItemResponseDto } from './order-response.dto.js';

/** One stored quote line (`OrderQuote.lines`). A type alias so it is assignable to Prisma JSON. */
export type QuoteLine = {
  productId: string;
  quantity: number;
  unitPriceCents: number;
};

export interface PreparedQuote {
  id: string;
  items: (QuoteLine & { sku: string; name: string })[];
  totalCents: number;
  currency: string;
  expiresAt: Date;
}

export class QuoteResponseDto {
  /** Send back as `confirmQuoteId` to place the order. Only the shopper can confirm it. */
  quoteId!: string;
  items!: OrderItemResponseDto[];
  total!: MoneyDto;
  expiresAt!: Date;
}

export function toQuoteResponse(q: PreparedQuote): QuoteResponseDto {
  return {
    quoteId: q.id,
    items: q.items.map((i) => ({
      productId: i.productId,
      sku: i.sku,
      name: i.name,
      quantity: i.quantity,
      unitPrice: toMoney(i.unitPriceCents, q.currency),
      lineTotal: toMoney(i.unitPriceCents * i.quantity, q.currency),
    })),
    total: toMoney(q.totalCents, q.currency),
    expiresAt: q.expiresAt,
  };
}
