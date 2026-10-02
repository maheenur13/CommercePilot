import { execSync } from 'node:child_process';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hashToken } from '../../src/common/auth/token.js';
import { PrismaService } from '../../src/common/prisma.module.js';
import { createApp, v1 } from './helpers.js';

const runSeed = () => execSync('pnpm prisma db seed', { env: process.env, stdio: 'ignore' });

/** The container runs the seed on every start, so re-running it must be harmless. */
describe('seed', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });
  afterAll(() => app.close());

  it('is idempotent: re-running adds no duplicate products or orders', async () => {
    const before = { products: await prisma.product.count(), orders: await prisma.order.count() };
    runSeed();
    expect(await prisma.product.count()).toBe(before.products);
    expect(await prisma.order.count()).toBe(before.orders);
  });

  it('never resets a customer token that was rotated after seeding', async () => {
    // Dan is not used by other tests, so rotating his token is isolated.
    const rotated = 'rotated-token-for-dan-0123456789';
    await prisma.customer.update({
      where: { email: 'dan@example.com' },
      data: { apiTokenHash: hashToken(rotated) },
    });

    runSeed();

    const http = request(app.getHttpServer());
    await http.get(v1('/me')).set('Authorization', `Bearer ${rotated}`).expect(200);
    await http.get(v1('/me')).set('Authorization', 'Bearer demo-dan-9a1s3d5f7g2h4j6k').expect(401);
  });
});
