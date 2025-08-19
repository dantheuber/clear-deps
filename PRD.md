# PRD: Proactive Dependency Topology & Monitoring Service

## 1. Summary

A backend + React web UI that:

- Registers services (name + dependency status endpoint URL exposing proactive-deps JSON).
- Polls each registered service on schedule.
- Normalizes and stores dependency graphs.
- Builds a unified directed graph of service -> dependencies (including cross-linking when a dependency is itself a registered service).
- Exposes APIs for current status, historical snapshots, topology graph, and alert surfaces.

## 2. Goals

- Central view of all service dependency health.
- Enable impact analysis (if X fails, what depends on it).
- Historical tracking of dependency status.
- Lightweight adoption: only need each service to expose proactive-deps endpoint.

## 3. Non-Goals

- Active remediation.
- Deep synthetic transaction monitoring.
- Log or trace collection.
- RBAC beyond simple admin/user (v1).

## 4. Key Metrics

- Poll success rate (%).
- Latency of polling cycle (p95).
- Time to reflect a dependency status change (< 60s default).
- Graph build time (< 2s for 500 services).
- UI TTI < 3s on 50k edge graph (progressive load).

## 5. Personas

- Dev / Engineer: Registers service, inspects dependency health.
- SRE / Ops: Monitors systemic risk, triages outages.
- Engineering Manager: Views blast radius and trends.

## 6. User Stories

1. Register a service with name, environment (optional), and dependency endpoint URL.
2. View list of services with aggregate status (OK / WARN / ERROR / UNKNOWN).
3. Inspect a service detail: its direct dependencies, their statuses, last polled time, raw JSON.
4. Visualize entire dependency graph with filtering (by status, environment, text search).
5. See reverse dependencies (who depends on this service).
6. View timeline of a dependency status over past N hours.
7. Trigger an on-demand refresh of a single service.
8. Export graph as JSON.
9. Receive webhook (future) when a status transitions severity.

## 7. Functional Requirements

### 7.1 Service Registration

- Fields: id (UUID), name (unique per environment), environment (enum/string), endpointUrl (HTTPS), tags (key:value), owner (string/email), createdAt, updatedAt, pollIntervalOverride (optional).
- Validation: reachable URL (HEAD optional), name uniqueness.

### 7.2 Polling Engine

- Default global poll interval (config, e.g. 60s).
- Per-service override (>= minimum interval).
- Concurrency control with worker pool (config max parallel).
- Backoff with jitter on failures (exponential up to maxBackoff).
- Retry count tracking.

### 7.3 Dependency Ingestion

- Fetch JSON from proactive-deps endpoint (assumed schema: list of dependencies with name, type, status, optional metadata).
- Normalize statuses to enum: OK, WARN, ERROR, UNKNOWN.
- Each dependency record tied to parent service poll run (pollRunId).
- If dependency name matches a registered service name+environment, create link edge (service <-> service).

### 7.4 Graph Construction

- Directed edges: service -> dependency (dependency may be external or internal).
- For internal matches, unify node identity.
- Maintain materialized adjacency for fast queries; rebuild incrementally after each poll run.
- Detect cycles (store boolean flag per cycle-involved node).

### 7.5 Status Derivation

- Service overallStatus = worst(severity of direct dependencies, self-reported if included).
- Severity ordering: ERROR > WARN > UNKNOWN > OK.

### 7.6 Historical Storage

- Store each poll result snapshot (compressed JSON) + flattened dependencies for querying last N (config retention: e.g. 30 days).
- Time-series table keyed by (serviceId, dependencyName, timestamp, status).

### 7.7 APIs (REST; JSON)

Base: /api/v1

- POST /services
- GET /services
- GET /services/{id}
- PATCH /services/{id}
- DELETE /services/{id}
- POST /services/{id}/refresh (async trigger)
- GET /services/{id}/dependencies (current)
- GET /services/{id}/reverse-dependents
- GET /graph (query params: environment, status filter, includeExternal=bool)
- GET /services/{id}/history?from=&to=&dependencyName=
- GET /export/graph (full raw)
  Errors: standardized problem+json.

### 7.8 Auth (v1 Simplified)

- API key header (x-api-key) for mutations.
- Read endpoints optionally public (config).

### 7.9 UI (React)

- Pages:
  - Dashboard: summary counts, status distribution.
  - Services list: sortable, filterable, inline status pill.
  - Service detail: tabs (Dependencies, Reverse, History (chart), Raw JSON).
  - Graph view: force-directed / hierarchical toggle, search, status legend, highlight path to root causes.
  - Registration form.
- State mgmt: React Query.
- Adaptive polling for live refresh (backoff on inactivity).
- Error handling banners.

### 7.10 Alerting (Future Flag)

- Outbound webhook on status transition crossing severity threshold.

## 8. Data Model (Proposed)

Tables (SQL-esque):

- services(id, name, environment, endpoint_url, tags_json, owner, poll_interval_override_sec, created_at, updated_at)
- poll_runs(id, service_id, started_at, finished_at, success, http_status, duration_ms, error_message)
- dependencies(id, poll_run_id, parent_service_id, dependency_name, dependency_type, mapped_service_id (nullable), status, meta_json)
- service_status_current(service_id, overall_status, updated_at)
- dependency_history(id, service_id, dependency_name, timestamp, status)
- graph_edges(id, from_service_id, to_service_id, dependency_name, status, updated_at)

Indexes on (service_id, dependency_name, timestamp desc), (name, environment unique).

## 9. Status Mapping

Input -> Internal:

- success/healthy/ok => OK
- warn/degraded => WARN
- error/fail/down => ERROR
- unknown/missing => UNKNOWN (default fallback)

## 10. Polling Flow

1. Scheduler selects due services.
2. Dispatch to worker; GET endpoint.
3. Parse & validate schema.
4. Insert poll_run + dependencies.
5. Map internal links.
6. Recompute service overall status.
7. Update graph edges.
8. Persist history rows (diff-only optional future).
9. Emit events (internal bus) for UI subscription.

## 11. Performance Targets

- 500 services, each up to 50 dependencies: poll cycle < 30s using 20 workers.
- Single poll parse < 300ms p95.
- Graph query (< 10k edges) < 1s.

## 12. Scaling Considerations

- Horizontal workers consuming a queue (future).
- Shard by service id hash if >5k services.
- Cache graph (ETag) invalidate on change.

## 13. Security

- Enforce HTTPS-only endpoints.
- Timeout + size limit (e.g. 2s, 256KB) on dependency endpoint fetch.
- Sanitize stored metadata (no secrets).
- Input validation & rate limiting on mutating APIs.

## 14. Error Handling

- Distinguish transient network vs schema error vs HTTP error.
- After max consecutive failures mark service overallStatus=ERROR with reason=UNREACHABLE.

## 15. Observability

- Metrics: poll_duration_ms, poll_errors_total, status_transitions_total, graph_build_ms.
- Structured logs with pollRunId correlation.
- Health endpoint /health (liveness/readiness).

## 16. Tech Stack

- Backend: Node.js (Express/Fastify) or NestJS.
- DB: PostgreSQL.
- Queue (future): Redis or SQS.
- UI: React + TypeScript + Vite.
- Containerized (Docker).

## 17. Open Questions

- Need multi-environment isolation boundaries? (Prod vs Staging segmentation)
- Should external (unregistered) dependencies be auto-stubbed as nodes?
- WebSocket vs SSE for live updates?
- Multi-tenant support requirement?

## 18. Risks

- Inconsistent naming causing missed linkage (mitigate with alias mapping).
- Large dense graphs causing UI performance issues (mitigate progressive loading).
- Endpoint variability in proactive-deps schema (need version negotiation).

## 19. MVP Scope

IN: Register service, poll, store dependencies, derive graph, UI list + detail + basic graph, history for last 24h, basic auth.
OUT: Webhooks, advanced RBAC, diff optimization, cycle visualization, multi-tenant.

## 20. Acceptance Criteria (Samples)

- Given a registered service, when its endpoint returns 3 dependencies, they appear in UI within 60s.
- When a dependency status changes from OK to ERROR, service overall status updates accordingly.
- Reverse dependency query returns all services that depend on a given internal service.
- Graph export includes all nodes & edges with statuses.

## 21. Example proactive-deps Payload (Assumed)

{
"service": "payments-api",
"version": "1.2.3",
"dependencies": [
{ "name": "orders-api", "type": "internal", "status": "ok" },
{ "name": "redis-cache", "type": "cache", "status": "warn", "meta": { "latencyMs": 120 } },
{ "name": "stripe", "type": "external", "status": "ok" }
]
}

## 22. Normalized Internal Representation (Example)

Service: payments-api
Dependencies (flattened):

- orders-api (mapped to internal service id if exists) status=OK
- redis-cache (external) status=WARN
- stripe (external) status=OK
  Overall Status = WARN
