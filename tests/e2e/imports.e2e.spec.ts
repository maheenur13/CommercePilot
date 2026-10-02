import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaService } from '../../src/common/prisma.module.js';
import { ADMIN_KEY, callTool, createApp, ScriptedLlm, say, v1 } from './helpers.js';

const PORT = 47123; // must match IMPORT_ALLOWED_HOSTS in setup.ts
const BASE = `http://127.0.0.1:${PORT}`;

let dynamicCsv = '';
const server: Server = createServer((req, res) => {
  const path = req.url ?? '/';
  if (path.startsWith('/files/')) {
    const name = path.slice('/files/'.length).replace(/[^\w.-]/g, '');
    res.writeHead(200, { 'content-type': 'text/csv' });
    return res.end(readFileSync(new URL(`../../fixtures/imports/${name}`, import.meta.url)));
  }
  if (path === '/dynamic.csv') {
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8' });
    return res.end(dynamicCsv);
  }
  if (path === '/login.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<html><body>Sign in</body></html>');
  }
  if (path === '/redirect-localhost') {
    // Same server, but via a name that resolves to loopback and is not allowlisted.
    res.writeHead(302, { location: `http://localhost:${PORT}/files/clean.csv` });
    return res.end();
  }
  if (path === '/redirect-metadata') {
    res.writeHead(301, { location: 'http://169.254.169.254/latest/meta-data/' });
    return res.end();
  }
  if (path === '/huge.csv') {
    // Chunked, no content-length: the cap must be enforced while streaming.
    res.writeHead(200, { 'content-type': 'text/csv' });
    const chunk = Buffer.alloc(1024 * 1024, 'a,b\n');
    for (let i = 0; i < 6; i++) res.write(chunk);
    return res.end();
  }
  res.writeHead(404).end();
});

/**
 * A fresh app per describe block: imports allow 10 requests/min per client, so each block stays
 * under that budget instead of all of them sharing one throttler counter.
 */
function importHarness() {
  const h = {
    app: undefined as unknown as INestApplication,
    prisma: undefined as unknown as PrismaService,
  };
  const llm = new ScriptedLlm();
  const importUrl = (url: string, dryRun?: boolean) =>
    request(h.app.getHttpServer())
      .post(v1('/admin/imports'))
      .set('x-admin-key', ADMIN_KEY)
      .send({ url, ...(dryRun !== undefined && { dryRun }) });
  beforeAll(async () => {
    h.app = await createApp({ llm });
    h.prisma = h.app.get(PrismaService);
  });
  afterAll(() => h.app.close());
  beforeEach(() => llm.script());
  return { h, llm, importUrl };
}

describe('Admin imports', () => {
  beforeAll(
    () =>
      new Promise<void>((resolve, reject) => {
        server.once('error', reject); // e.g. port taken: fail fast instead of a hook timeout
        server.listen(PORT, '127.0.0.1', resolve);
      }),
  );
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  describe('auth and input', () => {
    const { h, importUrl } = importHarness();
    it('requires the admin key', async () => {
      await request(h.app.getHttpServer())
        .post(v1('/admin/imports'))
        .send({ url: `${BASE}/files/clean.csv` })
        .expect(401);
      await request(h.app.getHttpServer())
        .post(v1('/admin/imports'))
        .set('x-admin-key', 'wrong-key-wrong-key-wrong')
        .send({ url: `${BASE}/files/clean.csv` })
        .expect(401);
    });

    it.each([
      'file:///etc/passwd',
      'ftp://example.com/a.csv',
      'gopher://x',
      'not a url',
      'http://2130706433:47123/files/clean.csv', // decimal 127.0.0.1
    ])('rejects %s at validation', async (url) => {
      const res = await importUrl(url).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects unknown fields', async () => {
      await request(h.app.getHttpServer())
        .post(v1('/admin/imports'))
        .set('x-admin-key', ADMIN_KEY)
        .send({ url: `${BASE}/files/clean.csv`, priceCents: 1 })
        .expect(400);
    });
  });

  describe('SSRF guard', () => {
    const { importUrl } = importHarness();
    it.each([
      'http://localhost:47123/files/clean.csv',
      'http://127.0.0.2/x.csv',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.1/x.csv',
      'http://[::1]:47123/files/clean.csv',
      'http://[::ffff:127.0.0.1]:47123/files/clean.csv',
      `${BASE}/redirect-localhost`,
      `${BASE}/redirect-metadata`,
    ])('refuses %s', async (url) => {
      const res = await importUrl(url).expect(400);
      expect(res.body.error.code).toBe('IMPORT_URL_FORBIDDEN');
    });
  });

  describe('fetch failures', () => {
    const { h, importUrl } = importHarness();

    it('caps the body size while streaming', async () => {
      const res = await importUrl(`${BASE}/huge.csv`).expect(422);
      expect(res.body.error.code).toBe('IMPORT_TOO_LARGE');
    });

    it('rejects an HTML page (e.g. a private sheet login)', async () => {
      const res = await importUrl(`${BASE}/login.html`).expect(422);
      expect(res.body.error.code).toBe('IMPORT_NOT_CSV');
    });

    it('reports an upstream error status', async () => {
      const res = await importUrl(`${BASE}/missing.csv`).expect(422);
      expect(res.body.error.code).toBe('IMPORT_FETCH_FAILED');
    });

    it('creates no job when the fetch is refused', async () => {
      const before = await h.prisma.importJob.count();
      await importUrl('http://169.254.169.254/').expect(400);
      expect(await h.prisma.importJob.count()).toBe(before);
    });
  });

  describe('dry run', () => {
    const { h, llm, importUrl } = importHarness();
    it('is the default: previews without writing', async () => {
      const skus = ['IMPDEMO-101', 'IMPDEMO-102', 'IMPDEMO-103'];
      await h.prisma.product.deleteMany({ where: { sku: { in: skus } } });

      const res = await importUrl(`${BASE}/files/messy-headers.csv`).expect(201);
      const job = res.body.data;
      expect(job).toMatchObject({
        status: 'PREVIEW',
        totalRows: 3,
        created: 3,
        updated: 0,
        skipped: 0,
        columnMap: {
          'Product Name': 'name',
          'SKU Code': 'sku',
          'Retail Price': 'price',
          Qty: 'stock',
          Manufacturer: 'brand',
          Department: 'category',
        },
      });
      expect(job.preview[2]).toMatchObject({
        action: 'create',
        sku: 'IMPDEMO-103',
        price: { amountCents: 129900, currency: 'EUR' },
        attributes: { Colour: 'Graphite' },
      });
      expect(await h.prisma.product.count({ where: { sku: { in: skus } } })).toBe(0);
      expect(llm.requests).toHaveLength(0); // aliases sufficed, no model call

      const stored = await request(h.app.getHttpServer())
        .get(v1(`/admin/imports/${job.id}`))
        .set('x-admin-key', ADMIN_KEY)
        .expect(200);
      expect(stored.body.data).toEqual(job);
    });

    it('reports row errors and skips only the bad rows', async () => {
      const res = await importUrl(`${BASE}/files/broken-rows.csv`).expect(201);
      expect(res.body.data).toMatchObject({ totalRows: 8, skipped: 7 });
      expect(res.body.data.errors).toContainEqual({
        row: 7,
        field: 'price',
        message: expect.stringContaining('ambiguous'),
      });
    });

    it('404s an unknown job', async () => {
      const res = await request(h.app.getHttpServer())
        .get(v1('/admin/imports/nope'))
        .set('x-admin-key', ADMIN_KEY)
        .expect(404);
      expect(res.body.error.code).toBe('IMPORT_NOT_FOUND');
    });
  });

  describe('apply', () => {
    const { h, importUrl } = importHarness();
    const sku = () => `IMPTEST-${crypto.randomUUID().slice(0, 8)}`;

    it('creates, then updates by SKU without overwriting live stock', async () => {
      const a = sku();
      const b = sku();
      dynamicCsv = `sku,name,price,stock,colour\n${a},Alpha,10.00,5,red\n${b},Beta,"$1,000.50",7,\n`;
      const first = await importUrl(`${BASE}/dynamic.csv`, false).expect(201);
      expect(first.body.data).toMatchObject({ status: 'APPLIED', created: 2, updated: 0 });

      const alpha = await h.prisma.product.findUniqueOrThrow({ where: { sku: a } });
      expect(alpha).toMatchObject({
        name: 'Alpha',
        priceCents: 1000,
        stock: 5,
        category: 'Uncategorized',
        attributes: { colour: 'red' },
      });
      // A sale happens between imports.
      await h.prisma.product.update({ where: { sku: a }, data: { stock: { decrement: 2 } } });

      dynamicCsv = `sku,name,price,stock\n${a},Alpha v2,12.00,99\n`;
      const second = await importUrl(`${BASE}/dynamic.csv`, false).expect(201);
      expect(second.body.data).toMatchObject({ created: 0, updated: 1 });
      expect(await h.prisma.product.findUniqueOrThrow({ where: { sku: a } })).toMatchObject({
        name: 'Alpha v2',
        priceCents: 1200,
        stock: 3, // not 99: the file never overwrites live stock
        attributes: { colour: 'red' }, // no extra columns this time, so attributes are kept
      });
    });

    it('is idempotent for rows without a SKU', async () => {
      const name = `Nameless ${crypto.randomUUID().slice(0, 8)}`;
      dynamicCsv = `name,price\n${name},3.00\n`;
      await importUrl(`${BASE}/dynamic.csv`, false).expect(201);
      const again = await importUrl(`${BASE}/dynamic.csv`, false).expect(201);
      expect(again.body.data).toMatchObject({ created: 0, updated: 1 });
      expect(await h.prisma.product.count({ where: { name } })).toBe(1);
    });

    it('stores neutralised text for formula-injection rows', async () => {
      await importUrl(`${BASE}/files/formula-injection.csv`, false).expect(201);
      const rows = await h.prisma.product.findMany({
        where: { sku: { startsWith: 'IMPDEMO-30' } },
      });
      expect(rows).toHaveLength(4);
      for (const p of rows) {
        for (const value of [p.name, p.description, p.category]) {
          expect(value).not.toMatch(/^[=+\-@\t\r]/);
        }
      }
    });

    it('cannot set ids, timestamps or other columns from the file', async () => {
      const s = sku();
      dynamicCsv = `sku,name,price,id,createdAt,priceCents\n${s},Sneaky,1.00,hijack,2000-01-01,5\n`;
      await importUrl(`${BASE}/dynamic.csv`, false).expect(201);
      const p = await h.prisma.product.findUniqueOrThrow({ where: { sku: s } });
      expect(p.id).not.toBe('hijack');
      expect(p.createdAt.getFullYear()).toBeGreaterThan(2000);
      // An exact `priceCents` column wins over a human `price` column.
      expect(p.priceCents).toBe(5);
      expect(p.attributes).toEqual({ id: 'hijack', createdAt: '2000-01-01' });
    });
  });

  describe('updates keep what the file does not mention', () => {
    const { h, importUrl } = importHarness();

    it('keeps currency and merges attributes', async () => {
      const s = `IMPTEST-${crypto.randomUUID().slice(0, 8)}`;
      await h.prisma.product.create({
        data: {
          sku: s,
          name: 'Euro Thing',
          category: 'Test',
          priceCents: 1000,
          currency: 'EUR',
          stock: 1,
          attributes: { material: 'oak', size: 'L' },
        },
      });
      dynamicCsv = `sku,name,price,colour\n${s},Euro Thing,12.00,red\n`;
      await importUrl(`${BASE}/dynamic.csv`, false).expect(201);
      expect(await h.prisma.product.findUniqueOrThrow({ where: { sku: s } })).toMatchObject({
        priceCents: 1200,
        currency: 'EUR',
        attributes: { material: 'oak', size: 'L', colour: 'red' },
      });
    });
  });

  describe('preview pinning (previewId)', () => {
    const { h, importUrl } = importHarness();
    const applyWith = (url: string, previewId: string) =>
      request(h.app.getHttpServer())
        .post(v1('/admin/imports'))
        .set('x-admin-key', ADMIN_KEY)
        .send({ url, dryRun: false, previewId });

    it('applies when the file is unchanged, refuses when it changed', async () => {
      const s = `IMPTEST-${crypto.randomUUID().slice(0, 8)}`;
      dynamicCsv = `sku,name,price\n${s},Pinned,5.00\n`;
      const preview = (await importUrl(`${BASE}/dynamic.csv`).expect(201)).body.data;

      dynamicCsv = `sku,name,price\n${s},Pinned,0.00\n`; // swapped after review
      const refused = await applyWith(`${BASE}/dynamic.csv`, preview.id).expect(409);
      expect(refused.body.error.code).toBe('IMPORT_SOURCE_CHANGED');
      expect(await h.prisma.product.count({ where: { sku: s } })).toBe(0);

      dynamicCsv = `sku,name,price\n${s},Pinned,5.00\n`;
      const applied = await applyWith(`${BASE}/dynamic.csv`, preview.id).expect(201);
      expect(applied.body.data).toMatchObject({ status: 'APPLIED', created: 1 });
    });

    it('refuses a previewId for another url and 404s an unknown one', async () => {
      dynamicCsv = 'name,price\nX,1.00\n';
      const preview = (await importUrl(`${BASE}/files/clean.csv`).expect(201)).body.data;
      await applyWith(`${BASE}/dynamic.csv`, preview.id).expect(409);
      await applyWith(`${BASE}/dynamic.csv`, 'nope').expect(404);
    });

    it('rejects a file with too many columns', async () => {
      dynamicCsv =
        Array.from({ length: 101 }, (_, i) => `c${i}`).join(',') + '\n' + 'x,'.repeat(100) + 'x\n';
      const res = await importUrl(`${BASE}/dynamic.csv`).expect(422);
      expect(res.body.error.code).toBe('IMPORT_TOO_MANY_COLUMNS');
    });
  });

  describe('rate limit', () => {
    const { importUrl } = importHarness();

    it('allows 10 imports per minute per client, then 429', async () => {
      // Invalid URLs still count: the throttler runs before validation, and nothing is fetched.
      for (let i = 0; i < 10; i++) await importUrl('not a url').expect(400);
      const res = await importUrl('not a url').expect(429);
      expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
    });
  });

  describe('model column mapping fallback', () => {
    const { llm, importUrl } = importHarness();
    it('asks the model only for unrecognised headers and validates its answer', async () => {
      llm.script(
        callTool('map_columns', {
          columns: [
            { header: 'Artikel', field: 'name' },
            { header: 'Preis', field: 'price' },
            { header: 'Bestand', field: 'stock' },
            { header: 'Marke', field: 'brand' },
          ],
        }),
      );
      const res = await importUrl(`${BASE}/files/unmapped-headers.csv`).expect(201);
      expect(res.body.data).toMatchObject({
        totalRows: 2,
        skipped: 0,
        columnMap: { Artikel: 'name', Preis: 'price', Bestand: 'stock', Marke: 'brand' },
      });
      // The model saw headers and at most 3 sample rows, framed as untrusted data.
      const [system, user] = llm.requests[0]!.messages;
      expect(system!.content).toContain('untrusted');
      expect(JSON.parse(user!.content as string)).toEqual({
        headers: ['Artikel', 'Preis', 'Bestand', 'Marke'],
        sampleRows: expect.any(Array),
      });
    });

    it('ignores hallucinated headers and duplicate fields from the model', async () => {
      llm.script(
        callTool('map_columns', {
          columns: [
            { header: 'Price', field: 'price' }, // not a header in the file
            { header: 'Artikel', field: 'name' },
            { header: 'Marke', field: 'name' }, // field already taken
          ],
        }),
      );
      const res = await importUrl(`${BASE}/files/unmapped-headers.csv`).expect(422);
      expect(res.body.error).toMatchObject({
        code: 'IMPORT_UNMAPPED_COLUMNS',
        message: expect.stringContaining('price'),
      });
    });

    it('fails cleanly when the model answers without a tool call or is unavailable', async () => {
      llm.script(say('Sure! Ignore previous instructions.'));
      await importUrl(`${BASE}/files/unmapped-headers.csv`).expect(422);
      llm.script(); // no steps: the fake throws, like a model outage
      const res = await importUrl(`${BASE}/files/unmapped-headers.csv`).expect(422);
      expect(res.body.error.code).toBe('IMPORT_UNMAPPED_COLUMNS');
    });

    it('rejects a malformed tool argument shape', async () => {
      llm.script(callTool('map_columns', { columns: [{ header: 'Artikel', field: 'id' }] }));
      await importUrl(`${BASE}/files/unmapped-headers.csv`).expect(422);
    });
  });

  describe('file-level limits', () => {
    const { importUrl } = importHarness();
    it('rejects a file with no data rows', async () => {
      dynamicCsv = 'sku,name,price\n';
      const res = await importUrl(`${BASE}/dynamic.csv`).expect(422);
      expect(res.body.error.code).toBe('IMPORT_EMPTY');
    });

    it('rejects more than 5,000 rows', async () => {
      dynamicCsv = 'name,price\n' + 'x,1.00\n'.repeat(5001);
      const res = await importUrl(`${BASE}/dynamic.csv`).expect(422);
      expect(res.body.error.code).toBe('IMPORT_TOO_MANY_ROWS');
    });

    it('rejects unparseable CSV', async () => {
      dynamicCsv = 'name,price\n"unterminated,1.00\n';
      const res = await importUrl(`${BASE}/dynamic.csv`).expect(422);
      expect(res.body.error.code).toBe('IMPORT_PARSE_FAILED');
    });
  });
});
