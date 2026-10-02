import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp, TOKENS, v1 } from './helpers.js';

/** The response contract every client relies on: one success shape, one error shape. */
describe('API contract', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  it('wraps a single resource as { success, data, meta.requestId }', async () => {
    const res = await http().get(v1('/me')).set('Authorization', `Bearer ${TOKENS.alice}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { id: expect.any(String), email: 'alice@example.com', name: 'Alice Andersson' },
      meta: { requestId: expect.any(String) },
    });
    expect(res.headers['x-request-id']).toBe(res.body.meta.requestId);
  });

  it('puts pagination in meta for list endpoints', async () => {
    const res = await http().get(v1('/products?pageSize=5&page=2')).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.meta).toEqual({
      page: 2,
      pageSize: 5,
      total: expect.any(Number),
      totalPages: Math.ceil(res.body.meta.total / 5),
      requestId: expect.any(String),
    });
  });

  it('exposes products through a response DTO (money object, no raw cents column)', async () => {
    const res = await http().get(v1('/products?q=Northwave ANC')).expect(200);
    const p = res.body.data[0];
    expect(p.price).toEqual({ amountCents: 19900, currency: 'USD', formatted: '$199.00' });
    expect(p.inStock).toBe(true);
    expect(p).not.toHaveProperty('priceCents');
    expect(p).not.toHaveProperty('currency');
  });

  it('returns validation failures as VALIDATION_FAILED with field-level details', async () => {
    const res = await http()
      .post(v1('/orders'))
      .set('Authorization', `Bearer ${TOKENS.alice}`)
      .send({ items: [{ productId: 'x', quantity: 0 }], hacked: true })
      .expect(400);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: expect.arrayContaining([
          { field: 'hacked', messages: ['property hacked should not exist'] },
          { field: 'items.0.quantity', messages: ['quantity must not be less than 1'] },
        ]),
        requestId: expect.any(String),
      },
    });
  });

  it('returns domain errors with a specific code', async () => {
    const res = await http().get(v1('/products/nope')).expect(404);
    expect(res.body.error).toMatchObject({
      code: 'PRODUCT_NOT_FOUND',
      requestId: expect.any(String),
    });
  });

  it('uses the same error envelope for auth failures and unknown routes', async () => {
    const auth = await http().get(v1('/orders')).expect(401);
    expect(auth.body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
    const route = await http().get(v1('/nope')).expect(404);
    expect(route.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('keeps business routes under /api/v1 only', async () => {
    await http().get('/products').expect(404);
  });

  it('only echoes a well-formed x-request-id', async () => {
    const ok = await http().get('/health').set('x-request-id', 'trace-123');
    expect(ok.body.meta.requestId).toBe('trace-123');
    const bad = await http().get('/health').set('x-request-id', 'x'.repeat(500));
    expect(bad.body.meta.requestId).not.toBe('x'.repeat(500));
  });

  it('reports health with version, uptime and dependency checks', async () => {
    const res = await http().get('/health').expect(200);
    expect(res.body.data).toEqual({
      status: 'ok',
      version: expect.stringMatching(/^\d+\.\d+\.\d+/),
      uptimeSeconds: expect.any(Number),
      timestamp: expect.any(String),
      checks: { database: { status: 'up', latencyMs: expect.any(Number) } },
    });
  });
});
