# Business OS

An Electron collaboration app with a TypeScript API, durable LangGraph workflows, and a local Pi agent using the existing `pi-claude-bridge` extension. Brain records and immutable revisions live in Railway buckets. Postgres stores operational state and a rebuildable Brain index.

## Run the backend

Requires Node 24, Postgres, an S3-compatible bucket, and Clerk configuration.

```sh
npm ci
cp .env.example .env
# Populate the server environment.
npm run migrate
npm run dev
# In another terminal:
npm run worker
```

The API listens on port 3000. All workspace endpoints require a valid Clerk session token and membership. There is no development authentication bypass. `GET /health` is public.

## Build the desktop

Put the public variables from `.env.desktop.example` in `.env.local`. Never place a Clerk secret, bucket credentials, or Finix credentials in the desktop build environment.

```sh
npm run package
```

The macOS application is written to `out/Business OS-darwin-arm64/Business OS.app` on Apple Silicon. Open the packaged app for Google OAuth; the development browser is not a replacement for native OAuth validation.

In Clerk, enable Native API and Google sign-in, and allow the origin `business-os://renderer`. Set the published API URL and Clerk Frontend API host in the desktop build configuration. The app uses Clerk's native Electron transport and encrypted session storage.

Create a workspace and use Team to invite teammates, review invitation status, revoke unused codes, change roles, and remove members. Codes are single-use, expire after 1–30 days, and are stored only as hashes. Share codes privately; email delivery is not configured. Recipients sign in with Google and use Join workspace, which is also available to existing workspace members. The last owner cannot be demoted or removed. Complete assigned tasks and owned workflows before removing a member; removal invalidates their accepted invitation so it cannot restore access. Configure review rules inside each workflow’s detail view. Rules apply only to that workflow; its creator or a workspace owner can edit them. Existing assigned tasks retain their original review policy, and completed workflows are read-only. The creator begins with the `owner` role. A pricing rule can require `owner` approval, or assign a teammate the `ceo` role and route pricing to them. Feature design review requires two people with the `engineer` role.

Connect Claude through its official sign-in flow. The application loads `pi-claude-bridge` through Pi's extension loader; it does not extract credentials or implement a provider protocol. Claude credentials remain managed by Claude Code. Codex is intentionally not implemented in steps 1–7.

Closing the app terminates local inference. Unfinished job leases expire and can be claimed on reopening. Failed jobs show their error and offer Retry. Human decisions and completed workflow checkpoints survive desktop and server restarts.

## Workflows

ADR review classifies a proposal against configured domains, assigns approval and acknowledgment tasks, loops through revisions, and publishes the approved revision to canonical Brain. An approval is tied to its workflow revision and assigned role. Revision changes invalidate previous decisions.

Feature planning collects product requirements, creates a parent exploration map and typed child questions, runs independent research/prototype jobs concurrently, and waits for prerequisite questions. It then routes product review, collects an engineering interview, prepares a design, and requires a different engineer's approval. Maps, questions, findings, and final decisions are stored in Brain. Prototype HTML is displayed in a sandboxed iframe without script permissions.

The agent can search Brain, read payments and tasks, save research, start workflows on request, and navigate the app through typed commands. Human approval endpoints are not exposed as agent tools. Stop guiding disables automatic navigation.

## Payments

Set `FINIX_USERNAME` and `FINIX_PASSWORD` on the API service. The deployment operator associates these credentials with the intended Business OS workspace in `integration_connections`, using credential slot `finix_sandbox`. This is a database association, not a Finix-issued ID. The unique credential slot prevents the same server-side account from being exposed to another workspace. Opening Payments automatically imports the latest paginated transfers and displays a loading state. All workspace members can read and refresh their workspace’s connected payment data. Failed requests show a retry action rather than an empty-account message. Configure an authenticated Finix webhook at `/webhooks/finix`, with a bearer token matching `FINIX_WEBHOOK_TOKEN` and the signing key in `FINIX_WEBHOOK_SECRET`. The endpoint verifies raw-body signatures, rejects stale deliveries, deduplicates event IDs, and fetches current transfer state. Payments are read-only; no charge or refund operation exists.

## Railway

Create Postgres, a bucket, and services named `business-os-api` and `business-os-worker`. Link the checkout to the intended Railway project and configure server variables from `.env.example`, using `${{Postgres.DATABASE_URL}}` for the private database connection. Deploy each service with `node scripts/deploy-railway.mjs api <project-id>` and `node scripts/deploy-railway.mjs worker <project-id>`. The script applies `infra/railway-services.json` through Railway's API, then uploads the source. Both use `infra/Dockerfile`; the worker has a separate start command. Migrations are serialized with a Postgres advisory lock. The worker initializes LangGraph's Postgres checkpoint schema. Railway's deprecated TOML configuration is not used.

Use the bucket endpoint style from Railway's credentials. Keep credentials server-side. Bucket revisions use conditional creation to reject overwrites; native bucket versioning is unnecessary. The owner can rebuild the searchable Brain index in Settings.

## Verification

```sh
npm run build
npm test
docker compose -p business-os-tests -f tests/compose.yml up -d --wait
npm run test:integration
node tests/support/ui-smoke.mjs
node tests/support/desktop-smoke.mjs
npm run test:agent
```

Integration tests use isolated Postgres and MinIO containers and signed test JWTs verified through the real Clerk verification code. Test credentials, simulated provider results, and UI fixtures exist only under `tests/`. The UI test harness uses installed Chrome. Desktop verification opens the packaged app. The final agent check requires a current local Claude sign-in and makes one short inference request.

Run `docker compose -p business-os-tests -f tests/compose.yml down` when finished. No production service selects a test implementation based on an environment flag.

See `docs/implementation-status.md` for verified behavior and external configuration still required.
