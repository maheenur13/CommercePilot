import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';

export const ADMIN_KEY = 'test-admin-key-0123456789';
export const TOKENS = {
  alice: 'demo-alice-7f3k9q2m5x8v1b4n',
  bob: 'demo-bob-2p6r8t0w3y5u7i9o',
} as const;

/** Prefix for versioned business routes. */
export const v1 = (path: string) => `/api/v1${path}`;

export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

export interface TestProduct {
  id: string;
  sku: string;
  stock: number;
  price: { amountCents: number; currency: string; formatted: string };
}

/** Creates an isolated product so stock-mutating tests never interfere with each other. */
export async function createProduct(
  app: INestApplication,
  overrides: Record<string, unknown> = {},
): Promise<TestProduct> {
  const res = await request(app.getHttpServer())
    .post(v1('/admin/products'))
    .set('x-admin-key', ADMIN_KEY)
    .send({
      sku: `TEST-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Test Widget',
      category: 'Test',
      priceCents: 1000,
      stock: 5,
      ...overrides,
    })
    .expect(201);
  return res.body.data;
}
