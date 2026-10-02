# Testing rules

- Runner: Vitest (projects `unit`, `e2e`) with SWC so Nest decorator metadata works.
- `tests/unit/**` — pure logic, no DB, no network. `tests/e2e/**` — real Nest app + real Postgres (`shop_test`).
- e2e boots the app via `createApp()` in `tests/e2e/helpers.ts`, which applies the same `configureApp()` as prod.
- Tests that mutate stock create their own product via `createProduct()`; never mutate seeded fixtures.
- Never call a real LLM in `pnpm test`. Use the scripted fake LLM client; live-model checks belong in `tests/evals` (opt-in).
- Every security-relevant feature needs an adversarial case: forged/missing auth, another customer's id,
  injected prices/fields, out-of-range quantities, prompt injection, SSRF targets, malformed input.
- Assert behaviour (status codes, DB state after the call), not implementation details.
