import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp, createProduct, TOKENS, v1 } from './helpers.js';

describe('Orders API', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  it('requires a valid bearer token', async () => {
    await http().get(v1('/orders')).expect(401);
    await http().get(v1('/orders')).set(as('forged-token')).expect(401);
  });

  it('returns the authenticated customer', async () => {
    const res = await http().get(v1('/me')).set(as(TOKENS.alice)).expect(200);
    expect(res.body.data.email).toBe('alice@example.com');
  });

  it('places an order using server-side prices and decrements stock', async () => {
    const p = await createProduct(app, { priceCents: 2500, stock: 5 });
    const res = await http()
      .post(v1('/orders'))
      .set(as(TOKENS.alice))
      .send({ items: [{ productId: p.id, quantity: 2 }] })
      .expect(201);

    expect(res.body.data.total.amountCents).toBe(5000);
    expect(res.body.data.items[0]).toMatchObject({
      quantity: 2,
      unitPrice: { amountCents: 2500 },
      lineTotal: { amountCents: 5000 },
    });
    const after = await http()
      .get(v1(`/products/${p.id}`))
      .expect(200);
    expect(after.body.data.stock).toBe(3);
  });

  it('ignores client-supplied prices (rejects unknown fields)', async () => {
    const p = await createProduct(app);
    await http()
      .post(v1('/orders'))
      .set(as(TOKENS.alice))
      .send({ items: [{ productId: p.id, quantity: 1, unitPriceCents: 1 }], totalCents: 1 })
      .expect(400);
  });

  it('rejects quantities outside 1..50', async () => {
    const p = await createProduct(app);
    for (const quantity of [0, -3, 51, 1.5]) {
      await http()
        .post(v1('/orders'))
        .set(as(TOKENS.alice))
        .send({ items: [{ productId: p.id, quantity }] })
        .expect(400);
    }
  });

  it('returns 409 and changes nothing when any line is out of stock', async () => {
    const plenty = await createProduct(app, { stock: 10 });
    const scarce = await createProduct(app, { stock: 1 });
    await http()
      .post(v1('/orders'))
      .set(as(TOKENS.alice))
      .send({
        items: [
          { productId: plenty.id, quantity: 2 },
          { productId: scarce.id, quantity: 2 },
        ],
      })
      .expect(409);
    const after = await http()
      .get(v1(`/products/${plenty.id}`))
      .expect(200);
    expect(after.body.data.stock).toBe(10); // rolled back
  });

  it('never oversells under concurrent orders', async () => {
    const p = await createProduct(app, { stock: 3 });
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        http()
          .post(v1('/orders'))
          .set(as(TOKENS.bob))
          .send({ items: [{ productId: p.id, quantity: 1 }] }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    const after = await http()
      .get(v1(`/products/${p.id}`))
      .expect(200);
    expect(after.body.data.stock).toBe(0);
  });

  it('never deadlocks when concurrent orders list the same products in opposite order', async () => {
    const a = await createProduct(app, { stock: 50 });
    const b = await createProduct(app, { stock: 50 });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        http()
          .post(v1('/orders'))
          .set(as(i % 2 ? TOKENS.alice : TOKENS.bob))
          .send({
            items:
              i % 2
                ? [
                    { productId: a.id, quantity: 1 },
                    { productId: b.id, quantity: 1 },
                  ]
                : [
                    { productId: b.id, quantity: 1 },
                    { productId: a.id, quantity: 1 },
                  ],
          }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(201));
  });

  it('rejects an order whose total exceeds the integer column (400, stock untouched)', async () => {
    const p = await createProduct(app, { priceCents: 100_000_000, stock: 100 });
    await http()
      .post(v1('/orders'))
      .set(as(TOKENS.alice))
      .send({ items: [{ productId: p.id, quantity: 22 }] })
      .expect(400);
    const after = await http()
      .get(v1(`/products/${p.id}`))
      .expect(200);
    expect(after.body.data.stock).toBe(100);
  });

  it('cannot buy a deactivated product', async () => {
    const p = await createProduct(app, { active: false });
    await http()
      .post(v1('/orders'))
      .set(as(TOKENS.alice))
      .send({ items: [{ productId: p.id, quantity: 1 }] })
      .expect(404);
  });

  it('paginates the order list', async () => {
    const res = await http().get(v1('/orders?pageSize=1')).set(as(TOKENS.alice)).expect(200);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 1 });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(2);
  });

  it('maps an oversized body to 413, not 500', async () => {
    await http()
      .post(v1('/orders'))
      .set(as(TOKENS.alice))
      .set('content-type', 'application/json')
      .send(JSON.stringify({ items: [], pad: 'x'.repeat(200_000) }))
      .expect(413);
  });

  it('returns 404 for unknown products', async () => {
    await http()
      .post(v1('/orders'))
      .set(as(TOKENS.alice))
      .send({ items: [{ productId: 'nope', quantity: 1 }] })
      .expect(404);
  });

  it('scopes order reads to the owner (no IDOR)', async () => {
    const p = await createProduct(app);
    const order = await http()
      .post(v1('/orders'))
      .set(as(TOKENS.alice))
      .send({ items: [{ productId: p.id, quantity: 1 }] })
      .expect(201);

    await http()
      .get(v1(`/orders/${order.body.data.id}`))
      .set(as(TOKENS.alice))
      .expect(200);
    await http()
      .get(v1(`/orders/${order.body.data.id}`))
      .set(as(TOKENS.bob))
      .expect(404);

    const bobs = await http().get(v1('/orders?pageSize=100')).set(as(TOKENS.bob)).expect(200);
    expect(bobs.body.data.map((o: { id: string }) => o.id)).not.toContain(order.body.data.id);
  });
});
