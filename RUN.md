# Run

Requires Docker (with Compose v2). From a clean clone or unzip:

```bash
docker compose up --build
```

That one command builds the API, starts Postgres, applies migrations, seeds the catalog and demo data,
and serves the API on **http://localhost:3000/api/v1** (Swagger UI at **http://localhost:3000/docs**,
assistant demo chat at **http://localhost:3000/chat**, health at **http://localhost:3000/health**).
No `.env` is required for this to work: the compose file has safe local defaults.

## Optional configuration

| Variable             | Where               | Purpose                                                                         |
| -------------------- | ------------------- | ------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY` | shell env or `.env` | Model key for the assistant (Tasks 1–3). Without it, assistant endpoints → 503. |
| `ADMIN_API_KEY`      | `.env` (zip root)   | Operator key for `/api/v1/admin/*`. Default: `local-dev-admin-key-change-me`.   |
| `API_PORT`/`DB_PORT` | shell env           | Host ports if 3000 / 5432 are taken.                                            |
| `LLM_MODEL`          | shell env or `.env` | Defaults to `openai/gpt-4o-mini` via OpenRouter.                                |
| `LLM_BASE_URL`       | shell env or `.env` | OpenAI-compatible API base. Default `https://openrouter.ai/api/v1`.             |

```bash
OPENROUTER_API_KEY=sk-or-... docker compose up --build
```

## Demo credentials (seeded, public test data)

| Customer | Bearer token                  |
| -------- | ----------------------------- |
| Alice    | `demo-alice-7f3k9q2m5x8v1b4n` |
| Bob      | `demo-bob-2p6r8t0w3y5u7i9o`   |
| Carol    | `demo-carol-4h6j8l1z3c5v7n9m` |
| Dan      | `demo-dan-9a1s3d5f7g2h4j6k`   |

## Try it

```bash
curl localhost:3000/health
curl "localhost:3000/api/v1/products?q=headphones&inStock=true"
curl -H "Authorization: Bearer demo-alice-7f3k9q2m5x8v1b4n" localhost:3000/api/v1/orders
curl -X POST localhost:3000/api/v1/orders -H "Authorization: Bearer demo-alice-7f3k9q2m5x8v1b4n" \
  -H "content-type: application/json" -d '{"items":[{"productId":"<data[].id from /products>","quantity":1}]}'
```

**Chat in the browser:** open http://localhost:3000/chat (pick "Chat as" to be anonymous or a demo customer).
Or ask the assistant with curl (needs `OPENROUTER_API_KEY`; without one it returns `503 DEPENDENCY_UNAVAILABLE`).
The bearer token is optional. Send the returned `conversationId` back to continue the conversation:

```bash
curl -X POST localhost:3000/api/v1/assistant/chat -H "content-type: application/json" \
  -d '{"message":"Which noise-cancelling headphones do you have under $200?"}'
```

Every response uses one envelope (details in `docs/adr/0003-response-contract-and-versioning.md`):

```json
{ "success": true, "data": { "...": "..." }, "meta": { "requestId": "…", "page": 1, "pageSize": 20, "total": 48, "totalPages": 3 } }
{ "success": false, "error": { "code": "INSUFFICIENT_STOCK", "message": "…", "details": [], "requestId": "…" } }
```

## Tests (local toolchain)

```bash
corepack enable && pnpm install
docker compose up -d db          # Postgres on host port 5432
pnpm test                        # unit + e2e (uses a separate shop_test database)
pnpm lint && pnpm typecheck
OPENROUTER_API_KEY=sk-or-... pnpm test:eval   # opt-in live-model checks (also reads the env file)
```

## Reset to a clean state

```bash
docker compose down -v && docker compose up --build
```
