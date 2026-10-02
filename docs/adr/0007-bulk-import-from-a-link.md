# ADR 0007: Bulk import fetches an untrusted link safely, previews first and never overwrites live stock

**Status:** accepted (Task 3)

## Context

Operators import products from a link: a CSV URL or a Google Sheet. The server fetches a URL that someone else
chose, so the fetch is an SSRF vector. A link to `169.254.169.254`, `localhost` or an internal service, or a public
host that redirects or resolves to one of them, would turn the API into a proxy into the private network. The file
itself is untrusted too. Headers vary ("Product Name", "Retail Price", "Artikel"), prices come as text
("$1,299.00", "12,50 €"), and cells can carry spreadsheet formulas that run when an export is later opened in Excel.

Products also have live state. Orders decrement `stock` concurrently (rule 4), and quotes compare prices
(`PRICE_CHANGED`).

## Decision

**Fetch (`src/imports/safe-fetch.ts`).** Node's `http`/`https` with a custom DNS `lookup`, not `fetch`:

- Only http(s). An IP-literal host is checked directly. A hostname is checked inside the `lookup` hook. That hook runs
  when the socket connects, so the address that was checked is the address that gets dialled. There is no
  DNS-rebinding window between the check and the connect, which there would be if the check ran in a separate
  resolve step. Any resolved address in a private, loopback, link-local, CGNAT, multicast or reserved range rejects
  the request (`net.BlockList`, IPv4-mapped IPv6 included).
- Redirects are followed by hand, up to 5, and every hop goes through the same checks.
- One 10 s deadline for the whole fetch, a 5 MB cap enforced while streaming (not only via `content-length`), and
  `text/html` is rejected. A private Google Sheet returns a login page.
- Tests need a loopback server, so `IMPORT_ALLOWED_HOSTS` exempts exact `host:port` pairs. The env schema refuses it
  when `NODE_ENV=production`.

**Parse and map.** `csv-parse` (a new dependency: quoted fields, embedded newlines and BOMs are where hand-written
parsers break) with the delimiter sniffed from the header. Columns are mapped through a deterministic alias table.
The model is asked only when `name` or `price` is still unmapped, and it sees only the headers and 3 sample rows,
framed as untrusted data. Its answer is zod-validated, and only real, unmapped headers can go to unused fields. The
model never sees or writes the rest of the data. Without a key, or if the model fails, the result is
`IMPORT_UNMAPPED_COLUMNS`. Columns that stay unmapped become `attributes` (up to 20).

**Validate.** Each row is checked against the same bounds as `CreateProductDto`. Prices are parsed to cents with
string arithmetic. A lone separator followed by exactly three digits ("1,299", "1.299") is rejected as ambiguous
instead of guessed, because a wrong guess is a silent 1000x price. Leading `= + - @`, tab and CR are stripped from
every text cell and attribute. A duplicate SKU within the file is rejected after its first occurrence. A row without
a SKU gets a deterministic one (`IMP-<slug>-<hash of name>`), so re-importing the same file updates the product
instead of duplicating it. The brand isn't part of the hash, so adding a brand column later doesn't fork products.
Parsing stops just past the 5,000-row cap and records are capped at 100 KB and 100 columns, so a small file of
millions of tiny rows can't block the event loop.

**Write.**

- `dryRun` defaults to `true`, so a request writes nothing unless it explicitly says otherwise. Applying means
  sending the same link with `dryRun: false`. The link is fetched again. Each job stores the SHA-256 of the file it
  read. An apply that sends `previewId` is refused (`IMPORT_SOURCE_CHANGED`) unless the content is identical, so a
  host can't serve a harmless file to the preview and a different one to the apply.
- All valid rows are upserted by SKU in one transaction. Rows with errors are skipped and reported by line and field.
- An update touches only the fields whose column is in the file, and a blank cell or missing currency keeps the
  stored value. File attributes are merged over the stored ones. It **never touches stock**: setting an absolute
  value would erase order decrements that happened in the meantime. Stock from the file applies only when a product
  is created, and restocks use `PATCH … { stockDelta }`.
- A price change from an import invalidates open chat quotes through the existing `PRICE_CHANGED` check.

Every import that gets past fetch and parse is stored as an `ImportJob` (`PREVIEW` or `APPLIED`) with totals, the
column map, the first 200 errors and a 20-row preview, so it can be read back with `GET /admin/imports/:id`. Fetch
and parse failures are 4xx responses with a domain code and don't create a job.

## Consequences

- An import is synchronous and capped at 5,000 rows, one upsert per row (`ponytail:`). Larger feeds would need a
  queue and batched SQL.
- Stock can't be synced from a supplier feed. That is a deliberate trade for correctness under concurrent orders.
- The dry run and the apply are two fetches. With `previewId` a change is detected and refused, and without it the
  apply uses the current content. Applying the stored rows themselves would need every row stored with the job.
- Ambiguous prices need the operator to fix the sheet, rather than the importer guessing.
