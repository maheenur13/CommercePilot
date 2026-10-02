import { describe, expect, it } from 'vitest';

import { validateEnv } from '../../src/config/env.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  ADMIN_API_KEY: 'a-long-enough-admin-key',
};

describe('validateEnv', () => {
  it('boots without a model key (assistant is optional)', () => {
    const env = validateEnv({ ...base, OPENROUTER_API_KEY: '' });
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
    expect(env.PORT).toBe(3000);
  });

  it('fails fast on a weak admin key', () => {
    expect(() => validateEnv({ ...base, ADMIN_API_KEY: 'short' })).toThrow(/ADMIN_API_KEY/);
  });

  it('fails fast on a missing database url', () => {
    expect(() => validateEnv({ ADMIN_API_KEY: base.ADMIN_API_KEY })).toThrow(/DATABASE_URL/);
  });
});
