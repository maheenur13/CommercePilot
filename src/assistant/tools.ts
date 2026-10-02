import { HttpException } from '@nestjs/common';
import { z } from 'zod';

import type { AuthedCustomer } from '../common/auth/auth.js';
import { toMoney } from '../common/http/money.js';
import type { Product } from '../generated/prisma/client.js';
import { MAX_LINES_PER_ORDER, MAX_QTY_PER_LINE } from '../orders/dto/order.dto.js';
import { type OrderWithItems, toOrderResponse } from '../orders/dto/order-response.dto.js';
import { type PreparedQuote, toQuoteResponse } from '../orders/dto/quote-response.dto.js';
import type { OrdersService } from '../orders/orders.service.js';
import type { ProductsService } from '../products/products.service.js';
import type { ToolSpec } from './llm.client.js';

/**
 * Tools the model may call. Arguments are untrusted model output, so every schema is strict
 * (unknown keys such as `customerId` or `priceCents` are rejected) and bounded. The customer is
 * never an argument: order tools act for `ToolContext.customer`, which comes from the auth guard.
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
  get_my_orders: z.strictObject({ limit: z.int().min(1).max(10).optional() }),
  get_order: z.strictObject({ id: z.string().min(1).max(64) }),
  prepare_order: z.strictObject({
    items: z
      .array(
        z.strictObject({
          productId: z.string().min(1).max(64).describe('Product id from search_products'),
          quantity: z.int().min(1).max(MAX_QTY_PER_LINE),
        }),
      )
      .min(1)
      .max(MAX_LINES_PER_ORDER),
  }),
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
  get_my_orders:
    "The signed-in shopper's own orders, newest first (status, total, items). Requires sign-in.",
  get_order: "One of the signed-in shopper's orders by its id. Requires sign-in.",
  prepare_order:
    'Price an order for the signed-in shopper from product ids (from search_products) and ' +
    'quantities. This does NOT place the order: it returns a quote that the shopper must confirm ' +
    'themselves with the Confirm button. Prices always come from the catalog. Requires sign-in.',
};

export const TOOL_SPECS: ToolSpec[] = (Object.keys(schemas) as ToolName[]).map((name) => {
  const parameters: Record<string, unknown> = z.toJSONSchema(schemas[name]);
  delete parameters.$schema; // some OpenAI-compatible providers reject it
  return { type: 'function', function: { name, description: descriptions[name], parameters } };
});

export interface ToolContext {
  products: ProductsService;
  orders: OrdersService;
  /** From the auth guard; null for anonymous shoppers. */
  customer: AuthedCustomer | null;
}

export interface ToolOutcome {
  /** JSON fed back to the model. */
  content: string;
  /** Products this call returned; only these can be cited in the reply. */
  products: Product[];
  /** Set by prepare_order; returned to the client, never to the model. */
  quote?: PreparedQuote;
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

function compactOrder(o: OrderWithItems) {
  const r = toOrderResponse(o);
  return {
    id: r.id,
    status: r.status,
    total: r.total.formatted,
    createdAt: r.createdAt,
    items: r.items.map((i) => ({
      name: i.name,
      sku: i.sku,
      quantity: i.quantity,
      unitPrice: i.unitPrice.formatted,
    })),
  };
}

const json = (value: unknown) => JSON.stringify(value);
const fail = (error: string, message?: string): ToolOutcome => ({
  content: json({ error, message }),
  products: [],
});

/** Validates the model's arguments and runs the tool. Errors go back to the model, not the client. */
export async function runTool(
  ctx: ToolContext,
  name: string,
  rawArgs: string,
): Promise<ToolOutcome> {
  // hasOwn, not `in`: a model-chosen name like "toString" must not resolve to a prototype member.
  if (!Object.hasOwn(schemas, name)) return fail('UNKNOWN_TOOL');

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawArgs || '{}');
  } catch {
    return fail('INVALID_ARGUMENTS', 'not JSON');
  }
  const args = schemas[name as ToolName].safeParse(parsedJson);
  if (!args.success) return fail('INVALID_ARGUMENTS', z.prettifyError(args.error));

  try {
    return await execute(ctx, name as ToolName, args.data);
  } catch (err) {
    // Expected domain errors (not found, out of stock…) are for the model to explain.
    if (!(err instanceof HttpException)) throw err;
    const body = err.getResponse();
    const { code, message } = (typeof body === 'object' ? body : {}) as {
      code?: string;
      message?: string;
    };
    return fail(code ?? 'ERROR', message);
  }
}

async function execute(ctx: ToolContext, name: ToolName, data: unknown): Promise<ToolOutcome> {
  switch (name) {
    case 'search_products': {
      const a = data as z.infer<typeof schemas.search_products>;
      const page = await ctx.products.list({
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
      const { id } = data as z.infer<typeof schemas.get_product>;
      const p = await ctx.products.get(id);
      return { content: json(compact(p, true)), products: [p] };
    }
    case 'list_categories':
      return { content: json({ categories: await ctx.products.categories() }), products: [] };
  }

  // Everything below acts on the shopper's own data.
  const { customer } = ctx;
  if (!customer) return fail('AUTH_REQUIRED', 'Ask the shopper to sign in first.');

  switch (name) {
    case 'get_my_orders': {
      const { limit } = data as z.infer<typeof schemas.get_my_orders>;
      const page = await ctx.orders.listForCustomer(customer.id, { page: 1, pageSize: limit ?? 5 });
      return {
        content: json({ total: page.total, orders: page.items.map(compactOrder) }),
        products: [],
      };
    }
    case 'get_order': {
      const { id } = data as z.infer<typeof schemas.get_order>;
      return {
        content: json(compactOrder(await ctx.orders.getForCustomer(customer.id, id))),
        products: [],
      };
    }
    case 'prepare_order': {
      const { items } = data as z.infer<typeof schemas.prepare_order>;
      const quote = await ctx.orders.quote(customer.id, items);
      // The quote id stays server/client side: the model can't confirm, leak or reuse it.
      const { items: lines, total, expiresAt } = toQuoteResponse(quote); // no quoteId
      const summary = {
        status: 'AWAITING_SHOPPER_CONFIRMATION',
        items: lines.map((i) => ({
          name: i.name,
          sku: i.sku,
          quantity: i.quantity,
          unitPrice: i.unitPrice.formatted,
          lineTotal: i.lineTotal.formatted,
        })),
        total: total.formatted,
        expiresAt,
        note: 'Not placed yet. The shopper must press Confirm; you cannot place it.',
      };
      return { content: json(summary), products: [], quote };
    }
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
