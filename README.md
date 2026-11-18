# نظام إدارة المشاريع الداخلي — IPM Web

Angular 22 front end for the Internal Project Management system (SRS IPM-SRS-001 v1.1).
Arabic RTL UI in the internal ERP identity (emerald sidebar, ivory background, gold accents).

```bash
npm install
npm start        # http://localhost:4200 — pick a demo role on the login screen
npm test         # unit + SRS acceptance-rule tests (Vitest)
npm run build
```

The app ships with an in-app mock backend (`src/app/mock`) that enforces the SRS rules
(default-deny permissions, workflow transitions, no hierarchy/blocking cycles, sequential approvals,
self-approval ban, protected-field supersede, optimistic concurrency). Set `useMockBackend: false`
in `src/environments/environment.ts` to call the real ASP.NET Core API at `apiBaseUrl`.

See [ARCHITECTURE.md](ARCHITECTURE.md) for structure, the generic building blocks and conventions.
