# Project Rev — accounts and sandbox flight booking

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

- Sandbox checkout with passenger validation, refreshed price review, explicit confirmation, a test booking reference and status recovery.
- Durable booking attempts: local SQLite and hosted D1. A unique offer claim is saved before an order POST. Ambiguous results are reconciled through order reads, never automatically resubmitted.

- Sign-in, account-owned checkout and private, paginated booking history with status recovery.
- Local email/password test accounts and hosted ChatGPT sign-in. Accounts and bookings are separate between environments.

**Not implemented:** real payment collection, live ticket booking/issuance, live bus/train/cab adapters, background monitoring, or an LLM. The trip text helper remains rule-based. Order creation is restricted to test tokens and sandbox mode.

## Run locally

### Stakeholder prototype

Open **http://127.0.0.1:4173/demo.html** for the standalone stakeholder walkthrough. It needs no account, provider credentials or paid API calls. The main app also links to it from the desktop navigation.

- Try the value, arrival-time and group-trip scenarios, or change the four supported sample corridors and trip rules.
- Compare illustrative ticket totals plus fixed group transfer estimates. Recommendations enforce the budget, same-day arrival deadline and sample confirmed seats.
- Review a selected option and explicitly approve one simulation. Demo references begin with `DEMO-` and are never valid travel tickets.
- Demo receipts exist only in page memory and clear on reload or **Reset demo**. They never enter the real account booking database.
- Use **Presentation guide** for a three-minute walkthrough and an honest description of what remains to build.

This page runs a deterministic rules engine in the browser. It does not use an AI model, actual traffic/address data, live availability, payment processing or background booking. All prices, schedules and transfer assumptions are examples. Development-app accounts and Duffel sandbox bookings remain separate.

### Development app

Use Node.js 24 for the local SQLite-backed server and scripts.

    npm ci
    npm start

Open http://127.0.0.1:4173. No credentials are needed for sample mode.

Choose **Sign in → Create account** to make a local test account. Passwords must be 15–128 characters. Use **My bookings** to see bookings made while signed in. The local server must remain running while using the app.

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
7. To enable test bookings, set ENABLE_SANDBOX_BOOKING=true and restart. A test token with read/write access and durable storage are required. Local storage is initialized from the checked-in migrations at startup.
8. Sign in, search, open Fare details, choose Continue to test booking, then Fill test details. Review the details and tick the confirmation box before confirming. Use fictional passenger details; no card is collected or charged. Find the result under My bookings.

Do not paste tokens into chat, browser code or GitHub. The signing secret protects quote references; rotate it to invalidate outstanding references. Tokens contain route/count/price metadata, never passenger identities or supplier credentials. Do not add personal data to them.

Credentialed sandbox search, quote refresh and one complete test booking have been verified. The browser test also recovered the same confirmation after reload. Live booking remains disabled regardless of the live-search flag.

## Production search (later)

After provider approval, set DUFFEL_MODE=live and ENABLE_LIVE_SEARCH=true with an appropriate live token. Both the request response and each offer must report live_mode=true. A mismatch fails closed. Live search does not enable booking.

Configure hosted secrets through Sites environment-variable management; local .env values are not uploaded. Set DUFFEL_ACCESS_TOKEN and OFFER_SIGNING_SECRET as secrets; DUFFEL_MODE and ENABLE_LIVE_SEARCH are runtime settings. Republish/apply the environment revision through the hosting workflow.

The site remains owner-private. Before opening access publicly, add authenticated quotas and distributed rate limiting at the gateway, evaluate provider query costs and contractual limits, and complete security/operational review. The in-memory limiter only protects one Worker instance and is not a global spend limit. A public deployment must not rely on it alone.

Duffel's billing currency may differ from INR. We show original currencies without conversion. Supported amount precision currently covers INR, USD, GBP, EUR, AUD, CAD, SGD, AED, JPY and KWD; other currencies are excluded and counted. Quotes include supplier taxes but may exclude additional services, payment-method surcharges and transfers. We do not claim a final all-in payable price.

## HTTP API

### GET /api/health

Reports service/version readiness, not provider connectivity.

### GET /api/providers

Returns public provider configuration, supported city/airport codes, bookingEnabled=false for real bookings, and a separate sandboxBookingEnabled flag. No token or signing secret is returned. “ready” means configured, not that a successful supplier request has been verified.

### Accounts and history

- GET /api/account: returns the current account or null, auth mode and hosted sign-in/out links. Responses are not cached.
- GET /api/bookings/history: requires sign-in; returns up to 20 owned attempts with a nextCursor. Pass cursor to retrieve the next page. It cannot select another owner.
- Local-only POST /api/auth/register, /api/auth/login and /api/auth/logout: require same-origin JSON requests. Hosted sign-in/out use the platform routes instead.

Local passwords use salted scrypt hashes; opaque sessions use an HttpOnly, SameSite=Strict cookie and expire after seven days. Session tokens are stored as hashes. Persistent login and registration throttles limit repeated attempts. Local test accounts have no email verification or password reset and are not a production identity service.

The hosted Worker trusts Sites-injected identity headers and creates a profile on first authenticated use. The local server strips those headers and resolves its own session, so submitting them locally cannot impersonate a hosted user. Hosted accounts use ChatGPT sign-in; local passwords are never uploaded.

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

400 invalid input/reference, 401 sign-in required or invalid login, 403 cross-origin browser request, 404 unknown endpoint or inaccessible booking, 405 unsupported method, 409 duplicate local account, 410 unavailable/expired quote, 413 excessive body, 415 wrong content type, 429 burst limit, 502 supplier response/failure, 503 missing configuration/access/busy provider, 504 supplier timeout. Public errors exclude raw provider diagnostics and secrets.

## Source map

- public/: browser interface and existing sample fare/parser functions
- server/app.js: API routes and request handling
- server/query.js: search validation and safe provider configuration
- server/providers/duffel.js: fixed provider endpoints and normalized offers
- server/offer-reference.js: HMAC-signed refresh references
- server/accounts.js: hosted identity and account profiles
- server/local-auth.js: local-only password hashing and sessions
- public/accounts.js: sign-in, profile and booking history interface
- server/worker.js: Cloudflare Worker entry and public assets
- serve.mjs: local Node server using the same app
- scripts/build.mjs: esbuild Worker bundle and asset preparation
- tests/: fare engine and provider/API regression tests
- .openai/hosting.json: existing Sites identity (Worker deployment)

The Worker embeds text assets and serves the credited photograph from the platform asset binding where available, with a Wikimedia redirect fallback. No dependency on local disk at runtime.

## Sandbox booking API and persistence

- POST /api/bookings/prepare: accepts a signed offer reference and one passenger object per adult. Refreshes the offer and returns the review quote and a signed checkoutToken. This does not create an order.
- POST /api/bookings/confirm: accepts checkoutToken, the same passengers and confirmed=true. Rechecks price, itinerary and fare conditions. Changes require another review. Uses only Duffel's simulated balance and server-derived passenger IDs/amounts.
- POST /api/bookings/status: accepts exactly one of checkoutToken or an owned attemptId and returns not_submitted, unknown, rejected or confirmed. A confirmed result contains the booking reference and full supported itinerary. Unknown results never trigger another POST; check status or investigate the test order in the Duffel dashboard.

All booking endpoints require sign-in. Checkout tokens bind the account, and status/history queries enforce ownership. Another account cannot recover a booking even with its token or attempt ID. Older anonymous bookings remain unassigned; they are not attached to the first account that signs in.

Passenger fields are given_name, family_name, title (mr/ms/mrs/miss/dr), gender (m/f), born_on (YYYY-MM-DD), email and phone_number (international format). Only adults aged 18–120 on departure are supported. Offers requiring identity documents are not supported yet. No identity documents or cards are collected.

Checkout reviews expire after five minutes or at offer expiry, whichever is sooner. Recovery tokens last seven days. They contain a passenger digest, not names/contact details. Passenger details stay in page memory and go to Duffel's sandbox only when confirming; they are not stored in our booking database. The database retains the owned attempt, route context, state and confirmation without passenger names/contact details. Account profiles separately retain the user's name and email. A tab-local recovery token in sessionStorage is scoped to the signed-in account; My bookings provides durable history after closing the tab. Signing out or changing accounts clears the checkout view.

Local SQLite is in ignored .local-data/bookings.sqlite. Do not delete it to retry an uncertain booking. Hosted D1 uses the DB binding and checked-in Drizzle migrations. Generate schema changes with `node node_modules/drizzle-kit/bin.cjs generate`; local startup applies pending migrations. Keep applied migrations immutable. Local and hosted databases are separate.

The hosted site does not inherit .env. Sandbox booking remains disabled there until its own test token, signing secret and ENABLE_SANDBOX_BOOKING=true are securely configured. Keep the site owner-private while distributed quotas, operational reconciliation and webhook processing remain future work.

## Next milestone

Add cancellation/refund handling and a real payment/settlement design. Complete reliability and operational checks before enabling real bookings or any automatic booking.

## Official integration references

- https://duffel.com/docs/api/offer-requests
- https://duffel.com/docs/api/offers
- https://duffel.com/docs/api/overview/welcome
- https://duffel.com/docs/api/v2/orders
- https://duffel.com/docs/api/overview/response-handling

## Photo attribution

“Konkan Railway” by Traveltwilight, Wikimedia Commons, CC BY-SA 4.0.
https://commons.wikimedia.org/wiki/File:Konkan_Railway.jpg
https://creativecommons.org/licenses/by-sa/4.0/
The original is retained in public/konkan-railway.jpg and displayed cropped. Attribution is also visible in the app.

## Milestone verification

Automated engine, API, account and booking tests cover monetary precision, group totals, missing access, environment separation, offer expiry, signed references, changed prices, passenger validation, explicit consent, concurrent confirmation, durable attempt reuse, ambiguous response recovery and storage failures. Account tests cover password/session handling, expiration, throttling, ownership, legacy records and history pagination. Browser checks cover mobile layouts, registration, sign-in/out, sandbox confirmation, history after reload and isolation between two accounts. Credentialed supplier checks used test mode only. WebMCP search was previously exercised with an instrumented registry; native WebMCP validation was unavailable in standard Chrome. Booking is not exposed as an agent tool.
