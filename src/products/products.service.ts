import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../common/prisma.module.js';
import type { Prisma } from '../generated/prisma/client.js';
import type {
  CreateProductDto,
  ListProductsQueryDto,
  UpdateProductDto,
} from './dto/product.dto.js';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListProductsQueryDto) {
    const { q, category, minPriceCents, maxPriceCents, inStock, page, pageSize } = query;
    const contains = (value: string) => ({ contains: value, mode: 'insensitive' as const });

    // ponytail: ILIKE scan is fine for a few thousand rows; add pg_trgm/full-text index beyond that.
    const where: Prisma.ProductWhereInput = {
      active: true,
      ...(category && { category: { equals: category, mode: 'insensitive' } }),
      ...(inStock && { stock: { gt: 0 } }),
      ...((minPriceCents !== undefined || maxPriceCents !== undefined) && {
        priceCents: { gte: minPriceCents, lte: maxPriceCents },
      }),
      ...(q && {
        OR: [
          { name: contains(q) },
          { description: contains(q) },
          { brand: contains(q) },
          { category: contains(q) },
        ],
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async get(id: string) {
    const product = await this.prisma.product.findFirst({ where: { id, active: true } });
    if (!product) {
      throw new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        message: `Product ${id} not found`,
      });
    }
    return product;
  }

  async categories(): Promise<string[]> {
    const rows = await this.prisma.product.findMany({
      where: { active: true },
      distinct: ['category'],
      select: { category: true },
      orderBy: { category: 'asc' },
    });
    return rows.map((r) => r.category);
  }

  create(dto: CreateProductDto) {
    return this.prisma.product.create({ data: { ...dto, currency: dto.currency?.toUpperCase() } });
  }

  /** Stock moves by a conditional relative update, so it can't go negative or lose concurrent sales. */
  async update(id: string, { stockDelta, ...dto }: UpdateProductDto) {
    return this.prisma.$transaction(async (tx) => {
      if (stockDelta) {
        const { count } = await tx.product.updateMany({
          where: { id, stock: { gte: -stockDelta } },
          data: { stock: { increment: stockDelta } },
        });
        if (count === 0) {
          await tx.product.findUniqueOrThrow({ where: { id } }); // 404 if missing
          throw new ConflictException({
            code: 'INSUFFICIENT_STOCK',
            message: 'Stock adjustment would make stock negative',
          });
        }
      }
      return tx.product.update({
        where: { id },
        data: { ...dto, currency: dto.currency?.toUpperCase() },
      });
    });
  }
}
