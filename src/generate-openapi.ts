/**
 * Writes docs/openapi.json and docs/API.md from the running app's route metadata.
 * Run via `pnpm docs:api` (needs the compiled build so the Swagger CLI plugin metadata is present).
 * No database connection is made: the app is created but never initialised or started.
 */
import 'reflect-metadata';

import { writeFileSync } from 'node:fs';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { buildOpenApiDocument, renderApiMarkdown } from './openapi.js';

// Env validation needs syntactically valid values; nothing connects to them.
process.env.DATABASE_URL ??= 'postgresql://docs:docs@127.0.0.1:1/docs';
process.env.ADMIN_API_KEY ??= 'docs-generation-placeholder-key';
process.env.NODE_ENV = 'test'; // silences request logging

const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
configureApp(app);
const doc = buildOpenApiDocument(app);

const out = new URL('../docs/', import.meta.url);
writeFileSync(new URL('openapi.json', out), `${JSON.stringify(doc, null, 2)}\n`);
writeFileSync(new URL('API.md', out), renderApiMarkdown(doc));
await app.close();
console.log('Wrote docs/openapi.json and docs/API.md');
