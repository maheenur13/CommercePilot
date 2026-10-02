import { ApiProperty } from '@nestjs/swagger';

import { type MoneyDto, toMoney } from '../../common/http/money.js';
import { OrderResponseDto, toOrderResponse } from '../../orders/dto/order-response.dto.js';
import { QuoteResponseDto, toQuoteResponse } from '../../orders/dto/quote-response.dto.js';
import type { ChatResult } from '../assistant.service.js';

export class CitedProductDto {
  id!: string;
  sku!: string;
  name!: string;
  /** Current catalog price from the database, not from the model's text. */
  price!: MoneyDto;
  inStock!: boolean;
}

export class ChatResponseDto {
  conversationId!: string;
  reply!: string;
  /** Products the reply mentions, limited to ones the assistant looked up this turn. */
  citedProducts!: CitedProductDto[];
  /** An order the assistant priced this turn. Nothing is placed until the shopper confirms it. */
  @ApiProperty({ type: QuoteResponseDto, nullable: true })
  pendingOrder!: QuoteResponseDto | null;
  /** The order placed by a `confirmQuoteId` request. */
  @ApiProperty({ type: OrderResponseDto, nullable: true })
  placedOrder!: OrderResponseDto | null;
}

export function toChatResponse(r: ChatResult): ChatResponseDto {
  return {
    conversationId: r.conversationId,
    reply: r.reply,
    citedProducts: r.cited.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      price: toMoney(p.priceCents, p.currency),
      inStock: p.stock > 0,
    })),
    pendingOrder: r.pendingQuote && toQuoteResponse(r.pendingQuote),
    placedOrder: r.placedOrder && toOrderResponse(r.placedOrder),
  };
}
