# Project Rev — travel search milestone

Working product name. The original private Sites URL is retained until a final brand is chosen.

## What works now

- Server-backed sample search for flights, trains, buses and cabs.
- A Duffel flight adapter using the official v2 offer-request and offer-refresh APIs.
- One-way, nonstop, economy searches for 1–6 adults across Bengaluru (BLR), Chennai (MAA), Mumbai (BOM), Pune (PNQ), Delhi (DEL), Jaipur (JAI), Hyderabad (HYD).
- Source selection: sample journeys or configured provider flights.
- Separate sandbox/live labels; provider errors never substitute sample fares.
- Whole-group prices with exact minor-unit parsing and original currencies.
- Comparison within one currency; INR budgets are unavailable for other currencies.
- Quote timestamps, expiry, operating carrier, per-adult baggage and cancellation information.
- Server-signed, short-lived references for quote refresh and changed-price detection.
- Request validation, small-body limits, provider timeout, same-origin browser checks and per-instance burst limits.
- A deployable Cloudflare-compatible Worker using the same backend as the local server.

**Not implemented:** customer accounts, payment collection, ticket booking/issuance, live bus/train/cab adapters, background monitoring, or an LLM. The trip text helper remains rule-based. No endpoint creates an order or charges money.

## Run locally

Use Node.js 22.9+ (Node 24 recommended for the scripts).

    npm ci
    npm start

Open http://127.0.0.1:4173. No credentials are needed for sample mode.

    npm test
    npm run build

The build creates dist/server/index.js and deployment assets. Do not edit dist: source is in public/ and server/.

## Enable Duffel sandbox

1. Obtain a Duffel account and a test access token with offer-search access. Review the permitted comparison/display use and your intended market coverage.
2. Copy .env.example to .env. Keep .env private; it is ignored by Git.
3. Set DUFFEL_ACCESS_TOKEN to the test token and DUFFEL_MODE=sandbox.
4. Generate a signing secret locally and set OFFER_SIGNING_SECRET:

       node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"

5. Keep ENABLE_LIVE_SEARCH=false.
6. Restart npm start and select “Provider flights · Duffel”.
7. Search, open an offer and use “Refresh supplier quote”. Test inventory must remain labelled as test quotes.

Do not paste tokens into chat, browser code or GitHub. The signing secret protects quote references; rotate it to invalidate outstanding references. Tokens contain route/count/price metadata, never passenger identities or supplier credentials. Do not add personal data to them.

No credentialed Duffel API call has been performed as part of this milestone. Tests use controlled provider fixtures. The adapter is implemented but must be validated against your actual sandbox account.

## Production search (later)

After provider approval, set DUFFEL_MODE=live and ENABLE_LIVE_SEARCH=true with an appropriate live token. Both the request response and each offer must report live_mode=true. A mismatch fails closed. Live search does not enable booking.

Configure hosted secrets through Sites environment-variable management; local .env values are not uploaded. Set DUFFEL_ACCESS_TOKEN and OFFER_SIGNING_SECRET as secrets; DUFFEL_MODE and ENABLE_LIVE_SEARCH are runtime settings. Republish/apply the environment revision through the hosting workflow.

The site remains owner-private. Before opening access publicly, add authenticated quotas and distributed rate limiting at the gateway, evaluate provider query costs and contractual limits, and complete security/operational review. The in-memory limiter only protects one Worker instance and is not a global spend limit. A public deployment must not rely on it alone.

Duffel's billing currency may differ from INR. We show original currencies without conversion. Supported amount precision currently covers INR, USD, GBP, EUR, AUD, CAD, SGD, AED, JPY and KWD; other currencies are excluded and counted. Quotes include supplier taxes but may exclude additional services, payment-method surcharges and transfers. We do not claim a final all-in payable price.

## HTTP API

### GET /api/health

Reports service/version readiness, not provider connectivity.

### GET /api/providers

Returns public provider configuration, supported city/airport codes and bookingEnabled=false. No token or signing secret is returned. “ready” means configured, not that a successful supplier request has been verified.

### POST /api/search

Content-Type: application/json

    {
      "source": "duffel",
      "from": "Bengaluru",
      "to": "Chennai",
      "date": "YYYY-MM-DD",
      "travellers": 2
    }

Use source=sample for illustrative data. Dates must be today or later in Asia/Kolkata and at most 330 days ahead. Unknown fields, unsupported cities, same-city journeys and non-integer passenger counts are rejected.

Returns requestId, query, dataMode (sample/sandbox/live), checkedAt, normalized offers, per-source status, exclusion counts and warnings. Only one supplier adapter exists, so a supplier failure returns an error instead of a partial successful response.

An offer includes a group total in major units for display and integer totalMinor for comparison/reconciliation; currency; original provider ID; operating carrier; flight number; departure/arrival timestamps; quote expiry; per-passenger baggage; cancellation rules; and bookingEnabled=false. Supplier quotes have priceComplete=false because final checkout extras are not resolved.

The provider request explicitly asks for nonstop economy inventory. Up to 500 returned offers are normalized. Expired, wrong-route/date/passenger/cabin, unsupported-currency and incomplete offers are excluded. Response-time limits may omit airline results. Cancellation terms and baggage missing in the response remain unknown, not “free”.

### POST /api/offers/refresh

    { "reference": "<signed-reference-from-search>" }

Refreshes the precise offer server-side. The reference binds the provider ID, query, environment, previous amount/currency and expiry, with a maximum validity of 10 minutes. Returns updated offer, changed flag and previous amount/currency. This never creates a booking or makes a payment. A refresh does not guarantee availability at booking time.

### Errors

400 invalid input/reference, 403 cross-origin browser request, 404 unknown endpoint, 405 unsupported method, 410 unavailable/expired quote, 413 excessive body, 415 wrong content type, 429 local burst limit, 502 supplier response/failure, 503 missing configuration/access/busy provider, 504 supplier timeout. Public errors exclude raw provider diagnostics and secrets.

## Source map

- public/: browser interface and existing sample fare/parser functions
- server/app.js: API routes and request handling
- server/query.js: search validation and safe provider configuration
- server/providers/duffel.js: fixed provider endpoints and normalized offers
- server/offer-reference.js: HMAC-signed refresh references
- server/worker.js: Cloudflare Worker entry and public assets
- serve.mjs: local Node server using the same app
- scripts/build.mjs: esbuild Worker bundle and asset preparation
- tests/: fare engine and provider/API regression tests
- .openai/hosting.json: existing Sites identity (Worker deployment)

The Worker embeds text assets and serves the credited photograph from the platform asset binding where available, with a Wikimedia redirect fallback. No dependency on local disk at runtime.

## Next milestone

Validate real sandbox access. Then implement traveller accounts and a user-approved booking flow with supplier settlement/payment design, idempotent booking attempts, reconciliation and cancellation/refund handling. Do not enable automatic booking before these exist.

## Official integration references

- https://duffel.com/docs/api/offer-requests
- https://duffel.com/docs/api/offers
- https://duffel.com/docs/api/overview/welcome

## Photo attribution

“Konkan Railway” by Traveltwilight, Wikimedia Commons, CC BY-SA 4.0.
https://commons.wikimedia.org/wiki/File:Konkan_Railway.jpg
https://creativecommons.org/licenses/by-sa/4.0/
The original is retained in public/konkan-railway.jpg and displayed cropped. Attribution is also visible in the app.

## Milestone verification

22 automated engine/API tests passed, covering monetary precision, group totals, missing access, environment separation, timeouts, offer expiry, signed references, changed prices and request boundaries. Browser checks covered sample search and provider-unavailable handling, mobile layout, controlled supplier quote fixtures, currencies, refresh errors and stale-response protection. No credentialed supplier call was made. WebMCP actions were exercised with an instrumented registry; native WebMCP validation was unavailable in standard Chrome.
