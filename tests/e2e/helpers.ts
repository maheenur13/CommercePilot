import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import type {
  ChatMessage,
  Completion,
  ToolChoice,
  ToolSpec,
} from '../../src/assistant/llm.client.js';
import { LlmClient } from '../../src/assistant/llm.client.js';
import { PrismaService } from '../../src/common/prisma.module.js';

type Step = Completion | ((messages: ChatMessage[]) => Completion);

/** Fake model: plays back scripted steps in order and records every request it receives. */
export class ScriptedLlm {
  readonly requests: { messages: ChatMessage[]; tools: ToolSpec[]; toolChoice: ToolChoice }[] = [];
  private steps: Step[] = [];

  script(...steps: Step[]): this {
    this.steps = steps;
    this.requests.length = 0;
    return this;
  }

  complete(
    messages: ChatMessage[],
    tools: ToolSpec[],
    toolChoice: ToolChoice = 'auto',
  ): Promise<Completion> {
    // Mirror the real API's contract so a request it would reject fails here too.
    if (tools.length === 0)
      throw new Error('ScriptedLlm: empty tools array is rejected by the API');
    this.requests.push({ messages: structuredClone(messages), tools, toolChoice });
    const step = this.steps.shift();
    if (!step) throw new Error('ScriptedLlm: no step left');
    return Promise.resolve(typeof step === 'function' ? step(messages) : step);
  }
}

export const say = (content: string): Completion => ({ content, toolCalls: [] });
export const callTool = (name: string, args: unknown, id = `call_${name}`): Completion => ({
  content: null,
  toolCalls: [
    {
      id,
      type: 'function',
      function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
    },
  ],
});

export const ADMIN_KEY = 'test-admin-key-0123456789';
export const TOKENS = {
  alice: 'demo-alice-7f3k9q2m5x8v1b4n',
  bob: 'demo-bob-2p6r8t0w3y5u7i9o',
} as const;

/** Prefix for versioned business routes. */
export const v1 = (path: string) => `/api/v1${path}`;

/** `llm` replaces the real model client (see `ScriptedLlm`); never call a real model in tests. */
export async function createApp(opts: { llm?: unknown } = {}): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (opts.llm) builder = builder.overrideProvider(LlmClient).useValue(opts.llm);
  const moduleRef = await builder.compile();
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

export const toolMessages = (messages: ChatMessage[]) =>
  messages.filter((m): m is Extract<ChatMessage, { role: 'tool' }> => m.role === 'tool');

/**
 * A fresh app per suite. The chat route allows 20 requests/min per client, so each suite stays
 * under that budget instead of all chat tests sharing one throttler counter.
 */
export function chatHarness() {
  const h = {
    app: undefined as unknown as INestApplication,
    prisma: undefined as unknown as PrismaService,
  };
  const llm = new ScriptedLlm();
  const chat = (body: object, token?: string) => {
    const req = request(h.app.getHttpServer()).post(v1('/assistant/chat'));
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  };
  beforeAll(async () => {
    h.app = await createApp({ llm });
    h.prisma = h.app.get(PrismaService);
  });
  afterAll(() => h.app.close());
  beforeEach(() => llm.script());
  return { h, llm, chat };
}
