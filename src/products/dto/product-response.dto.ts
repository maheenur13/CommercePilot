import { type MoneyDto, toMoney } from '../../common/http/money.js';
import type { Product } from '../../generated/prisma/client.js';

export class ProductResponseDto {
  id!: string;
  sku!: string;
  name!: string;
  description!: string;
  category!: string;
  brand!: string | null;
  price!: MoneyDto;
  stock!: number;
  /** Derived convenience flag: `stock > 0`. */
  inStock!: boolean;
  attributes!: Record<string, unknown>;
  active!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}

export function toProductResponse(p: Product): ProductResponseDto {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    description: p.description,
    category: p.category,
    brand: p.brand,
    price: toMoney(p.priceCents, p.currency),
    stock: p.stock,
    inStock: p.stock > 0,
    attributes: (p.attributes ?? {}) as Record<string, unknown>,
    active: p.active,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
