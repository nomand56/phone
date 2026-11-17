# AI receptionist production delivery plan

Requirements baseline for planning: SRS-AIR-001 v1.0, dated November 16, 2026, draft pending approval. The requirement IDs below point to the SRS. Canada-first and a two-business pilot are planning assumptions. Auto repair and its intake fields remain a proposed pilot choice under OD-06.

The commercial MVP supports verified owner signup, agent configuration from approved business facts, and self-service activation of a Canadian voice number. The agent answers inbound calls, captures confirmed callback details, and uses a safe fallback on failure. Owners review calls and leads, receive email alerts, and manage billing. Platform administrators oversee tenants, numbers, spend, and incidents.

## Production architecture

| Component | Responsibilities |
| --- | --- |
| Next.js | Responsive onboarding, agent editor and preview, number selection, calls, leads, analytics, billing, and separate platform administration. Deploy behind a CDN and web application firewall. |
| NestJS | Versioned REST API, identity and tenant authorization, provider webhook ingress, and a raw WebSocket service for Twilio ConversationRelay. Run multiple replicas behind TLS/WSS ingress with tested timeouts and graceful connection draining. |
| PostgreSQL | Managed private database for tenant records, calls, number lifecycle, billing and usage ledgers, audit events, provider event receipts, and a transactional outbox. Use tenant-scoped foreign keys and indexes, encryption, and point-in-time recovery. |
| Redis and workers | Use Redis for bounded call context, rate limits, and job queues. Persist durable events and checkpoints in PostgreSQL so a Redis restart can be recovered. Use bounded backoff and a dead-letter workflow. |
| Providers | Twilio Voice and ConversationRelay for phone calls and speech, OpenAI for streamed responses and post-call extraction, Stripe for hosted checkout and customer portal, and a transactional email provider. Wrap provider access and keep test and live credentials, data, and numbers separate. |

Use infrastructure as code and a managed secrets store. Keep production caller data out of local development and staging fixtures. Review the illustrative API in SRS §8 before freezing endpoint names. Start with signed `POST /webhooks/twilio/voice`, `POST /webhooks/twilio/status`, and `WS /voice/sessions`. Use versioned JSON contracts, E.164 phone numbers, UTC storage, cursor pagination, and stable error codes.

## 1. Establish the tenant and agent foundation

**SRS FR-ID, FR-TEN, FR-UI, NFR-SEC.** Create the workspace, CI, local PostgreSQL and Redis, migrations, and fictional data for two businesses. Implement email/password signup, verification, login, reset, logout, session revocation, account closure, and abuse limits. Bind each protected action to server-verified tenant membership. Enforce isolation in API, jobs, and files, with PostgreSQL row-level security as defense in depth for shared tables.

Build step-by-step owner onboarding for business details, time zone, hours and holidays, services, prices where applicable, service area, and FAQs. Add one agent draft per business, a test-call path for unpublished settings, and audited publish and disable controls. Pin the published agent version when a call starts. Enforce privileged platform administrator MFA, short-lived sessions, least privilege, and audited break-glass access per NFR-SEC-008.

**Exit evidence.** An owner can verify their email, configure a tenant, preview an agent, and publish a version. An unverified account cannot start a paid number purchase. Two tenants cannot access each other's records. New agent versions affect subsequent calls.

## 2. Prove inbound voice and post-call processing

**SRS FR-CALL, FR-AI, FR-CRM, FR-REC, FR-NOT.**

1. Assign one Twilio test number manually. Validate provider signatures on HTTP callbacks and the WebSocket handshake against the public ingress URL. Resolve the destination to one active tenant, number, and agent, and bind the relay to the known provider account and call ID. Give unknown, unassigned, or suspended numbers a safe default.
2. Get a scripted reply working on a real phone, then stream OpenAI responses based on the published tenant facts. Identify the business and the AI assistant, apply approved transcription notice and consent controls, support interruption, and bound silence, call length, model timeout, and per-plan concurrency. Offer message-taking or callback for uncertainty. Confirm material details and distinguish confirmed values from model inferences. Keep action permissions server-side, reject unsafe tool requests, and use approved urgent-caller guidance.
3. Record call state transitions, outcome, duration, and authorized turn history. Match status callbacks to one logical call and handle duplicates, reordering, and missing status. Flush pending turns before post-call processing, with a bounded wait and a partial flag when needed. Store the event and queue work transactionally. Keep the call visible if transcript or summary processing fails.
4. Ship the responsive call list and detail view, with search, filters, pagination, consent indicators, and transcript/summary where permitted. Add a lead inbox with status updates and suggested duplicate contacts for review. Show essential metrics for incoming, answered, failed and abandoned calls, average duration, and leads. Send configurable email summaries to verified recipients with minimal caller data, deduplication, and delivery status.

**Exit evidence.** A handset reaches the right agent, gets an approved FAQ answer, interrupts a response, and leaves one callback request. The call produces one tenant-scoped record, supported summary, lead, and eligible email. Invalid signatures, unrelated questions, ambiguous details, silence, hang-up, and model failure produce their expected outcomes.

## 3. Deliver self-service numbers, subscriptions, and operator controls

**SRS FR-NUM, FR-BILL, FR-OPS, FR-UI.** Complete these flows before the commercial MVP pilot.

- **Activation.** Search Canadian voice-enabled inventory by area code. Show locality, capabilities, and recurring charges. Recheck availability at purchase time. Start a durable, idempotent provisioning job only after identity, payment entitlement, and applicable telecom documentation checks pass. Record the provider account, immutable number SID, E.164 number, tenant, and lifecycle events. Enforce unique active assignments and verify webhook configuration before displaying `ACTIVE`.
- **Recovery and release.** Reconcile an ambiguous provider success or database write failure against provider inventory before retrying. Recover or quarantine unassigned numbers, flag unavailable assignments, and audit each transition. Require explicit confirmation for release, preserve historical call links, and apply the approved cancellation, retention, and port-out support policy. Check inventory and provider charges daily.
- **Billing.** Use Stripe Checkout and Customer Portal. Verify signed webhooks and deduplicate deliveries. Reconcile against current Stripe state and define entitlements for trialing, active, past-due, grace, suspended, and cancelled accounts. Disclose minute, number, and concurrent-call allowances. Persist tenant-scoped call duration, provider charges, and AI usage where available, with estimated and finalized amounts distinguished. Apply entitlement changes to new sessions and allow active calls to complete. Add quota, spend, and fraud alerts.
- **Administration.** Give privileged operators a separate view of tenant status, provisioning failures, provider inventory, billing discrepancies, and incidents. Require a recorded justification for sensitive access and administrative changes. Provide controls to disable a compromised number or tenant and preserve incident evidence under policy.

**Exit evidence.** A verified owner can search, pay, activate, and test a number without developer assistance. Missing compliance, failed payments, expired inventory, duplicate requests, and provider success followed by local failure produce recoverable states without duplicate purchases. Reconcile provider inventory, Stripe entitlements, and the usage ledger before accepting live payment.

## 4. Prepare production and run the limited pilot

**SRS COM-01–12, NFR-SEC, NFR-AVL, NFR-OBS, NFR-UX, §§11–13.**

- **Privacy and security.** Approve launch jurisdiction, processor agreements and locations, disclosure, transcript retention, privacy requests, lawful holds, deletion, and incident handling with the privacy reviewer. Keep recording off by default and enforce any future enablement and consent gate. Apply retention to transcripts and summaries, audit exports and deletions, and rehearse reapplying deletes after restore. Keep caller speech, sensitive details, tokens, and secrets out of routine logs. Test cross-tenant IDs, listings, exports, jobs, and provider routing. Verify keyboard, form labels, status announcements, time-zone handling, and supported browsers against the SRS accessibility and compatibility targets.
- **Failure and recovery.** Configure and rehearse a Twilio fallback for webhook or relay failure that is independent of the primary app. Match each shop's approved caller fallback to the MVP policy. Exercise unavailable model, expired credentials, database and Redis interruption, worker interruption, WebSocket reconnect, and deploy draining. Reconcile undelivered events and inspect replay for duplicate external effects. Run daily backups and validate RPO of 15 minutes or less and RTO of 4 hours or less in a quarterly drill.
- **Operability.** Correlate call, tenant, provider, and worker identifiers in traces. Add synthetic calls and alerts for call setup latency, provider errors, queues, dead-letter counts, orphan numbers, spending spikes, and billing drift. Use staged CI/CD with migration checks, vulnerability scans, smoke calls, and rollback. Assign incident and customer support owners and rehearse security, provider, billing, and number-misassignment runbooks.
- **Pilot.** Start with two approved businesses and a dedicated number per tenant. Record manual carrier-forwarding instructions and a reversal procedure if pilot owners use their existing carrier's forwarding. Keep guided in-product forwarding in P2. Track connection, outcome, failure, setup time, and provider cost. Measure target attainment and review accuracy and callback usefulness with owners before expansion.

## Acceptance and rollout

| Coverage | SRS evidence to retain |
| --- | --- |
| Signup, number inventory, checkout, and purchase recovery | AT-01–07. Include verified email, missing compliance, failed payment, and the provider-success/database-failure case. |
| Routing, speech, intake, and published agent versions | AT-08–15 and AT-24. Include 100% pass rate on deterministic tenant routing and rejection of forged signatures. |
| Recording, cross-tenant access, privacy requests, and privileged access | AT-16–19 and AT-23. Include consent enforcement, denied cross-tenant access, and an audit event for privileged reads. |
| Cancellation, inventory, and capacity | AT-20–22. Validate cancellation and number lifecycle, daily inventory reconciliation, and 100 concurrent active calls in staging before broad general availability. |

Use the SRS pilot targets of at least 90% of eligible inbound calls connected to the agent, at least 95% of completed calls classified, under 2% platform failures, zero known cross-tenant exposures, full purchase reconciliation, and median setup under 15 minutes excluding regulatory checks. Track fallback separately. Measure p95 first token within 1.5 seconds after transcription and p95 first audible response within 3 seconds under the agreed test load. Test p95 business API latency of at most 500 ms and p99 at most 1.5 seconds excluding provider time, and p95 calls-list load within 2 seconds for 100,000 tenant records. Track the proposed 99.5% beta and 99.9% general availability targets with provider outages reported separately.

Before general availability, pass AT-01–24, map every mandatory requirement to an executable check or reviewed evidence, clear critical and high tenant-isolation findings, complete a recovery drill and live cost reconciliation, and obtain the §18 sign-offs. Launch to one paying business first, then review real number routing, notifications, and billing before each expansion.

## Decisions to close before release

- **Product and finance, OD-01–03, OD-05–06, OD-10.** Confirm entity, domain, support, launch countries and number types, price and allowances, first customer segment, carrier-forwarding scope, and cancellation and port-out handling.
- **Engineering and privacy, OD-04 and OD-07–09.** Confirm recording enablement scope, transcript defaults, notice and consent, provider subaccounts, hosting locations and subprocessors, and post-pilot reliability commitments. The SRS treats recording as optional while FR-REC-008–009 and AT-16–17 require recording controls. Plan for safe-off enforcement and require approval before enabling customer recordings.
- **Release alignment.** NFR-SEC-008 puts privileged admin MFA in the production baseline even though FR-ID-008 is marked P2. Owner MFA and team invitations follow P2. If the approved MVP fallback dials a shop destination, document its treatment under COM-08 before enabling it. The baseline fallback can use an announcement or approved message-taking.
- **Later releases.** P2 includes website import, transactional SMS, booking, live and warm transfers, guided carrier forwarding, multiple numbers, porting, team permissions, and more languages. P3 includes CRM, mobile apps, broader outbound and messaging workflows, and multi-provider support.

## First work session

Scaffold the TypeScript workspace with `frontend` and `backend`, local PostgreSQL and Redis, and CI checks. Add the tenant and membership migration, seed two fictional businesses, and write the first two-tenant authorization test. Then add agent draft and publish support and connect the signed voice webhook to one manually assigned test number for the first handset call.
