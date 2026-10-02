import { type MoneyDto, toMoney } from '../../common/http/money.js';
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
  };
}
