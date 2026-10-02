import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADMIN_KEY, createApp, createProduct, v1 } from './helpers.js';

describe('Products API', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  it('lists seeded products with pagination metadata', async () => {
    const res = await http().get(v1('/products?pageSize=5')).expect(200);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(48);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 5 });
  });

  it('searches case-insensitively across name and description', async () => {
    const res = await http().get(v1('/products?q=NOISE CANCELLATION')).expect(200);
    const skus = res.body.data.map((p: { sku: string }) => p.sku);
    expect(skus).toContain('AUD-HP-001');
  });

  it('filters by category, price range and stock', async () => {
    const res = await http()
      .get(v1('/products?category=audio&maxPriceCents=10000&inStock=true'))
      .expect(200);
    for (const p of res.body.data) {
      expect(p.category).toBe('Audio');
      expect(p.price.amountCents).toBeLessThanOrEqual(10000);
      expect(p.inStock).toBe(true);
    }
    expect(res.body.data.map((p: { sku: string }) => p.sku)).not.toContain('AUD-SP-004');
  });

  it('rejects invalid query params', async () => {
    await http().get(v1('/products?pageSize=1000')).expect(400);
    await http().get(v1('/products?minPriceCents=-5')).expect(400);
    await http().get(v1('/products?inStock=yes')).expect(400);
    await http().get(v1('/products?inStock=1')).expect(400);
  });

  it('returns 404 for unknown and inactive products', async () => {
    await http().get(v1('/products/does-not-exist')).expect(404);
    const p = await createProduct(app, { active: false });
    await http()
      .get(v1(`/products/${p.id}`))
      .expect(404);
  });

  it('lists categories', async () => {
    const res = await http().get(v1('/products/categories')).expect(200);
    expect(res.body.data).toEqual(expect.arrayContaining(['Audio', 'Books', 'Outdoors']));
  });

  describe('admin', () => {
    it('requires the admin key', async () => {
      await http().post(v1('/admin/products')).send({}).expect(401);
      await http().post(v1('/admin/products')).set('x-admin-key', 'nope').send({}).expect(401);
    });

    it('rejects a duplicate sku with 409', async () => {
      const p = await createProduct(app);
      await http()
        .post(v1('/admin/products'))
        .set('x-admin-key', ADMIN_KEY)
        .send({ sku: p.sku, name: 'Dup', category: 'Test', priceCents: 1, stock: 1 })
        .expect(409);
    });

    it('rejects negative price and unknown fields', async () => {
      await http()
        .post(v1('/admin/products'))
        .set('x-admin-key', ADMIN_KEY)
        .send({ sku: 'X-1', name: 'X', category: 'T', priceCents: -1, stock: 1, hacked: true })
        .expect(400);
    });

    it('adjusts stock relatively and never below zero', async () => {
      const p = await createProduct(app, { stock: 5 });
      const patch = (body: object) =>
        http()
          .patch(v1(`/admin/products/${p.id}`))
          .set('x-admin-key', ADMIN_KEY)
          .send(body);

      expect((await patch({ stockDelta: 10 }).expect(200)).body.data.stock).toBe(15);
      expect((await patch({ stockDelta: -15 }).expect(200)).body.data.stock).toBe(0);
      await patch({ stockDelta: -1 }).expect(409);
      await patch({ stock: 999 }).expect(400); // absolute overwrite is not accepted
      await http()
        .patch(v1('/admin/products/does-not-exist'))
        .set('x-admin-key', ADMIN_KEY)
        .send({ stockDelta: 1 })
        .expect(404);
    });

    it('updates a product', async () => {
      const p = await createProduct(app);
      const res = await http()
        .patch(v1(`/admin/products/${p.id}`))
        .set('x-admin-key', ADMIN_KEY)
        .send({ priceCents: 4321 })
        .expect(200);
      expect(res.body.data.price.amountCents).toBe(4321);
    });
  });
});
