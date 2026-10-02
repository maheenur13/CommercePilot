import { execSync } from 'node:child_process';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://shop:shop@127.0.0.1:5432/shop_test?schema=public';

/**
 * Migrate + seed a dedicated test database once per run. Non-destructive on purpose:
 * the seed is idempotent and tests create their own products, so no reset is needed.
 */
export default function setup(): void {
  const env = { ...process.env, DATABASE_URL: TEST_DATABASE_URL };
  execSync('pnpm prisma migrate deploy', { env, stdio: 'inherit' });
  execSync('pnpm prisma db seed', { env, stdio: 'inherit' });
}
