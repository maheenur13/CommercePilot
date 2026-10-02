import { readFileSync } from 'node:fs';

// src/config and dist/config are both two levels below the package root.
export const APP_VERSION = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;
