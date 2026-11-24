# IPM — Test traceability audit

Audit date 2026-11-24, done with the `user-story-testing` / `testing-strategy` / `api-endpoint-testing` skills.
Sources: SRS IPM-SRS-001 v1.1 (`docs/SRS.extracted.txt`: 112 FR items in 11 areas, 22 acceptance tests AT-01…AT-22),
backend specs `ipm-backend/docs/modules/*.md` (§ "سيناريوهات القبول"), backend tests `ipm-backend/tests` (53 classes,
353 tests), front-end specs `ipm-web/src/**/*.spec.ts` (31 files, 129 tests, all passing on 2026-11-24).

Status: ✅ covered by a named test · ⚠️ partly covered / needs a check · ❌ no test.
Not re-run here: `dotnet test` (needs Docker). The matching is by test name and class summary, so ✅ means "a test
claims this scenario", not "every clause is asserted".

## 1. Summary

| Layer | State |
|---|---|
| Backend domain + architecture | Good: one test file per entity, layer and folder rules enforced |
| Backend API integration | **Strong**: 158 of 174 spec scenarios have a named test. Of the 16 without one, 11 are delivery checklists (`dotnet test` green, `/docs`, `.http`) or the architecture-test scenario (00 #10, which `ArchitectureTests` do cover), and 5 are real gaps (section 2) |
| SRS acceptance tests (AT) | 16 ✅ · 5 ⚠️ (AT-03, 14, 15, 17, 21) · 1 ❌ (AT-08: attachments do not exist in the backend yet) |
| Front-end ↔ API contract | **Weak**: 12 contract tests for 56 custom API methods + 17 CRUD resources |
| Front-end components/screens | **Weak**: 2 component tests (`DataTable`, `OfflineBanner`); no page has a test for loading, empty, error or permission states |
| E2E (user journeys) | **None**: no Playwright, so no SRS AT case is proven through the real UI |
| CI | **None** in either repo |

## 2. Backend spec scenarios → tests

| Part | Scenarios | Covered | Not covered by a named test |
|---|---|---|---|
| 00 foundation | 10 | 8 | #9 delivery checklist; #10 is enforced by `ArchitectureTests` (not named by scenario) |
| 01 identity | 15 | 14 | #15 delivery checklist |
| 02 work-item types | 12 | 11 | #12 delivery checklist |
| 03 workflows | 12 | 11 | #12 delivery checklist |
| 04 projects | 17 | 16 | #17 delivery checklist |
| 05 work items | 18 | 17 | #18 delivery checklist + "every change in `audit_log` with `user_id`" |
| 05b relations & comments | 16 | 15 | #16 delivery checklist + audit |
| 06 approvals | 15 | 14 | #15 delivery checklist + audit |
| 06b sensitive changes | 14 | 13 | #14 delivery checklist. #7, #11 and #13 were gaps and are now covered by `ApprovalGapTests` (2026-11-24) |
| 07 Git integration | 15 | 14 | #15 delivery checklist |
| 08 activity/audit/notifications | 15 | 14 | **#15 compatibility**: migration on a database that has part-07 data, then `verify` ⚠️ |
| 09 dashboard/search/settings | 15 | 14 | **#15 compatibility**: migration on a database with data plus the settings seed ⚠️ |

Backend gaps. Items 1–3 were closed on 2026-11-24 by `ipm-backend/tests/Ipm.IntegrationTests/Approvals/ApprovalGapTests.cs`; items 4–5 are still open:
1. ✅ **06b #7, drift (R6-b)**: `Scenario_7_R6b_a_protected_field_changed_before_the_last_stage_supersedes_the_request` and `…_a_protected_value_changed_behind_the_back_makes_the_last_approval_409_and_applies_nothing` (the second changes the title by raw SQL, since no command can change a watched field without superseding).
2. ✅ **06b #11, override (R9)**: `Scenario_11_R9_creating_and_deleting_a_link_is_allowed_but_supersedes_…` and `…_replacing_the_members_is_allowed_but_supersedes_…` (the admin's direct edit was already in `SensitiveChangeTests`).
3. ✅ **06b #13, reading (R11)**: `Scenario_13_R11_the_request_reads_back_the_proposed_values_…` (read as requester and as admin, before and after a middle-stage approval).
4. **"Every change is audited with `user_id`"** (05, 05b, 06, 06b) ⚠️. Audit is proven generically (`AuditLogTests` on the probe), not per module write. Add one audit assertion per write endpoint (matrix row E13).
5. **Migration with existing data** (08 #15, 09 #15) ⚠️. `MigrationTests` runs only against an empty database.

## 3. SRS acceptance tests (AT) → tests

| AT | Case (short) | Backend test | E2E | Status |
|---|---|---|---|---|
| AT-01 | No `projects.view`, direct link → 403/404, no leak | `ProjectVisibilityTests.Scenario_1_a_viewer_sees_only_his_project_and_a_hidden_one_answers_404` | ❌ | ✅ API |
| AT-02 | Create project, edit description and status, old and new values recorded | `ProjectLifecycleTests.*`, `AuditLogTests.Insert_update_and_delete_are_each_recorded_with_before_and_after` | ❌ | ✅ API |
| AT-03 | New status linked to a transition, shows in filter and board | `StatusesTests.Scenario_2_*`, `WorkflowsTests.Scenario_7_R6_R7_R12_*` | ❌ | ⚠️ the "shows in filter and board" part is front end, not tested |
| AT-04 | Status change by an unauthorised user is refused by the API | `WorkItemWorkflowTests.Scenario_9_R7_an_extra_permission_of_the_transition_*`, `WorkItemLifecycleTests` (403) | — | ✅ |
| AT-05 | Three-stage approval, executes only after all three in order | `ApprovalRequestTests.Scenario_5_R6_each_stage_is_decided_by_its_approver_*`, `ApprovalGateTests.Scenario_9_R9_*` | ❌ | ✅ API |
| AT-06 | Rejected at stage 2, sequence stops, reason/time/decider kept | `ApprovalRequestTests.Scenario_6_R7_a_rejection_ends_it_*` | — | ✅ |
| AT-07 | Protected field changed during approval invalidates the old version | `ApprovalGateTests.Scenario_10_R10_*`, `Scenario_10_R11_*`, `SensitiveChangeTests.Scenario_12_R7_*` | — | ✅ |
| AT-08 | File on a task, non-member download refused and logged | — (no attachments in the backend, ROADMAP "files part" last) | ❌ | ❌ **feature not built** (FR-COL-03…06) |
| AT-09 | Duplicate webhook once, unsigned refused | `GitWebhookTests.Scenario_2_R5_a_bad_or_missing_signature_*`, `Scenario_7_R7_*every_commit_is_stored_once` | — | ✅ |
| AT-10 | Commit with a valid task ref shows on the task with a link | `GitSyncAndIndicatorTests.Scenario_10_R10_*`, `GitWebhookTests.Scenario_7_R7_*` | ❌ | ✅ API |
| AT-11 | Permission change in one project applies there only, and is logged | `ApprovalGapTests.AT_11_changing_a_members_role_in_one_project_does_not_touch_the_same_person_in_another_project` (403 in project A, 200 in project B, members change in A's audit trail), plus `AccessTests.Scenario_4_*` | — | ✅ |
| AT-12 | Audit after a status rename stays understandable (stable ids) | `ApprovalGapTests.AT_12_renaming_a_status_keeps_old_transitions_readable_through_its_stable_id` (item and `statusId` filter keep the id, old `workItem.transition` entry remains, status history shows both names) | — | ✅ |
| AT-13 | Dashboard filters for a period match the source data | `DashboardTests.Scenario_9_R10_*`, `Scenario_10_R9_*` | ❌ | ✅ API |
| AT-14 | Archive a project with files and tasks, nothing disappears, edits blocked | `ProjectLifecycleTests.Scenario_11_R6_an_archived_project_is_read_only_until_it_is_restored` | — | ⚠️ files part blocked by AT-08 |
| AT-15 | Create a Feature type with fields and statuses in admin, then an item, no code deploy | `WorkItemTypesTests.*`, `WorkItemLifecycleTests.*` | ❌ | ⚠️ this is a UI + API journey, so it needs E2E |
| AT-16 | Rename Feature with history, link by stable key | `WorkItemTypesTests.Scenario_4_R1_*never_changes`, `Scenario_11_*history` | — | ✅ |
| AT-17 | Feature → Task/Bug children, cycle refused atomically, security log | `ApprovalGapTests.AT_17_a_parent_cycle_is_refused_atomically_and_the_tree_is_unchanged` (422, tree and audit unchanged), `WorkItemLifecycleTests.Scenario_7_R6_*`, `RelationTests.Scenario_3_and_4_*` | — | ⚠️ the **security-log entry is not implemented**: `SecurityEventType` has only login/lockout/permission-denied/password/session events, so a refused cycle is not logged. Decide in the spec: add an event type, or drop "security log" from AT-17 |
| AT-18 | A blocks B, B blocks C, then C blocks A is refused, inverses shown | `RelationTests.Scenario_3_and_4_R4_R5_duplicates_and_cycles_are_refused` | — | ✅ |
| AT-19 | Edit right without `workitem.relations.create` → refused, no leak | `RelationTests.Scenario_1_*` (`abdullah` 403, `noura` 404) | — | ✅ |
| AT-20 | Parent change during a pending approval, old version not approvable | `ApprovalGapTests.AT_20_changing_the_parent_of_an_item_with_a_pending_approval_supersedes_it_and_the_old_revision_cannot_be_approved` (uses `PUT /work-items/{id}/parent`), plus `ApprovalGateTests.Scenario_10_R11_*` | — | ✅ |
| AT-21 | Bug → Feature with missing required fields, UI shows reasons, server refuses, no data loss | `WorkItemWorkflowTests…Scenario_12_R10_a_type_change_lists_every_conflict_and_changes_nothing_*` | ❌ | ⚠️ the UI part is untested |
| AT-22 | Feature progress with done Task and open Bug, leaves counted once | `…Scenario_15_R13_progress_counts_the_done_leaves_*` | — | ✅ |

## 4. Front end

| Area | Tests today | Gap |
|---|---|---|
| `domain/*.api.ts` (10 services, 56 custom methods + 17 resources) | 12 cases in `domain/api-contract.spec.ts` | One contract test per endpoint the UI calls (route, verb, query names, body, `If-Match`). Priority: approvals (`decide`, `resubmit`, `bulkDecide`, `remind`), work-item `transition`/`changeType`, project members, delegations, git, settings. These files have uncommitted changes right now |
| Pages (`features/**`) | Logic files are well tested (22 specs) | No page test. Priority: approvals inbox/detail, work-item detail (transition, 409 reload), project form, admin access/roles (`features/admin/access`: 0 of 8 files tested) |
| `shared/ui` | `DataTable`, dialog service | `paginator`, `tabs`, `error-state` (retry), `toast-host` timing, `dynamic-field` (validation per field type) |
| `core/api` `BaseApiService`, `core/auth` guards and `*appCan` | `auth.service.spec.ts` | Guard redirects (`/forbidden`), `*appCan` per project, the interceptor mapping a 412 to message + reload |
| Test names | No ids | New specs should carry the rule or AT id: `it('R7: …')`, `it('AT-21: …')` |

## 5. Follow-up work, by priority

1. **CI in both repos** (`testing-strategy/references/ci-github-actions.md`). Nothing stops a red build today.
2. ~~Backend gaps from §2~~ **Done for 06b #7/#11/#13** (2026-11-24, `ApprovalGapTests`). Still open: per-module audit assertions and the migration-with-data test.
3. ~~AT ⚠️ rows (AT-11, AT-12, AT-17, AT-20)~~ **Done** (same file). Left from the ⚠️ list: AT-03, 14, 15, 21 (need the UI or the files part) and the AT-17 security-log decision.
4. **Front-end contract tests** for every API method, then page tests for approvals and work items.
5. **Playwright E2E** (`testing-strategy/references/e2e-playwright.md`): AT-01, 03, 05, 10, 13, 15 and 21 as journeys with `admin`, `reem` and `khaled`.
6. **AT-08 / AT-14 files part**: blocked until the attachments part exists in the backend. Write its spec with these ATs as scenarios.

## 6. Refresh this file

```powershell
git -C ..\ipm-backend grep -ohE "(Scenario_[0-9]+|R[0-9]+)_[A-Za-z0-9_]+" -- "tests/*.cs" | Sort-Object
```
```powershell
git grep -ohE "(it|test)\('(S|R|AT-|US-)[0-9A-Z-]+[^']*" -- "*.spec.ts"
```
