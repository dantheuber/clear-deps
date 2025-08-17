## clear-deps

Proactive Dependency Topology & Monitoring Service.

### Stack (MVP)
- Backend: Fastify + TypeScript + Prisma (PostgreSQL)
- Frontend: React + Vite + TypeScript
- Container: Docker / docker-compose

### High-Level Components
1. Service Registry & CRUD
2. Polling Engine (scheduled + on-demand refresh)
3. Dependency Ingestion & Normalization
4. Graph Construction (service -> dependency edges)
5. Status Derivation (worst-of direct deps)
6. History Storage (last 24h MVP)
7. REST API (see `PRD.md`)
8. Basic UI (dashboard, services list, service detail, simple graph)

### Quick Start (Dev)
Prereqs: Node 20+, Docker, npm.

```bash
docker compose up -d postgres

cd backend
npm install
npx prisma migrate dev --name init
npm run dev

# In new shell
cd ../frontend
npm install
npm run dev
```

Backend runs on :4000, Frontend on :5173 (default Vite) proxying API to backend (`/api`).

### Environment Variables (`backend/.env`)
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/cleardeps"
API_KEY="change-me-dev"
DEFAULT_POLL_INTERVAL_SEC=60
MAX_PARALLEL_POLLS=10
POLL_TIMEOUT_MS=2000
POLL_MAX_SIZE_BYTES=262144
```

### Roadmap (Short-Term)
- [ ] Complete remaining API endpoints (history filters, reverse-dependents)
- [ ] Implement cycle detection
- [ ] Add graph caching & ETag
- [ ] Basic auth hardening (key rotation)
- [ ] UI graph visualization

See `PRD.md` for full specification.
