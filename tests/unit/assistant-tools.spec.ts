import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { citedProducts, runTool, type ToolContext, TOOL_SPECS } from '../../src/assistant/tools.js';
import type { Product } from '../../src/generated/prisma/client.js';
import { priceLines } from '../../src/orders/orders.service.js';

const product = (over: Partial<Product> = {}): Product => ({
  id: 'p1',
  sku: 'AUD-HP-001',
  name: 'Northwave ANC Over-Ear Headphones',
  description: 'x'.repeat(500),
  category: 'Audio',
  brand: 'Northwave',
  priceCents: 19900,
  currency: 'USD',
  stock: 3,
  attributes: {},
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

function fakeProducts() {
  return {
    list: vi.fn().mockResolvedValue({ items: [product()], total: 1, page: 1, pageSize: 10 }),
    get: vi.fn().mockResolvedValue(product()),
    categories: vi.fn().mockResolvedValue(['Audio']),
  };
}
function fakeOrders() {
  return {
    listForCustomer: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 5 }),
    getForCustomer: vi.fn(),
    quote: vi.fn(),
  };
}
const ALICE = { id: 'cust_alice', email: 'alice@example.com', name: 'Alice' };

const run = (
  svc: ReturnType<typeof fakeProducts>,
  name: string,
  args: unknown,
  orders = fakeOrders(),
  customer: ToolContext['customer'] = ALICE,
) =>
  runTool(
    { products: svc, orders, customer } as unknown as ToolContext,
    name,
    JSON.stringify(args),
  );

describe('assistant tools', () => {
  it.each([
    ['search_products', { query: 'x', customerId: 'c1' }],
    ['search_products', { query: 'x', priceCents: 1 }],
    ['search_products', { limit: 11 }],
    ['search_products', { minPriceCents: -1 }],
    ['search_products', { maxPriceCents: 9_999_999_999 }], // would overflow the INT4 column
    ['search_products', { query: 'x'.repeat(101) }],
    ['get_product', {}],
    ['get_product', { id: 'x'.repeat(65) }],
    ['list_categories', { customerId: 'c1' }],
    ['get_my_orders', { customerId: 'cust_bob' }],
    ['get_my_orders', { limit: 11 }],
    ['get_order', { id: 'o1', customerId: 'cust_bob' }],
    ['prepare_order', { items: [] }],
    ['prepare_order', { items: [{ productId: 'p1', quantity: 1 }], customerId: 'cust_bob' }],
    ['prepare_order', { items: [{ productId: 'p1', quantity: 1, priceCents: 1 }] }],
    ['prepare_order', { items: [{ productId: 'p1', quantity: 1 }], totalCents: 1 }],
    ['prepare_order', { items: [{ productId: 'p1', quantity: 0 }] }],
    ['prepare_order', { items: [{ productId: 'p1', quantity: -1 }] }],
    ['prepare_order', { items: [{ productId: 'p1', quantity: 51 }] }],
    ['prepare_order', { items: [{ productId: 'p1', quantity: 1.5 }] }],
    [
      'prepare_order',
      { items: Array.from({ length: 21 }, (_, i) => ({ productId: `p${i}`, quantity: 1 })) },
    ],
  ])('rejects %s args %j without touching any service', async (name, args) => {
    const svc = fakeProducts();
    const orders = fakeOrders();
    const out = await run(svc, name, args, orders);
    expect(JSON.parse(out.content).error).toBe('INVALID_ARGUMENTS');
    expect(out.products).toEqual([]);
    for (const fn of [...Object.values(svc), ...Object.values(orders)]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['get_my_orders', {}],
    ['get_order', { id: 'o1' }],
    ['prepare_order', { items: [{ productId: 'p1', quantity: 1 }] }],
  ])(
    'returns AUTH_REQUIRED for anonymous %s without calling the orders service',
    async (name, args) => {
      const orders = fakeOrders();
      const out = await run(fakeProducts(), name, args, orders, null);
      expect(JSON.parse(out.content).error).toBe('AUTH_REQUIRED');
      for (const fn of Object.values(orders)) expect(fn).not.toHaveBeenCalled();
    },
  );

  it('acts for the server-side customer and hides the quote id from the model', async () => {
    const orders = fakeOrders();
    const quote = {
      id: '6f1c2c3e-0000-4000-8000-000000000000',
      items: [{ productId: 'p1', sku: 'S-1', name: 'Kettle', quantity: 2, unitPriceCents: 8900 }],
      totalCents: 17800,
      currency: 'USD',
      expiresAt: new Date(),
    };
    orders.quote.mockResolvedValue(quote);
    const out = await run(
      fakeProducts(),
      'prepare_order',
      { items: [{ productId: 'p1', quantity: 2 }] },
      orders,
    );
    expect(orders.quote).toHaveBeenCalledWith(ALICE.id, [{ productId: 'p1', quantity: 2 }]);
    expect(out.quote).toBe(quote);
    expect(out.content).not.toContain(quote.id);
    expect(JSON.parse(out.content)).toMatchObject({
      total: '$178.00',
      status: 'AWAITING_SHOPPER_CONFIRMATION',
    });

    await run(fakeProducts(), 'get_my_orders', {}, orders);
    expect(orders.listForCustomer).toHaveBeenCalledWith(ALICE.id, { page: 1, pageSize: 5 });
  });

  it('turns domain errors into tool errors and rethrows unexpected ones', async () => {
    const orders = fakeOrders();
    orders.getForCustomer.mockRejectedValue(
      new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order o1 not found' }),
    );
    const out = await run(fakeProducts(), 'get_order', { id: 'o1' }, orders);
    expect(JSON.parse(out.content)).toEqual({
      error: 'ORDER_NOT_FOUND',
      message: 'Order o1 not found',
    });

    orders.getForCustomer.mockRejectedValue(new Error('db down'));
    await expect(run(fakeProducts(), 'get_order', { id: 'o1' }, orders)).rejects.toThrow('db down');
  });

  it.each(['toString', 'constructor', '__proto__', 'hasOwnProperty'])(
    'treats prototype member %s as an unknown tool',
    async (name) => {
      const out = await run(fakeProducts(), name, {});
      expect(JSON.parse(out.content).error).toBe('UNKNOWN_TOOL');
    },
  );

  it('maps search args onto the catalog query, capped at 10 results', async () => {
    const svc = fakeProducts();
    const out = await run(svc, 'search_products', { query: 'anc', inStock: true });
    expect(svc.list).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'anc', inStock: true, page: 1, pageSize: 10 }),
    );
    const body = JSON.parse(out.content);
    expect(body.products[0]).toMatchObject({ priceCents: 19900, price: '$199.00', inStock: true });
    expect(body.products[0].description).toHaveLength(300);
  });

  it('exposes strict JSON schemas without the $schema key', () => {
    for (const spec of TOOL_SPECS) {
      expect(spec.function.parameters).toMatchObject({
        type: 'object',
        additionalProperties: false,
      });
      expect(spec.function.parameters).not.toHaveProperty('$schema');
    }
  });

  it('cites only looked-up products that the reply names', () => {
    const a = product({ id: 'a', name: 'Granite Mug', sku: 'MUG-1' });
    const b = product({ id: 'b', name: 'Phantom Mug', sku: 'MUG-2' });
    expect(citedProducts('Try the granite mug or MUG-2', [a, b, a]).map((p) => p.id)).toEqual([
      'a',
      'b',
    ]);
    expect(citedProducts('Try the Unknown Mug', [a]).map((p) => p.id)).toEqual([]);
  });

  it('prices lines from DB rows and rejects mixed currencies and INT4 overflow', () => {
    const lines = [{ productId: 'a', quantity: 2 }];
    expect(priceLines([{ id: 'a', priceCents: 450, currency: 'USD' }], lines)).toEqual({
      items: [{ productId: 'a', quantity: 2, unitPriceCents: 450 }],
      totalCents: 900,
      currency: 'USD',
    });
    const mixed = [
      { id: 'a', priceCents: 1, currency: 'USD' },
      { id: 'b', priceCents: 1, currency: 'EUR' },
    ];
    expect(() => priceLines(mixed, [...lines, { productId: 'b', quantity: 1 }])).toThrow(
      'Mixed-currency',
    );
    expect(() =>
      priceLines(
        [{ id: 'a', priceCents: 100_000_000, currency: 'USD' }],
        [{ productId: 'a', quantity: 50 }],
      ),
    ).toThrow('maximum');
  });

  it('matches whole terms only, not substrings of other words or SKUs', () => {
    const mug = product({ id: 'm', name: 'Mug', sku: 'TV-1' });
    expect(citedProducts('Ignore the smug marketing; TV-10 is better', [mug])).toEqual([]);
    expect(citedProducts('The mug (TV-1) is $9.', [mug]).map((p) => p.id)).toEqual(['m']);
  });
});
