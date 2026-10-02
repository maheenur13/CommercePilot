import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { mergeLines } from '../../src/orders/orders.service.js';

describe('mergeLines', () => {
  it('collapses duplicate product lines so stock is checked on the real total', () => {
    expect(
      mergeLines([
        { productId: 'a', quantity: 2 },
        { productId: 'b', quantity: 1 },
        { productId: 'a', quantity: 3 },
      ]),
    ).toEqual([
      { productId: 'a', quantity: 5 },
      { productId: 'b', quantity: 1 },
    ]);
  });

  it('sorts lines by product id so concurrent orders lock rows in the same order', () => {
    expect(
      mergeLines([
        { productId: 'c', quantity: 1 },
        { productId: 'a', quantity: 1 },
        { productId: 'b', quantity: 1 },
      ]).map((l) => l.productId),
    ).toEqual(['a', 'b', 'c']);
  });

  it('rejects a merged quantity above the per-line cap (split-line bypass)', () => {
    expect(() =>
      mergeLines([
        { productId: 'a', quantity: 30 },
        { productId: 'a', quantity: 30 },
      ]),
    ).toThrow(BadRequestException);
  });
});
