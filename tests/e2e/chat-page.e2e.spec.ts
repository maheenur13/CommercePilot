import { readFileSync } from 'node:fs';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from './helpers.js';

describe('Demo chat page', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  it('serves /chat and its script with a CSP that blocks inline and third-party scripts', async () => {
    const page = await request(app.getHttpServer()).get('/chat').expect(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.text).toContain('<script src="chat.js"></script>');
    expect(page.headers['content-security-policy']).toMatch(/script-src 'self'(;|$)/);

    const script = await request(app.getHttpServer()).get('/chat.js').expect(200);
    expect(script.headers['content-type']).toMatch(/javascript/);
  });

  it('never renders model output as HTML', () => {
    const js = readFileSync('public/chat.js', 'utf8');
    expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });
});
