# Architecture

The API authenticates humans and enforces workspace membership before every domain operation. Desktop inference receives the user's short-lived session token in memory and has only explicitly registered business tools. The renderer is isolated from Node; the preload bridge validates its originating frame and transports a narrow set of commands.

`packages/contracts` holds shared schemas. `packages/api-client` is the authenticated REST client. `packages/backend` owns the domain services, Postgres repositories, bucket persistence, and Finix integration. `packages/agent-runtime` runs Pi outside the UI process. `packages/pi-business-os` registers the supported business and navigation tools using Pi's extension API.

`apps/api` and `apps/worker` are thin entry points. The worker checks runnable workflows and acquires a session advisory lock per run. LangGraph's own checkpoint store persists graph state. Each interrupt receives a stable step record. Human assignments are materialized from a persisted routing snapshot; agent work uses expiring leases and rejects results from previous attempts. A response can be persisted before the graph resumes without losing it: a restarted dispatcher reads the stored response and resumes the same interrupt.

Brain revisions are immutable bucket JSON documents containing body, type, placement, source links, planning data, and approval evidence. Their numeric versions come from durable graph checkpoints. Replaying a projection must reproduce the same object; different content at the same version is rejected. Postgres indexes update only after the bucket write succeeds and can be rebuilt from the bucket. This deliberately avoids a dual source of truth for Brain content. Postgres remains authoritative for memberships, tasks, execution jobs, and workflow checkpoints.

The graph never performs provider calls directly. It asks for agent work, checkpoints, and waits for the designated user's local runtime. Independent exploration questions produce parallel jobs; their dependency graph is validated before dispatch. Research results and prototypes are temporal records. A feature workflow ends at an approved technical plan.

Human decisions are explicit UI/API actions with assignee, current role, and revision checks. The agent cannot use an approval tool. Peer review excludes the engineer who performed the technical interview. Finix credentials and webhook verification remain on the server; the desktop reads normalized transfer projections.

Production code does not contain fixture data or alternate authentication. Local verification supplies test inputs through public interfaces and uses real database and object-storage protocols. The test UI entrypoint is excluded from packaging. Pi and its bridge are unmodified dependencies. A narrow dependency override selects the patched Undici release used by Pi; it changes no provider behavior.
