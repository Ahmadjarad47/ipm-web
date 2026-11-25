# IPM Web — نظام إدارة المشاريع الداخلي

Arabic-first, RTL web client for the **Internal Project Management (IPM)** system, built against SRS `IPM-SRS-001 v1.1`.
It covers projects, work items, configurable workflows, sequential approvals, Git integration, audit, reports and real-time notifications.

> Backend: [`ipm-backend`](https://github.com/Ahmadjarad47/ipm-backend) (.NET 10, Clean Architecture, CQRS). This repo is the front end only.

## Highlights

- **Projects & work items** — hierarchy, relations (cycle-safe), comments, bulk edit, board and list views, project progress.
- **Configurable workflows** — statuses, transitions and types are read from the server, never hard-coded.
- **Approvals engine** — templates and rules, sequential stages, self-approval ban, delegation, admin override, gating of status transitions.
- **Real-time notifications** — SignalR push, mark-as-read when seen in view, notification sound.
- **Audit & activity** — readable change feeds (ids resolved to names, structured values summarised), filtering and export.
- **Reports** — work report with Excel export.
- **Admin** — roles and permissions (default-deny, system and per-project scope), types, workflows, approval templates, project templates, settings.
- **Accessibility & RTL** — logical CSS properties, keyboard support, contrast checked (see [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md)).

## Tech stack

| Area | Choice |
|---|---|
| Framework | Angular 22 — standalone components, signals, zoneless, `OnPush` everywhere |
| Language | TypeScript 6 (strict) |
| Real time | `@microsoft/signalr` |
| Tests | Vitest + jsdom via `ng test` |
| Build / serve | `@angular/build` (esbuild), nginx in production |

## Getting started

Prerequisites: Node 22+, npm 11, and the backend running on `http://localhost:8080` (see the backend README: `docker compose up -d --build`).

```bash
npm install
npm start          # http://localhost:4200, proxies /api (and WebSocket) to :8080
npm test           # unit tests + SRS acceptance-rule tests
npm run build      # production bundle -> dist/ipm-web/browser
```

Development accounts are seeded by the backend (see its README). The dev proxy is configured in [`proxy.conf.json`](proxy.conf.json); the API base URL lives in `src/environments/`.

## Project structure

```
src/app/
  core/       singletons: generic REST client, list/lookup stores, auth + permissions, interceptors, shell
  domain/     models + typed API per aggregate (no UI)
  shared/     reusable, feature-agnostic UI (table, dialogs, tabs, badges, pipes, formatters)
  features/   lazy-loaded screens: dashboard, projects, work-items, approvals, audit,
              notifications, reports, admin, auth, profile, errors
```

Dependency rule: `features → shared → domain → core`, never the other way, and features never import each other.
Full conventions, generic building blocks and the UX foundation are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Engineering principles

- **Permissions** — `auth.can(key, projectId)` / `*appCan`. Hiding is UX only; the API re-checks every call.
- **Server-driven configuration** — statuses, types, fields and transitions come from lookups; domain verbs (transition, change type, decide approval) use dedicated API actions, never a field PATCH.
- **Optimistic concurrency** — every update sends `version`/ETag; a 409 shows the server message and reloads.
- **Errors** — mapped to a single `ApiError` (Arabic `message` + per-field `details`) and rendered inline or as toasts.
- **Fresh caches** — a successful write reloads the lookups it affects, and a tab returning from the background refreshes.
- **RTL** — logical CSS only (`inset-inline-start`, `margin-inline`).

## Quality

- Unit and acceptance-rule tests run with `npm test`; the API contract is guarded by `src/app/domain/api-contract.spec.ts`.
- Requirements-to-tests traceability: [docs/TEST-TRACEABILITY.md](docs/TEST-TRACEABILITY.md).
- Accessibility notes and the contrast checker: [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md).

## Deployment

The app is a static bundle served by nginx (see [`Dockerfile`](Dockerfile) and [`nginx.conf`](nginx.conf)) behind HTTPS, talking to the API under `/api/v1` on the same origin. TLS, proxying (including the SignalR WebSocket) and the release checklist are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Documentation

| Doc | Purpose |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | structure, generics, SRS-driven UI rules |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | environments, nginx, release checklist |
| [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md) | accessibility and contrast |
| [docs/TEST-TRACEABILITY.md](docs/TEST-TRACEABILITY.md) | SRS requirement → test mapping |
