# API conventions

- **Versioning:** business routes live under `/api/v1` (`API_PREFIX` in `src/app.setup.ts`); `/health` and `/docs` stay at root.
- **Layering:** controllers only translate HTTP <-> service calls and map entities to response DTOs. Business rules live in services.
- **Success envelope** (added by `ResponseEnvelopeInterceptor`, never by hand): `{ success: true, data, meta: { requestId } }`.
  List endpoints return `Paginated.of(page, mapper)`, and the interceptor puts `page, pageSize, total, totalPages` into `meta`.
  `pageSize` max 100 (`PaginationQueryDto`).
- **Error envelope** (`AllExceptionsFilter`): `{ success: false, error: { code, message, details?, requestId } }`.
  Throw Nest HTTP exceptions with a domain code: `new ConflictException({ code: 'INSUFFICIENT_STOCK', message })`.
  Validation failures are `VALIDATION_FAILED` with `details: [{ field, messages }]`.
- **Response DTOs:** never return Prisma rows. Each resource has `*-response.dto.ts` with a `toXxxResponse()` mapper.
  Money is `MoneyDto { amountCents, currency, formatted }` via `toMoney()`. Input DTOs still take `priceCents`.
- **Swagger:** request DTOs and `*.dto.ts` response classes are documented by the CLI plugin. Annotate every handler
  with `@ApiEnvelope(Model, { paginated?, isArray?, status? })` so the envelope and the error response show up in `/docs`.
- **Validation:** global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`, so unknown fields are a 400.
- **Auth:** admin endpoints are under `/api/v1/admin/*` behind `AdminGuard` (`x-admin-key`); customer endpoints use bearer tokens.
- Timestamps are ISO-8601 UTC.
