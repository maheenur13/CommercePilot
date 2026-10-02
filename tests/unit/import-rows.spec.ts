import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { resolveSourceUrl } from '../../src/imports/imports.service.js';
import {
  generatedSku,
  mapByAlias,
  MAX_ROWS,
  missingRequired,
  neutralise,
  parseCsv,
  parsePrice,
  validateRows,
} from '../../src/imports/rows.js';
import { isBlockedAddress } from '../../src/imports/safe-fetch.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/imports/${name}`, import.meta.url), 'utf8');

function importFile(name: string) {
  const { headers, rows } = parseCsv(fixture(name));
  return validateRows(headers, rows, mapByAlias(headers));
}

describe('parsePrice', () => {
  it.each([
    ['15', 1500, undefined],
    ['12.5', 1250, undefined],
    ['$1,299.00', 129900, 'USD'],
    ['12,50 €', 1250, 'EUR'],
    ['1.299,00 €', 129900, 'EUR'],
    ['1,299,000', 129900000, undefined],
    ['£0.99', 99, 'GBP'],
    ['19.99 usd', 1999, 'USD'],
    ['EUR 1 299,00', 129900, 'EUR'],
  ])('%s -> %i cents', (raw, cents, currency) => {
    expect(parsePrice(raw)).toEqual({ cents, ...(currency && { currency }) });
  });

  it.each([
    'abc',
    '',
    '-5.00',
    '1,299',
    '1.299',
    '12.345.6',
    '1,29,9.00',
    '12.999',
    '1e5',
    '12abc',
    '$5$5',
  ])('rejects %j', (raw) => {
    expect(parsePrice(raw)).toHaveProperty('error');
  });
});

describe('neutralise', () => {
  it.each([
    ['=HYPERLINK("x")', 'HYPERLINK("x")'],
    ['+cmd', 'cmd'],
    ['@SUM(1)', 'SUM(1)'],
    ['-2+3', '2+3'],
    ['\t=1+1', '1+1'],
    ['=+-@=x', 'x'],
    ['Plain name', 'Plain name'],
  ])('%j -> %j', (raw, out) => expect(neutralise(raw)).toBe(out));
});

describe('mapByAlias', () => {
  it('maps messy headers and leaves unknown columns unmapped', () => {
    expect(
      mapByAlias(['Product Name', 'SKU Code', 'Retail Price', 'Qty', 'Manufacturer', 'Colour']),
    ).toEqual({
      'Product Name': 'name',
      'SKU Code': 'sku',
      'Retail Price': 'price',
      Qty: 'stock',
      Manufacturer: 'brand',
    });
  });

  it('first header wins for a field; "Price (USD)" is a price', () => {
    expect(mapByAlias(['Price (USD)', 'Cost'])).toEqual({ 'Price (USD)': 'price' });
  });

  it('ignores prototype-named headers', () => {
    expect(mapByAlias(['constructor', '__proto__', 'toString'])).toEqual({});
  });

  it('reports missing required fields', () => {
    expect(missingRequired({ Artikel: 'sku' })).toEqual(['name', 'price']);
    expect(missingRequired({ a: 'name', b: 'priceCents' })).toEqual([]);
  });
});

describe('parseCsv', () => {
  it('sniffs ; delimiter, strips BOM, keeps quoted separators', () => {
    const { headers, rows } = parseCsv(fixture('messy-headers.csv'));
    expect(headers[0]).toBe('Product Name');
    expect(rows[0]).toEqual([
      'Nordvik Wool Throw',
      'IMPDEMO-101',
      '49,90 €',
      '12',
      'Nordvik',
      'Home',
      'Grey',
    ]);
  });

  it('handles quoted commas and newlines', () => {
    const { rows } = parseCsv('name,price\n"Lamp, ""Pro""\nline 2",1.00\n,,\n');
    expect(rows).toEqual([['Lamp, "Pro"\nline 2', '1.00']]);
  });
});

describe('validateRows', () => {
  it('imports clean rows with unmapped columns as attributes', () => {
    const { valid, errors } = importFile('clean.csv');
    expect(errors).toEqual([]);
    expect(valid).toHaveLength(4);
    expect(valid[3]).toMatchObject({
      row: 5,
      sku: 'IMPDEMO-004',
      priceCents: 129900,
      currency: 'USD',
      stock: 3,
      attributes: { color: 'Silver' },
    });
  });

  it('reports each broken row with its line and field, keeping the valid one', () => {
    const { valid, errors } = importFile('broken-rows.csv');
    expect(valid.map((r) => r.sku)).toEqual(['IMPDEMO-201']);
    expect(errors.map((e) => [e.row, e.field])).toEqual([
      [3, 'name'],
      [4, 'price'],
      [5, 'stock'],
      [6, 'sku'],
      [7, 'price'],
      [8, 'currency'],
      [9, 'price'],
    ]);
  });

  it('neutralises formula prefixes in every text field', () => {
    const { valid } = importFile('formula-injection.csv');
    for (const row of valid) {
      for (const value of [row.name, row.description, row.category]) {
        expect(value).not.toMatch(/^[=+\-@\t\r]/);
      }
    }
    expect(valid[2]).toMatchObject({ name: 'SUM(1+1) Gadget', category: '1+1' });
  });

  it('rejects duplicate SKUs (explicit and generated) after the first', () => {
    const { valid, errors } = importFile('duplicates.csv');
    expect(valid.map((r) => r.name)).toEqual(['First Copy', 'No Sku Gadget']);
    expect(errors).toEqual([
      { row: 3, field: 'sku', message: 'duplicate of row 2 in this file' },
      { row: 5, field: 'sku', message: 'duplicate of row 4 in this file' },
    ]);
  });

  it('caps text lengths and price at the API limits', () => {
    const { errors } = validateRows(['name', 'price'], [['x'.repeat(201), '1000001.00']], {
      name: 'name',
      price: 'price',
    });
    expect(errors.map((e) => e.field)).toEqual(['name', 'price']);
  });

  it('keeps a __proto__ header as plain attribute data', () => {
    const { valid } = validateRows(['name', 'price', '__proto__'], [['A', '1', 'polluted']], {
      name: 'name',
      price: 'price',
    });
    expect(Object.getPrototypeOf(valid[0]!.attributes)).toBe(Object.prototype);
    expect(Object.hasOwn(valid[0]!.attributes, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('reports the real spreadsheet line after blank rows and multi-line cells', () => {
    const { headers, rows, lines } = parseCsv('name,price\nA,1.00\n,\n\n"B\nmulti",abc\nC,x\n');
    const { errors } = validateRows(headers, rows, mapByAlias(headers), lines);
    expect(errors.map((e) => e.row)).toEqual([6, 7]);
  });

  it('only accepts ISO currencies, and rejects a column that contradicts the price', () => {
    const { errors } = validateRows(
      ['name', 'price', 'currency'],
      [
        ['A', '12 pcs', ''],
        ['B', '5', 'XYZ'],
        ['C', '€5', 'USD'],
      ],
      { name: 'name', price: 'price', currency: 'currency' },
    );
    expect(errors.map((e) => [e.row, e.field])).toEqual([
      [2, 'price'],
      [3, 'currency'],
      [4, 'currency'],
    ]);
  });

  it('leaves currency and blank description out so updates keep the stored values', () => {
    const { valid } = validateRows(['name', 'price', 'description'], [['A', '5', '']], {
      name: 'name',
      price: 'price',
      description: 'description',
    });
    expect(valid[0]).not.toHaveProperty('currency');
    expect(valid[0]).not.toHaveProperty('description');
  });

  it('matches SKUs exactly, like the unique index', () => {
    const { valid } = validateRows(
      ['sku', 'name', 'price'],
      [
        ['ABC-1', 'A', '1'],
        ['abc-1', 'B', '1'],
      ],
      {
        sku: 'sku',
        name: 'name',
        price: 'price',
      },
    );
    expect(valid).toHaveLength(2);
  });

  it('keeps the first column of a repeated extra header', () => {
    const { valid } = validateRows(
      ['name', 'price', 'color', 'color'],
      [['A', '1', 'red', 'blue']],
      {
        name: 'name',
        price: 'price',
      },
    );
    expect(valid[0]!.attributes).toEqual({ color: 'red' });
  });

  it('stops parsing just past the row cap instead of reading millions of rows', () => {
    const { rows } = parseCsv('name,price\n' + 'a\n'.repeat(MAX_ROWS * 10));
    expect(rows).toHaveLength(MAX_ROWS + 1);
  });

  it('clips long cells echoed in error messages', () => {
    const { errors } = validateRows(['name', 'price'], [['A', 'x'.repeat(10_000)]], {
      name: 'name',
      price: 'price',
    });
    expect(errors[0]!.message.length).toBeLessThan(200);
  });

  it('generates a stable, valid SKU', () => {
    expect(generatedSku('No Sku Gadget')).toBe(generatedSku('no sku gadget'));
    expect(generatedSku('No Sku Gadget')).toMatch(/^IMP-NO-SKU-GADGET-[0-9a-f]{8}$/);
    expect(generatedSku('No Sku Gadget')).not.toBe(generatedSku('No Sku Gadget 2'));
  });
});

describe('isBlockedAddress (SSRF)', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '64:ff9b::a00:1',
    'not-an-ip',
  ])('blocks %s', (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each(['8.8.8.8', '140.82.112.3', '2606:4700::1111'])('allows %s', (ip) =>
    expect(isBlockedAddress(ip)).toBe(false),
  );
});

describe('resolveSourceUrl', () => {
  it('rewrites a Google Sheets edit link to its CSV export, keeping the tab', () => {
    expect(
      resolveSourceUrl('https://docs.google.com/spreadsheets/d/abc_DEF-123/edit#gid=42').href,
    ).toBe('https://docs.google.com/spreadsheets/d/abc_DEF-123/export?format=csv&gid=42');
  });

  it('rewrites a published-to-web link', () => {
    expect(resolveSourceUrl('https://docs.google.com/spreadsheets/d/e/2PACX-x/pubhtml').href).toBe(
      'https://docs.google.com/spreadsheets/d/e/2PACX-x/pub?output=csv&gid=0',
    );
  });

  it('leaves other links alone', () => {
    expect(resolveSourceUrl('https://example.com/a.csv').href).toBe('https://example.com/a.csv');
  });
});
