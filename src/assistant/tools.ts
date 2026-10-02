import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';

import { toMoney } from '../common/http/money.js';
import type { Product } from '../generated/prisma/client.js';
import type { ProductsService } from '../products/products.service.js';
import type { ToolSpec } from './llm.client.js';

/**
 * Read-only catalog tools the model may call. Arguments are untrusted model output, so every
 * schema is strict (unknown keys such as `customerId` or `priceCents` are rejected) and bounded.
 */
const schemas = {
  search_products: z.strictObject({
    query: z.string().max(100).optional().describe('Free text: name, brand, category or SKU'),
    category: z.string().max(60).optional(),
    // Same ceiling as CreateProductDto; larger values would overflow the INT4 column (500).
    minPriceCents: z.int().min(0).max(100_000_000).optional(),
    maxPriceCents: z.int().min(0).max(100_000_000).optional(),
    inStock: z.boolean().optional().describe('Only products with stock > 0'),
    limit: z.int().min(1).max(10).optional(),
  }),
  get_product: z.strictObject({ id: z.string().min(1).max(64) }),
  list_categories: z.strictObject({}),
};

export type ToolName = keyof typeof schemas;

const descriptions: Record<ToolName, string> = {
  search_products:
    'Search the active catalog. Use for any question about which products exist, prices, stock or ' +
    'comparisons. `query` is a case-insensitive substring match, so pass one or two short keywords ' +
    '(e.g. "headphones", "kettle"), not a sentence. Returns at most 10 products.',
  get_product:
    'Full details of one product by its id (from search_products). Use for detailed questions ' +
    'about a specific product.',
  list_categories: 'List the product categories in the catalog.',
};

export const TOOL_SPECS: ToolSpec[] = (Object.keys(schemas) as ToolName[]).map((name) => {
  const parameters: Record<string, unknown> = z.toJSONSchema(schemas[name]);
  delete parameters.$schema; // some OpenAI-compatible providers reject it
  return { type: 'function', function: { name, description: descriptions[name], parameters } };
});

export interface ToolOutcome {
  /** JSON fed back to the model. */
  content: string;
  /** Products this call returned; only these can be cited in the reply. */
  products: Product[];
}

const DESCRIPTION_PREVIEW = 300;

function compact(p: Product, full: boolean) {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    brand: p.brand,
    category: p.category,
    price: toMoney(p.priceCents, p.currency).formatted,
    priceCents: p.priceCents,
    stock: p.stock,
    inStock: p.stock > 0,
    description: full ? p.description : p.description.slice(0, DESCRIPTION_PREVIEW),
    ...(full && { attributes: p.attributes }),
  };
}

const json = (value: unknown) => JSON.stringify(value);

/** Validates the model's arguments and runs the tool. Errors go back to the model, not the client. */
export async function runTool(
  products: ProductsService,
  name: string,
  rawArgs: string,
): Promise<ToolOutcome> {
  // hasOwn, not `in`: a model-chosen name like "toString" must not resolve to a prototype member.
  if (!Object.hasOwn(schemas, name))
    return { content: json({ error: 'UNKNOWN_TOOL' }), products: [] };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawArgs || '{}');
  } catch {
    return { content: json({ error: 'INVALID_ARGUMENTS', message: 'not JSON' }), products: [] };
  }
  const args = schemas[name as ToolName].safeParse(parsedJson);
  if (!args.success) {
    return {
      content: json({ error: 'INVALID_ARGUMENTS', message: z.prettifyError(args.error) }),
      products: [],
    };
  }

  switch (name as ToolName) {
    case 'search_products': {
      const a = args.data as z.infer<typeof schemas.search_products>;
      const page = await products.list({
        q: a.query,
        category: a.category,
        minPriceCents: a.minPriceCents,
        maxPriceCents: a.maxPriceCents,
        inStock: a.inStock,
        page: 1,
        pageSize: a.limit ?? 10,
      });
      return {
        content: json({ total: page.total, products: page.items.map((p) => compact(p, false)) }),
        products: page.items,
      };
    }
    case 'get_product': {
      const { id } = args.data as z.infer<typeof schemas.get_product>;
      try {
        const p = await products.get(id);
        return { content: json(compact(p, true)), products: [p] };
      } catch (err) {
        if (!(err instanceof NotFoundException)) throw err;
        return { content: json({ error: 'PRODUCT_NOT_FOUND' }), products: [] };
      }
    }
    case 'list_categories':
      return { content: json({ categories: await products.categories() }), products: [] };
  }
}

/**
 * Products the reply actually mentions (by name or SKU), restricted to ones tools returned this
 * turn. The model can't cite a product it didn't look up, and cited prices come from DB rows.
 */
export function citedProducts(reply: string, seen: Product[]): Product[] {
  const unique = new Map(seen.map((p) => [p.id, p]));
  return [...unique.values()].filter((p) => mentions(reply, p.name) || mentions(reply, p.sku));
}

/** Whole-term, case-insensitive match, so "Mug" isn't found in "smug" nor "TV-1" in "TV-10". */
function mentions(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}-])${escaped}(?![\\p{L}\\p{N}-])`, 'iu').test(text);
}
