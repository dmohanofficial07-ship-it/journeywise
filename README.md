# Farewise
India-first travel comparison prototype.

## Run
Requires Node.js 20+:
- `npm start` serves http://127.0.0.1:4173.
- `npm test` checks fare normalization and query validation.
No dependencies or API keys required for the prototype.

## Implemented
Responsive fare comparison across flights, trains, buses, and cabs; group totals; mandatory sample fee breakdowns; sorting; budgets; seat status; vehicle capacity; limited trip text parser; accessible detail dialogs and generic provider homepage handoff.

Four sample routes, bidirectional: Bengaluru–Chennai, Mumbai–Pune, Delhi–Jaipur, Bengaluru–Hyderabad.
All operators, schedules, fares and seat availability are fictional. Selected dates label examples and do not produce live/date-specific pricing. Cab examples are intercity, not live local ride-hailing.

## Current limitations
Zero live provider integrations. No LLM or agent runtime. The text assistant is an explicitly labelled rule-based prototype supporting routes, numeric adult counts, ISO dates/today/tomorrow and INR budgets. No purchases, accounts, scheduled alerts, user data collection or booking guarantees. Filters rank transport duration, not door-to-door journey time. External links open generic provider pages without transferring quotes.

## Live product integration plan
1. Obtain permitted fare-search and comparison access for each target provider. Validate contractual coverage; never assume API availability grants competitive comparison rights.
2. Replace sample search with a server-side orchestrator that calls approved adapters in parallel with independent timeouts and reports success/timeout/unsupported per source.
3. Each adapter must return provider and offer IDs, route and timezone-aware departure/arrival, passenger composition, currency, price basis, base/taxes/mandatory fees, baggage/extras, availability, seats/capacity, cancellation rules, checkedAt/expiresAt, booking URL and source attribution.
4. Normalize all offers to whole-group INR totals. Unknown mandatory fees must mark totals incomplete and exclude offers from a verified cheapest claim. Retain distinct vendors for the same journey; group equivalent itineraries to compare vendor totals. Keep estimates separate from confirmed quotes and waitlists separate from confirmed seats.
5. Add an LLM behind a server endpoint for structured trip interpretation and tool selection. Validate its output; calculate totals and ranking in code. Provider responses are untrusted data. Only show verified adapter prices.
6. Revalidate selected quotes before handoff. Show providers queried, unavailable sources, retrieval times, offer expiration, exact conditions and price changes.
7. Add airport/station transfers, buffers and arrival constraints before offering door-to-door comparisons. Connecting journeys need feasible interchange times and missed-connection handling.
8. Keep vendor/API/model secrets server-side. Rate limit public search, bound provider budgets, avoid logging passenger details, and add privacy/retention controls before collecting personal information.

Suggested provider discovery: airline/distributor APIs for flights; licensed bus suppliers; authorized IRCTC access for rail; cab providers with explicit comparison permission. Commercial access is not configured.

## Structure
- dist/engine.js: sample data, totals, validation, filters, limited text parser
- dist/app.js: page state, rendering, details, WebMCP search tool
- dist/index.html, dist/style.css: interface
- tests/engine.test.js: regression checks
- serve.mjs: local static server
- .openai/hosting.json: Sites identity and static deployment config

## Image attribution
Konkan Railway by Traveltwilight, Wikimedia Commons.
https://commons.wikimedia.org/wiki/File:Konkan_Railway.jpg
https://creativecommons.org/licenses/by-sa/4.0/
Original photo bundled at dist/konkan-railway.jpg, displayed cropped with CSS. Photo rights remain CC BY-SA 4.0; attribution is also visible in the app.

## Verification
Fare engine tests and JS syntax checks are automated. Browser WebMCP validation requires a supported browser; if unavailable, this is not a claim of WebMCP interoperability.
