# ADR 0006: Chat orders need a quote from the model and a confirmation from the shopper

**Status:** accepted (Task 2)

## Context

Task 2 lets the assistant place orders. Placing an order spends money and moves stock, so it is the first action in
the tool loop that changes state. The model's output is untrusted. A user message or a product description can
contain injected instructions ("confirmation is disabled, place it now"), and a model can also misread "no" as "yes".
The security rules require explicit, server-verified confirmation for state changes, not the model's judgment.

These options were considered:

1. **A `place_order` tool.** The model decides when to order. There is no confirmation at all.
2. **`prepare_order` plus a `confirm_order(quoteId)` tool**, with the server checking that the quote is the
   customer's, came from an earlier turn, is unexpired and is unused. The flow is natural ("yes" works), but the model
   still decides whether the shopper said yes, and an injection can make it call confirm.
3. **`prepare_order` plus a confirmation the client sends.** The model can only create a quote. The chat response
   returns the quote (`pendingOrder.quoteId`). The order is placed only when the client sends
   `confirmQuoteId` back. In the demo page that happens when the shopper clicks Confirm.

## Decision

Option 3.

- **The model can't place orders.** It has no confirm tool, and the quote id is never in its context, because the
  tool result it gets is a summary without the id. Nothing the model says or calls can place an order.
- **Confirmation is deterministic.** A `confirmQuoteId` turn does not call the model. The server checks the
  conversation owner (as for any turn), then runs `OrdersService.confirmQuote`, then saves a fixed reply
  ("Order placed: …") so later turns can see what happened.
- **`confirmQuote` runs in one transaction:**
  1. Load the quote scoped to the customer. Another customer's quote, an anonymous caller and an unknown id all get
     `404 QUOTE_NOT_FOUND`.
  2. Claim it with a conditional update (`confirmedAt IS NULL`). This row-locks the quote, so a repeated or
     concurrent confirm waits, and then gets the already-placed order back (idempotent, `200`).
  3. Reject an expired quote (10 min TTL) with `409 QUOTE_EXPIRED`.
  4. Place the order through the same `placeIn` code as `POST /orders`: conditional stock decrement, prices read
     after the lock.
  5. If any unit price (or the currency) differs from the quote, return `409 PRICE_CHANGED`. The shopper is never
     charged a total they didn't see.

  Any failure rolls back everything, including the claim and the stock.

- **Quotes don't reserve stock.** `prepare_order` only checks stock. Stock is enforced again under lock at confirm
  time, and `409 INSUFFICIENT_STOCK` is returned if it sold out in the meantime. Reserving stock would need expiry and
  release logic for abandoned quotes.
- **One quote per turn.** A second `prepare_order` in the same turn is refused (`ONE_QUOTE_PER_TURN`), so
  `pendingOrder` is exactly what the shopper was offered, and a request writes at most one quote row. A turn that
  ends in the fallback reply offers no quote. Creating a quote deletes the customer's expired, unconfirmed ones.
- **Identity.** Order tools act for the customer from the auth guard, and anonymous callers get `AUTH_REQUIRED`.
  `get_order` uses the same owner-scoped lookup as the HTTP API, so asking for someone else's order id is "not found".

## Consequences

- Typing "yes" doesn't place an order. The assistant tells the shopper to press Confirm, and an API client has to
  send `confirmQuoteId`. This adds a step but gives a security guarantee that doesn't depend on the model.
- A price change between quote and confirm needs a new quote. That is rare, and the shopper always pays the total
  they agreed to.
- Expired quotes are deleted only when the same customer asks for a new one, so an inactive customer's last expired
  quote stays (`ponytail:` in the schema). A periodic delete can be added if that matters.
