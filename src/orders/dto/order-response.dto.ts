import { ApiProperty } from '@nestjs/swagger';

import { MoneyDto, toMoney } from '../../common/http/money.js';
import { OrderStatus, type Prisma } from '../../generated/prisma/client.js';

export const orderInclude = {
  items: { include: { product: { select: { sku: true, name: true } } } },
} as const;

export type OrderWithItems = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export class OrderItemResponseDto {
  productId!: string;
  sku!: string;
  name!: string;
  quantity!: number;
  /** Price snapshot at purchase time. */
  unitPrice!: MoneyDto;
  lineTotal!: MoneyDto;
}

export class OrderResponseDto {
  id!: string;
  @ApiProperty({ enum: OrderStatus, example: OrderStatus.CONFIRMED })
  status!: OrderStatus;
  total!: MoneyDto;
  itemCount!: number;
  items!: OrderItemResponseDto[];
  createdAt!: Date;
}

export function toOrderResponse(o: OrderWithItems): OrderResponseDto {
  return {
    id: o.id,
    status: o.status,
    total: toMoney(o.totalCents, o.currency),
    itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
    items: o.items.map((i) => ({
      productId: i.productId,
      sku: i.product.sku,
      name: i.product.name,
      quantity: i.quantity,
      unitPrice: toMoney(i.unitPriceCents, o.currency),
      lineTotal: toMoney(i.unitPriceCents * i.quantity, o.currency),
    })),
    createdAt: o.createdAt,
  };
}
