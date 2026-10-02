import { describe, expect, it, vi } from 'vitest';

import { citedProducts, runTool, TOOL_SPECS } from '../../src/assistant/tools.js';
import type { Product } from '../../src/generated/prisma/client.js';
import type { ProductsService } from '../../src/products/products.service.js';

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
const run = (svc: ReturnType<typeof fakeProducts>, name: string, args: unknown) =>
  runTool(svc as unknown as ProductsService, name, JSON.stringify(args));

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
  ])('rejects %s args %j without touching the catalog', async (name, args) => {
    const svc = fakeProducts();
    const out = await run(svc, name, args);
    expect(JSON.parse(out.content).error).toBe('INVALID_ARGUMENTS');
    expect(out.products).toEqual([]);
    expect(svc.list).not.toHaveBeenCalled();
    expect(svc.get).not.toHaveBeenCalled();
    expect(svc.categories).not.toHaveBeenCalled();
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

  it('matches whole terms only, not substrings of other words or SKUs', () => {
    const mug = product({ id: 'm', name: 'Mug', sku: 'TV-1' });
    expect(citedProducts('Ignore the smug marketing; TV-10 is better', [mug])).toEqual([]);
    expect(citedProducts('The mug (TV-1) is $9.', [mug]).map((p) => p.id)).toEqual(['m']);
  });
});
