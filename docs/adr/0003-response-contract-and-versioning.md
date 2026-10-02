# ADR 0003 — Response envelope, response DTOs and URL versioning

**Status:** accepted (Task 0)

## Context

The first cut returned raw Prisma rows in whatever shape each handler produced: bare arrays, ad-hoc page objects, and
internal columns such as `customerId` or `orderId`. Errors had a consistent shape, but success responses didn't.
Swagger showed no response schemas. The assistant (Tasks 1–2) and import (Task 3) build on these endpoints, so the
contract has to be stable before they do.

## Decision

- **One envelope for every response:**
  - Success: `{ success: true, data, meta: { requestId, page?, pageSize?, total?, totalPages? } }`
  - Error: `{ success: false, error: { code, message, details?, requestId } }`

  The success envelope is applied centrally by `ResponseEnvelopeInterceptor` and `AllExceptionsFilter`, so a handler
  can't forget it.

- **Machine-readable error codes:** domain codes such as `INSUFFICIENT_STOCK`, `PRODUCT_NOT_FOUND` and
  `VALIDATION_FAILED` (with field-level `details`), falling back to the HTTP status name. Clients branch on `code`,
  never on `message`.
- **Explicit response DTOs** with mapper functions. Money is exposed as `{ amountCents, currency, formatted }`,
  products get a derived `inStock`, and internal columns are not exposed. Adding a DB column no longer changes the API.
- **`/api/v1` prefix** for business routes. `/health` and `/docs` stay unversioned because they serve
  infrastructure, not API consumers.
- **Swagger** documents the envelope per endpoint (`@ApiEnvelope`) and the error envelope as the default response.

## Consequences

- Breaking change from the first cut, done before any consumer exists, and covered by `tests/e2e/contract.e2e.spec.ts`.
- Slightly more code per endpoint (a DTO plus a mapper). In return the contract is explicit, documented and testable.
- Not adopted: JSON:API/HAL (too heavy for this scope) and header-based versioning (less visible, harder to try in a browser).
