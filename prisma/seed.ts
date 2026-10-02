/**
 * Idempotent seed: safe to run on every container start.
 * Products/customers are upserted by natural key; demo orders are only inserted into an empty DB.
 */
import 'dotenv/config';

import { readFileSync } from 'node:fs';

import { PrismaPg } from '@prisma/adapter-pg';

import { hashToken } from '../src/common/auth/token.js';
import { type OrderStatus, PrismaClient } from '../src/generated/prisma/client.js';

const load = <T>(file: string): T =>
  JSON.parse(readFileSync(new URL(`../fixtures/${file}`, import.meta.url), 'utf8')) as T;

interface ProductFixture {
  sku: string;
  name: string;
  category: string;
  brand: string;
  priceCents: number;
  stock: number;
  description: string;
  attributes: Record<string, string | number | boolean>;
}
interface CustomerFixture {
  email: string;
  name: string;
  apiToken: string;
}
interface OrderFixture {
  customer: string;
  status: OrderStatus;
  daysAgo: number;
  items: { sku: string; quantity: number }[];
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main(): Promise<void> {
  const products = load<ProductFixture[]>('products.json');
  for (const p of products) {
    await prisma.product.upsert({ where: { sku: p.sku }, create: p, update: {} });
  }

  for (const c of load<CustomerFixture[]>('customers.json')) {
    // update: {} so a restart never resets a token that an operator has rotated.
    await prisma.customer.upsert({
      where: { email: c.email },
      create: { email: c.email, name: c.name, apiTokenHash: hashToken(c.apiToken) },
      update: {},
    });
  }

  if ((await prisma.order.count()) === 0) {
    const bySku = new Map((await prisma.product.findMany()).map((p) => [p.sku, p]));
    for (const o of load<OrderFixture[]>('orders.json')) {
      const customer = await prisma.customer.findUniqueOrThrow({ where: { email: o.customer } });
      const items = o.items.map(({ sku, quantity }) => {
        const product = bySku.get(sku);
        if (!product) throw new Error(`orders.json references unknown sku ${sku}`);
        return { productId: product.id, quantity, unitPriceCents: product.priceCents };
      });
      await prisma.order.create({
        data: {
          customerId: customer.id,
          status: o.status,
          createdAt: new Date(Date.now() - o.daysAgo * 86_400_000),
          totalCents: items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0),
          items: { create: items },
        },
      });
    }
  }

  console.log(`Seeded ${products.length} products, demo customers and orders.`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
