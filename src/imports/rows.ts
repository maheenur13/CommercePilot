import { createHash } from 'node:crypto';

import { parse } from 'csv-parse/sync';

/** Product fields a CSV column can map to. `priceCents` is a column already in minor units. */
export const FIELDS = [
  'sku',
  'name',
  'description',
  'category',
  'brand',
  'price',
  'priceCents',
  'currency',
  'stock',
  'active',
] as const;
export type Field = (typeof FIELDS)[number];
/** header -> field */
export type ColumnMap = Record<string, Field>;

// Type aliases (not interfaces) so they are assignable to Prisma JSON columns.
export type RowError = {
  /** Spreadsheet line number (the header is line 1). */
  row: number;
  field: string;
  message: string;
};

/** A validated row. Optional fields are absent when their column isn't in the file. */
export type ImportRow = {
  /** Spreadsheet line the row ends on (the header is line 1). */
  row: number;
  sku: string;
  name: string;
  priceCents: number;
  /** Absent when the file has no currency column or marker; creates default to USD. */
  currency?: string;
  description?: string;
  category?: string;
  brand?: string;
  stock?: number;
  active?: boolean;
  attributes: Record<string, string>;
};

export const MAX_ATTRIBUTES = 20;
// ponytail: synchronous import capped at 5,000 rows / 5 MB; move to a job queue if imports grow.
export const MAX_ROWS = 5_000;
export const MAX_COLUMNS = 100;
const MAX_RECORD_BYTES = 100_000;
const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

const norm = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, '');

// Maps, not object literals: CSV headers like `constructor` or `__proto__` must not hit prototype keys.
const ALIASES = new Map<string, Field>(
  Object.entries({
    sku: ['sku', 'skucode', 'itemcode', 'productcode', 'code', 'partnumber', 'articlenumber'],
    name: ['name', 'title', 'productname', 'product', 'producttitle', 'itemname', 'item'],
    description: ['description', 'desc', 'details', 'productdescription', 'summary'],
    category: ['category', 'categoryname', 'type', 'producttype', 'department', 'group'],
    brand: ['brand', 'brandname', 'manufacturer', 'vendor', 'make'],
    price: ['price', 'cost', 'unitprice', 'retailprice', 'saleprice', 'msrp', 'amount'],
    priceCents: ['pricecents', 'priceincents'],
    currency: ['currency', 'currencycode'],
    stock: ['stock', 'qty', 'quantity', 'inventory', 'stockqty', 'onhand', 'available'],
    active: ['active', 'enabled', 'published', 'isactive'],
  } satisfies Record<Field, string[]>).flatMap(([field, names]) =>
    names.map((n) => [n, field as Field] as const),
  ),
);

/** Deterministic header -> field mapping. "Price (USD)" also maps to price. First header wins. */
export function mapByAlias(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  const taken = new Set<Field>();
  for (const header of headers) {
    const key = norm(header);
    const field = ALIASES.get(key) ?? (/^price[a-z]{3}$/.test(key) ? 'price' : undefined);
    if (field && !taken.has(field)) {
      map[header] = field;
      taken.add(field);
    }
  }
  return map;
}

export function missingRequired(map: ColumnMap): string[] {
  const fields = new Set(Object.values(map));
  return [
    ...(fields.has('name') ? [] : ['name']),
    ...(fields.has('price') || fields.has('priceCents') ? [] : ['price']),
  ];
}

/**
 * Parses CSV text into a header row and data rows, with the line each row ends on. Delimiter
 * (, ; tab) is sniffed from the header. Parsing stops after MAX_ROWS + 1 data rows, so a file of
 * millions of tiny rows can't block the event loop; the caller rejects the overflow.
 */
export function parseCsv(text: string): { headers: string[]; rows: string[][]; lines: number[] } {
  const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best,
  );
  const records = parse(text, {
    bom: true,
    delimiter,
    info: true,
    to: MAX_ROWS + 2,
    max_record_size: MAX_RECORD_BYTES,
    trim: true,
    relax_column_count: true,
    skip_empty_lines: true,
    skip_records_with_empty_values: true,
  }) as unknown as { record: string[]; info: { lines: number } }[]; // `info: true` shape
  const [header, ...rows] = records;
  return {
    headers: header?.record ?? [],
    rows: rows.map((r) => r.record),
    lines: rows.map((r) => r.info.lines),
  };
}

/**
 * Strips leading characters that make a spreadsheet treat a cell as a formula (= + - @, tab, CR),
 * so data exported back out of the shop can't execute in Excel/Sheets.
 */
export function neutralise(value: string): string {
  return value.replace(/^[\s=+\-@]+/, '').trim();
}

/** A cell echoed in an error message, clipped so stored errors stay small. */
const quote = (value: string) =>
  JSON.stringify(value.length > 100 ? `${value.slice(0, 100)}…` : value);

const SYMBOLS: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP' };

/**
 * Parses a human price ("$1,299.00", "12,50 €", "1.299,00 EUR", "15") into integer cents, using
 * string arithmetic only. A lone separator followed by exactly three digits ("1,299", "1.299") is
 * rejected as ambiguous rather than guessed, since a wrong guess is a silent 1000x price error.
 */
export function parsePrice(raw: string): { cents: number; currency?: string } | { error: string } {
  // Only a real ISO code counts; any other word ("12 pcs") stays in and makes the price invalid.
  const code = /\b[A-Za-z]{3}\b/.exec(raw)?.[0];
  const known = code && CURRENCIES.has(code.toUpperCase()) ? code : undefined;
  const symbol = Object.keys(SYMBOLS).find((sym) => raw.includes(sym));
  const currency = known?.toUpperCase() ?? (symbol && SYMBOLS[symbol]);
  // Only the currency marker and whitespace (incl. "1 299,00" grouping) are dropped; anything
  // else left over ("1e5", "12abc") makes the price invalid instead of being silently stripped.
  const s = raw
    .replace(known ?? '', '')
    .replace(symbol ?? '', '')
    .replace(/\s/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return { error: `${quote(raw)} is not a valid non-negative price` };

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let decimal: '.' | ',' | undefined;
  if (lastDot >= 0 && lastComma >= 0) decimal = lastDot > lastComma ? '.' : ',';
  else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const count = s.split(sep).length - 1;
    const tail = s.length - s.lastIndexOf(sep) - 1;
    if (count === 1 && tail === 3) {
      return { error: `${quote(raw)} is ambiguous; write it as 1299 or 1,299.00` };
    }
    if (count === 1) decimal = sep;
  }

  const cut = decimal ? s.lastIndexOf(decimal) : s.length;
  let int = s.slice(0, cut);
  const frac = decimal ? s.slice(cut + 1) : '';
  const group = decimal === '.' ? ',' : decimal === ',' ? '.' : /[.,]/.exec(int)?.[0];
  if (group && int.includes(group)) {
    if (!new RegExp(`^\\d{1,3}(\\${group}\\d{3})+$`).test(int)) {
      return { error: `${quote(raw)} has invalid digit grouping` };
    }
    int = int.replaceAll(group, '');
  }
  if (!/^\d+$/.test(int) || !/^\d{0,2}$/.test(frac)) {
    return { error: `${quote(raw)} is not a valid price (at most 2 decimals)` };
  }
  return { cents: Number(int) * 100 + Number(frac.padEnd(2, '0')), ...(currency && { currency }) };
}

const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const BOOLS = new Map(
  Object.entries({
    true: true,
    yes: true,
    y: true,
    1: true,
    false: false,
    no: false,
    n: false,
    0: false,
  }),
);

/** Same as `CreateProductDto`'s bounds, so imported rows obey the API's limits. */
const MAX = { name: 200, description: 5000, category: 60, brand: 60, attrValue: 500 };
const MAX_PRICE_CENTS = 100_000_000;
const MAX_STOCK = 1_000_000;

/**
 * Stable SKU for a row without one, so re-importing the same file updates instead of duplicating.
 * Derived from the name only, so adding or fixing a brand column later doesn't fork products.
 */
export function generatedSku(name: string): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const hash = createHash('sha256').update(name.toLowerCase()).digest('hex');
  return `IMP-${slug || 'ITEM'}-${hash.slice(0, 8)}`;
}

/** Validates every data row; a row with any error is skipped whole and reported. */
export function validateRows(
  headers: string[],
  rows: string[][],
  map: ColumnMap,
  /** Line each row ends on (from `parseCsv`); defaults to one line per row. */
  lines: number[] = [],
): { valid: ImportRow[]; errors: RowError[] } {
  const valid: ImportRow[] = [];
  const errors: RowError[] = [];
  const firstSeen = new Map<string, number>();
  const col = Object.fromEntries(
    Object.entries(map).map(([header, field]) => [field, headers.indexOf(header)]),
  ) as Partial<Record<Field, number>>;
  // Unmapped columns become attributes; a repeated header keeps its first column.
  const extraKeys = new Set<string>();
  const extra = headers
    .map((h, i) => [neutralise(h).slice(0, 60), i] as const)
    .filter(([h], i) => {
      if (!h || Object.hasOwn(map, headers[i]!) || extraKeys.has(h)) return false;
      extraKeys.add(h);
      return true;
    })
    .slice(0, MAX_ATTRIBUTES);

  rows.forEach((cells, index) => {
    const row = lines[index] ?? index + 2;
    const rowErrors: RowError[] = [];
    const fail = (field: string, message: string) => rowErrors.push({ row, field, message });
    const cell = (field: Field) => {
      const i = col[field];
      return i === undefined ? undefined : (cells[i] ?? '');
    };
    const text = (field: 'name' | 'description' | 'category' | 'brand') => {
      const raw = cell(field);
      if (raw === undefined) return undefined;
      const value = neutralise(raw);
      if (value.length > MAX[field]) fail(field, `must be at most ${MAX[field]} characters`);
      return value;
    };

    const name = text('name') ?? '';
    if (!name) fail('name', 'is required');
    const description = text('description') || undefined;
    const category = text('category') || undefined;
    const brand = text('brand') || undefined;

    let priceCents = 0;
    let currency: string | undefined;
    const rawCents = cell('priceCents');
    const rawPrice = cell('price');
    if (rawCents !== undefined) {
      if (/^\d+$/.test(rawCents)) priceCents = Number(rawCents);
      else fail('priceCents', `${quote(rawCents)} is not a whole number of cents`);
    } else {
      const parsed = parsePrice(rawPrice ?? '');
      if ('error' in parsed) fail('price', parsed.error);
      else {
        priceCents = parsed.cents;
        currency = parsed.currency;
      }
    }
    if (priceCents > MAX_PRICE_CENTS) fail('price', `must be at most ${MAX_PRICE_CENTS} cents`);

    const rawCurrency = cell('currency');
    if (rawCurrency) {
      const code = rawCurrency.toUpperCase();
      if (!CURRENCIES.has(code))
        fail('currency', `${quote(rawCurrency)} is not an ISO currency code`);
      else if (currency && currency !== code) {
        fail('currency', `column says ${code} but the price is in ${currency}`);
      } else currency = code;
    }

    const rawStock = cell('stock');
    let stock: number | undefined;
    if (rawStock) {
      const digits = rawStock.replace(/[\s,]/g, '');
      if (/^\d+$/.test(digits) && Number(digits) <= MAX_STOCK) stock = Number(digits);
      else fail('stock', `${quote(rawStock)} is not a whole number between 0 and ${MAX_STOCK}`);
    }

    const rawActive = cell('active');
    let active: boolean | undefined;
    if (rawActive) {
      active = BOOLS.get(rawActive.toLowerCase());
      if (active === undefined) fail('active', `${quote(rawActive)} is not yes/no or true/false`);
    }

    const sku = cell('sku') || (name && generatedSku(name));
    if (sku && !SKU_RE.test(sku)) {
      fail('sku', 'must start with a letter or digit and contain only letters, digits, . _ -');
    }
    // Exact match, like the DB's unique index: `abc-1` and `ABC-1` are different products.
    const seen = sku && firstSeen.get(sku);
    if (seen) fail('sku', `duplicate of row ${seen} in this file`);

    if (rowErrors.length) {
      errors.push(...rowErrors);
      return;
    }
    firstSeen.set(sku, row);

    // fromEntries defines own properties, so a `__proto__` header stays plain data.
    const attributes: Record<string, string> = Object.fromEntries(
      extra
        .map(([key, i]) => [key, neutralise(cells[i] ?? '').slice(0, MAX.attrValue)] as const)
        .filter(([, value]) => value),
    );
    valid.push({
      row,
      sku,
      name,
      priceCents,
      ...(currency && { currency }),
      ...(description && { description }),
      ...(category && { category }),
      ...(brand && { brand }),
      ...(stock !== undefined && { stock }),
      ...(active !== undefined && { active }),
      attributes,
    });
  });
  return { valid, errors };
}
