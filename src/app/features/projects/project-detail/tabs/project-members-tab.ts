import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { ConfirmService } from '@shared/ui/dialog/confirm-dialog';
import { DialogService } from '@shared/ui/dialog/dialog.service';
import { AuthService } from '@core/auth/auth.service';
import { isApiError } from '@core/models/api-error.model';
import { ToastService } from '@core/notifications/toast.service';
import { ProjectsApi } from '@domain/projects/project.api';
import { ProjectMember, ProjectMembersResult, ProjectSummary } from '@domain/projects/project.models';
import { RoleLookup, UserLookup } from '@domain/users/user.api';
import { Avatar } from '@shared/ui/avatar/avatar';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { Icon } from '@shared/ui/icon/icon';
import { MemberWarningsData, MemberWarningsDialog } from '../member-warnings-dialog';

/** Inline error: `userId` ties it to a row; `null` means the add form / whole list. */
interface MemberError {
  readonly userId: string | null;
  readonly message: string;
}

let nextId = 0;

@Component({
  selector: 'app-project-members-tab',
  imports: [Avatar, Icon, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (project().members.length) {
      <ul class="members">
        @for (m of project().members; track m.userId) {
          <li>
            <app-avatar [name]="nameOf(m.userId)" [size]="36" />
            <div class="who">
              <strong>{{ nameOf(m.userId) }}</strong>
              <span class="muted">{{ titleOf(m.userId) }}</span>
            </div>
            <span class="spacer"></span>
            @if (canManage()) {
              <select class="select role" [value]="m.roleId" [attr.aria-label]="'دور ' + nameOf(m.userId)" [disabled]="saving()" (change)="changeRole(m, $event)">
                @for (r of projectRoles(); track r.id) {
                  <option [value]="r.id" [selected]="r.id === m.roleId">{{ r.name }}</option>
                }
              </select>
              @if (m.userId !== project().ownerId) {
                <button type="button" class="btn btn--ghost btn--icon" [disabled]="saving()" [attr.aria-label]="'إزالة ' + nameOf(m.userId)" (click)="remove(m)">
                  <app-icon name="trash" [size]="16" />
                </button>
              } @else {
                <span class="owner-lock" title="لا يمكن إزالة مالك المشروع. غيّر المالك من «تعديل المشروع» أولًا.">
                  <button type="button" class="btn btn--ghost btn--icon" disabled [attr.aria-label]="'لا يمكن إزالة ' + nameOf(m.userId) + ' لأنه مالك المشروع'">
                    <app-icon name="lock" [size]="16" />
                  </button>
                  <span class="muted owner">المالك</span>
                </span>
              }
            } @else {
              <span class="role-name">{{ roleName(m.roleId) }}</span>
            }
            @if (rowError(m.userId); as msg) {
              <p class="error row-error" role="alert">{{ msg }}</p>
            }
          </li>
        }
      </ul>
    } @else {
      <app-empty-state icon="users" title="لا يوجد أعضاء" text="أضف أعضاء ليتمكنوا من الوصول إلى المشروع." />
    }

    @if (canManage()) {
      <div class="add card-body">
        <div class="field">
          <label [attr.for]="uid + '-user'">إضافة عضو</label>
          <select [id]="uid + '-user'" class="select" [value]="newUser()" (change)="newUser.set(val($event))">
            <option value="">اختر مستخدمًا</option>
            @for (u of candidates(); track u.id) {
              <option [value]="u.id">{{ u.name }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label [attr.for]="uid + '-role'">الدور (أدوار المشروع فقط)</label>
          <select [id]="uid + '-role'" class="select" [value]="newRole()" (change)="newRole.set(val($event))">
            <option value="">اختر دورًا</option>
            @for (r of projectRoles(); track r.id) {
              <option [value]="r.id">{{ r.name }}</option>
            }
          </select>
        </div>
        <button type="button" class="btn btn--primary" [disabled]="!newUser() || !newRole() || saving()" (click)="add()">
          <app-icon name="plus" [size]="16" /> إضافة
        </button>
        @if (rowError(null); as msg) {
          <p class="error add-error" role="alert">{{ msg }}</p>
        }
      </div>
    }
  `,
  styles: `
    .members { list-style: none; margin: 0; padding: 0; }
    .members li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3); padding: var(--s-3) 0; border-bottom: 1px solid var(--c-border); }
    .who { display: flex; flex-direction: column; }
    .who .muted { font-size: var(--fs-sm); }
    .role { width: auto; min-width: min(100%, 160px); }
    .role-name { font-weight: 600; color: var(--c-emerald-700); }
    .owner-lock { display: inline-flex; align-items: center; gap: var(--s-1); }
    .owner { min-width: 38px; text-align: center; font-size: var(--fs-sm); }
    .row-error { flex-basis: 100%; margin: 0; }
    .add-error { flex-basis: 100%; margin: 0; }
    .error { color: var(--c-danger); font-size: var(--fs-sm); }
    .add { display: flex; align-items: flex-end; gap: var(--s-3); flex-wrap: wrap; margin-top: var(--s-4); padding: var(--s-4); background: var(--c-surface-2); border-radius: var(--r-md); }
    .add .field { min-width: min(100%, 200px); }
    .who { min-inline-size: 0; overflow-wrap: anywhere; }
    @media (max-width: 768px) {
      .role { flex: 1 1 100%; }
      .add .field, .add .btn { flex: 1 1 100%; }
    }
    @media (pointer: coarse), (max-width: 768px) {
      .role, .add .select { min-block-size: 44px; }
    }
  `,
})
export class ProjectMembersTab {
  readonly project = input.required<ProjectSummary>();
  /** Emitted after a successful save so the page reloads the project (new version). */
  readonly changed = output<void>();

  private readonly api = inject(ProjectsApi);
  private readonly users = inject(UserLookup);
  private readonly roles = inject(RoleLookup);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly confirm = inject(ConfirmService);
  private readonly dialog = inject(DialogService);

  protected readonly uid = `pm${++nextId}`;
  protected readonly saving = signal(false);
  protected readonly newUser = signal('');
  protected readonly newRole = signal('');
  private readonly errors = signal<readonly MemberError[]>([]);

  protected readonly canManage = computed(() => !this.project().archived && this.auth.can('projects.members.manage', this.project().id));
  /** Only project-scope roles may be granted here (FR-PRJ-05); system roles never apply to a project member. */
  protected readonly projectRoles = computed(() => this.roles.items().filter((r) => r.scope === 'project'));
  protected readonly candidates = computed(() => {
    const taken = new Set(this.project().members.map((m) => m.userId));
    return this.users.items().filter((u) => u.active && !taken.has(u.id));
  });

  protected rowError(userId: string | null): string | null {
    return this.errors().find((e) => e.userId === userId)?.message ?? null;
  }

  protected nameOf(id: string): string {
    return this.users.nameOf(id);
  }

  protected titleOf(id: string): string {
    return this.users.get(id)?.title ?? '';
  }

  protected roleName(id: string): string {
    return this.roles.get(id)?.name ?? '—';
  }

  protected val(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  protected changeRole(member: ProjectMember, event: Event): void {
    const select = event.target as HTMLSelectElement;
    const roleId = select.value;
    this.save(
      this.project().members.map((m) => (m.userId === member.userId ? { ...m, roleId } : m)),
      'تم تحديث دور العضو',
      member.userId,
      undefined,
      () => {
        select.value = member.roleId;
      },
    );
  }

  protected remove(member: ProjectMember): void {
    const before = this.project().members;
    this.confirm
      .confirm({
        title: 'إزالة عضو',
        message: `سيفقد «${this.nameOf(member.userId)}» وصوله إلى هذا المشروع. هل تريد المتابعة؟`,
        confirmText: 'إزالة',
        danger: true,
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.save(before.filter((m) => m.userId !== member.userId), null, member.userId, undefined, undefined, (result) => {
          this.toast.undoable(`تمت إزالة «${this.nameOf(member.userId)}»`, () => this.undoRemoval(result, before));
        });
      });
  }

  /** Re-adds the removed member by restoring the previous list (uses the version returned by the removal). */
  private undoRemoval(removed: ProjectMembersResult, before: readonly ProjectMember[]): void {
    this.saving.set(true);
    this.api.setMembers(removed.id, before, removed.version).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success('تم التراجع وإعادة العضو');
        this.auth.refreshSession().subscribe();
        this.changed.emit();
      },
      error: () => {
        this.saving.set(false);
        this.changed.emit();
      },
    });
  }

  protected add(): void {
    const userId = this.newUser();
    this.save([...this.project().members, { userId, roleId: this.newRole() }], 'تمت إضافة العضو', null, () => {
      this.newUser.set('');
      this.newRole.set('');
    });
  }

  private save(
    members: readonly ProjectMember[],
    message: string | null,
    rowUserId: string | null,
    after?: () => void,
    onError?: () => void,
    onDone?: (result: ProjectMembersResult) => void,
  ): void {
    this.saving.set(true);
    this.errors.set([]);
    this.api.setMembers(this.project().id, members, this.project().version).subscribe({
      next: (result) => {
        this.saving.set(false);
        if (message) this.toast.success(message);
        after?.();
        onDone?.(result);
        this.auth.refreshSession().subscribe();
        this.changed.emit();
        if (result.warnings?.length) this.showWarnings(result);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        onError?.();
        if (isApiError(err)) {
          if (err.status === 409) this.toast.error('تغيّر المشروع. أعد تحميل الصفحة وحاول مجددًا.');
          else this.errors.set([{ userId: rowUserId, message: err.details?.['members'] ? `${err.message} (${err.details['members']})` : err.message }]);
        }
        this.changed.emit();
      },
    });
  }

  private showWarnings(result: ProjectMembersResult): void {
    const data: MemberWarningsData = { projectId: result.id, warnings: result.warnings ?? [] };
    this.dialog.open<MemberWarningsDialog, MemberWarningsData>(MemberWarningsDialog, { data, width: 'min(520px, calc(100vw - 32px))' });
  }
}
