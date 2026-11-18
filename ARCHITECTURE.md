# IPM Web — Architecture

Angular 22 front end for the Internal Project Management system (SRS IPM-SRS-001 v1.1).
Arabic, RTL, standalone components, signals, zoneless, OnPush everywhere.

```
src/app/
  core/        app-wide singletons, no UI of features
    api/         BaseApiService<T,TCreate,TUpdate>  (generic REST client) + query serialisation
    state/       EntityListStore<T> (generic paged list state) · LookupStore<T> (cached id→entity)
    auth/        AuthService (session + can()), guards, *appCan directive, permission keys
    http/        interceptors: correlation id, bearer token, ApiError mapping
    layout/      Shell (sidebar + topbar + notifications), NAVIGATION
    notifications/ ToastService, NotificationStore
    models/      Entity, ListQuery<T>, PagedResult<T>, CreateDto<T>, UpdateDto<T>, ApiError
  domain/      models + typed API per aggregate (no UI)
    projects/ work-items/ workflow/ approvals/ users/ activity/
  shared/      reusable, feature-agnostic UI
    ui/          DataTable<T>, Paginator, Tabs<K>, DialogService + DialogShell + ConfirmService,
                 Badge, Avatar(Stack), KpiCard, PageHeader, EmptyState, Icon, DynamicFields, ToastHost
    domain-ui/   StatusBadge, TypeChip, PriorityBadge, ApprovalStatusBadge
    pipes/       appDate, relativeTime, userName, userNames
  features/    lazy-loaded screens; each folder owns its routes, pages, components, stores
  mock/        in-app backend (interceptor) enforcing the SRS rules — delete to use the real API
```

## Dependency rule

`features → shared → domain → core`. Never the other way. Features never import each other.
`mock/` is only referenced from `app.config.ts`.

## Generics

| Building block | How a feature uses it |
|---|---|
| `BaseApiService<T, TCreate, TUpdate>` | `class ProjectsApi extends BaseApiService<ProjectSummary, ProjectCreate, UpdateDto<Project>> { resource = 'projects' }` — gets `list/all/getById/create/update/remove`, adds `action()` calls for domain verbs. |
| `EntityListStore<T>` | `@Injectable() class ProjectListStore extends EntityListStore<ProjectSummary> { api = inject(ProjectsApi) }`, provided in the page's `providers`. Exposes `items/total/loading/error/query` signals and `setPage/setSort/setSearch/setFilter/reload`. |
| `LookupStore<T>` | Root singletons (`StatusLookup`, `UserLookup`, `WorkItemTypeLookup`…) with `items()`, `byId()`, `get(id)`. |
| `DataTable<T>` + `ColumnDef<T>` | Column keys are checked against `T`; custom cells via `ng-template` with `CellContext<T>`. |
| `DialogService.open<C, D, R>()` | Returns `DialogRef<R>`; component reads `inject(DIALOG_DATA)` and closes with `inject(DialogRef).close(result)`. |
| `Tabs<K>` | `[(active)]` typed by the key union. |

## Rules the UI follows (from the SRS)

- Permissions: `auth.can(key, projectId)` / `*appCan="'tasks.edit'; project: p.id"`. Hiding is UX only — the API re-checks (FR-AUTH-03).
- Never hard-code statuses, types, fields or colours: read them from lookups (FR-TYP-11, FR-WF-02).
- Status transitions, type changes, parent changes and approval decisions go through their dedicated API action, never a PATCH of the field.
- Every update sends `version` (optimistic concurrency). On 409 show the message and reload.
- Errors arrive as `ApiError` (`message`, `details` per field). The interceptor already toasts them; render `details` inline in forms.
- Dates are ISO in UTC; display with `appDate` (org time zone).
- RTL: use logical CSS (`inset-inline-start`, `margin-inline`, `text-align: start`). "Next" arrows point left.

## UX foundation (shared building blocks)

| Piece | Usage / contract |
|---|---|
| `ToastService` + `ToastHost` | `toast.success/info/error(msg, { action?: { label, run }, ttl? })`. Default ttl 3.5 s (6 s with an action or error); timer pauses on hover/focus; max 4 on screen; errors use `role="alert"`. `toast.undoable('تم الحذف', () => undo())` shows a «تراجع» action. |
| `<app-skeleton variant="card\|detail\|chart\|table\|lines" [count]>` | Loading placeholder (`role="status"`, shimmer disabled under reduced motion). Use instead of bare spinners. |
| `<app-error-state title text [correlationId] (retry)>` | Inline failure panel with a retry button. Pair with `store.error()`. |
| `<app-empty-state title text actionLabel (action)>` | Optional convenience CTA; richer actions can still be projected. |
| `<app-data-table tableId="work-items" ...>` | `tableId` turns on persisted prefs (`localStorage ipm.table.<id>`): column chooser («الأعمدة»), density, page size (`(pageSizeChange)`; read the saved size with `loadTablePrefs(id).pageSize`). `ColumnDef`: `hidden`, `required`, `srHeader` (sr-only header for checkbox/action columns), `mobileLabel`, `hideOnMobile`. Below 640px rows become labelled cards. Extra toolbar controls: `<button toolbar>`. Default density comes from `PreferencesStore`. |
| `<app-help-tip [text]="HELP.progressRule">` | Focusable «?» popover; strings in `shared/help/help-texts.ts` (`HELP`). |
| `RouteCrumbs` | Breadcrumb contract: a route declares `data: { crumbs: [{ label, link? }, ...] }` (the FULL trail; deepest route wins). The shell renders it under the topbar unless the page's `<app-page-header [crumbs]>` shows its own. Dynamic names: `inject(RouteCrumbs).set([...])`. |
| `RecentItems` | Detail pages call `recent.add({ kind, id, title, code?, link, typeId? })` after loading; the command palette lists the last 5 under «الأخيرة». |
| `Shortcuts` | `?` cheat sheet, `g` then `d/p/w/a`, `c` new work item; ignored in inputs, contenteditable and open dialogs. Palette: Ctrl/⌘+K or `/`. |
| `PreferencesStore` / `ThemeService` | Client-side per-user prefs (`ipm.prefs.<userId>`): landing page, density, date format, notification toggles (UI only), theme. `data-theme` on `<html>`; dark tokens in `styles/_tokens.scss` (check with `node docs/contrast-check.mjs`). Use `--c-primary` / `--c-danger-solid` / `--c-on-gold` / `--c-ink-*` for solid fills that carry fixed-colour text, never `--c-emerald-700` (it is light in dark mode). |
| `OfflineBanner`, `AppErrorHandler`, error pages | Offline strip in the shell; uncaught errors show a generic toast with a copyable incident id (no stack/server details); router failures redirect to `/error` or `/offline`; `/forbidden`, 404 pages. |
| Deep-link contracts | `/work-items?create=true`, `/projects?create=true` (opens the create dialog), `/profile#preferences`, `/notifications` (placeholder page). |

Deployment, backup/restore, CSP and browser support: `docs/DEPLOYMENT.md`. Accessibility checklist and axe procedure: `docs/ACCESSIBILITY.md`.

## Running

```bash
npm start          # http://localhost:4200 — demo accounts on the login screen
npm run build
```

Set `useMockBackend: false` in `src/environments/environment.ts` and point `apiBaseUrl` at the ASP.NET Core API to run against the real server.

## Git integration (SRS §3.6, §7.2)

| Piece | Where |
|---|---|
| Webhook endpoint `POST /api/v1/webhooks/{provider}/{repoId}` — public, authenticated by signature | `mock/server/handlers/git.handlers.ts` |
| Signature: Gitea `X-Gitea-Signature` / GitHub `X-Hub-Signature-256` = HMAC-SHA256 of the raw body, constant-time compare; GitLab `X-Gitlab-Token` | `verify()` |
| Idempotency: a delivery id is processed once; repeats are logged as `duplicate` (FR-GIT-05, AT-09) | `receive()` |
| Auto-linking: `<PROJECT>-<n>` in commit message, branch name or PR title, only refs of the repository's project, any work item type (FR-GIT-03/11, AT-10) | `detectRefs()` |
| Manual link / unlink a commit or PR to a work item (audited) | `git-events/:id/link|unlink` |
| Delivery log + redelivery of failed payloads (FR-GIT-05/06) | `git/deliveries` |
| Merging a PR never completes or approves a work item (FR-GIT-08) | `processPayload()` |
| Demo simulator: signs a payload with the repo secret and posts it through the real path | `git/simulate` (mock only) |

Secrets (access token, webhook secret) are write-only: accepted on connect, kept server-side, never returned or logged (NFR-04).
Suggested branch per work item: `feature/ERP-104`, `bugfix/ERP-105` (`domain/git/git.models.ts`).

Provider differences live in `domain/git/git-connector.ts` (one `GitConnector` per provider + registry); the per-project ref regex is validated by `domain/git/ref-pattern.ts` (one capture group, no catastrophic patterns, must recognise the project's own refs).
Manual sync (`projects/:id/git-sync`) ingests commits missed by webhooks through the same `processPayload` path and always audits `git.synced`; `rotate-secret` returns the new secret once; deliveries with `X-Delivery-Timestamp` older than 5 minutes are rejected (replay protection).

## Approvals engine (mock: `mock/server/approvals/engine.ts`)

Templates carry a `rule` (types, projects, priorities, actions, conditions, priority); `matchTemplate()` picks the governing template, `requireApproval()` gates protected transitions (single use, protected-field snapshot must still match), and `sensitive.change` requests apply their `proposedChanges` atomically on the final approval. Stage approvers can be a user, a role or a position (`project_owner`, `direct_manager`, `project_manager`) and include active delegates (`delegations`).
