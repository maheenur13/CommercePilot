# ADR 0002 — Identity and prices are always resolved server-side

**Status:** accepted (Task 0; load-bearing for Task 2)

## Context

Task 2 lets an LLM place orders and read order history on a customer's behalf. LLM output is untrusted:
a user (or text inside a product description) can instruct the model to act as another customer or to change a price.

## Decision

- The customer is resolved **only** by `CustomerAuthGuard` from a bearer token (stored as SHA-256). No endpoint or
  assistant tool accepts a `customerId`.
- Order requests carry only `productId` + `quantity`. Unit prices and totals are read from the DB inside the
  order transaction and snapshotted onto `OrderItem.unitPriceCents`. Unknown fields are rejected (400).
- Stock is decremented with `UPDATE ... WHERE stock >= qty` inside the same transaction; zero rows updated → 409 and
  full rollback. Concurrency is covered by an e2e test (8 parallel orders for 3 units → exactly 3 succeed).
- Other customers' orders return 404, not 403, so ids cannot be probed.

## Consequences

Prompt-injection attacks against identity or price are structurally impossible rather than "discouraged by the
prompt". Auth is deliberately minimal (seeded tokens, no signup) — documented as an assumption.
