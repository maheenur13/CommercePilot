import { createHash, timingSafeEqual } from 'node:crypto';

/** API tokens are high-entropy random strings, so a fast hash (not bcrypt) is appropriate. */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
