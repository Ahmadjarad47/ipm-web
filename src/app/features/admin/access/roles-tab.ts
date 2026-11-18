import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { isApiError } from '@core/models/api-error.model';
import { ToastService } from '@core/notifications/toast.service';
import { ProjectLookup } from '@domain/projects/project.api';
import { RoleLookup, RolesApi, UserLookup } from '@domain/users/user.api';
import { Role } from '@domain/users/user.models';
import { Badge } from '@shared/ui/badge/badge';
import { ConfirmService } from '@shared/ui/dialog/confirm-dialog';
import { DialogService } from '@shared/ui/dialog/dialog.service';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { Icon } from '@shared/ui/icon/icon';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { AdminNotice } from '../shared/admin-notice';
import { RoleDialog, RoleDialogData } from './role-dialog';

@Component({
  selector: 'app-roles-tab',
  imports: [Badge, Icon, EmptyState, AdminNotice, Skeleton, ErrorState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      <div class="row">
        <app-admin-notice class="grow">المنع الصريح يتغلّب على المنح. أدوار المشروع تسري فقط داخل المشاريع التي أُسندت فيها.</app-admin-notice>
        <button type="button" class="btn btn--primary" (click)="open(null)"><app-icon name="plus" [size]="16" /> دور جديد</button>
      </div>
      @if (roles.error()) {
        <app-error-state title="تعذّر تحميل الأدوار" (retry)="roles.reload()" />
      } @else if (roles.loading() && !roles.items().length) {
        <app-skeleton variant="card" [count]="3" />
      } @else if (!roles.items().length) {
        <app-empty-state icon="shield" title="لا توجد أدوار" />
      } @else {
        <div class="grid grid--3">
          @for (r of roles.items(); track r.id) {
            <article class="card role">
              <div class="card-body stack">
                <div class="row">
                  <h3>{{ r.name }}</h3>
                  <span class="spacer"></span>
                  <button type="button" class="btn btn--ghost btn--sm" (click)="open(r)" [attr.aria-label]="'تعديل الدور ' + r.name"><app-icon name="edit" [size]="15" /> تعديل</button>
                  @if (r.builtIn) {
                    <span class="lock" title="الأدوار المدمجة لا تُحذف، تُعدَّل فقط">
                      <button type="button" class="btn btn--ghost btn--sm" disabled [attr.aria-label]="'لا يمكن حذف الدور المدمج ' + r.name"><app-icon name="lock" [size]="15" /> حذف</button>
                    </span>
                  } @else {
                    <span class="lock" [title]="usage(r) ? 'لا يمكن حذف دور مستخدم. أزله من حامليه أولًا.' : ''">
                      <button type="button" class="btn btn--ghost btn--sm" [disabled]="usage(r) > 0" (click)="remove(r)" [attr.aria-label]="'حذف الدور ' + r.name"><app-icon name="trash" [size]="15" /> حذف</button>
                    </span>
                  }
                </div>
                <span class="ltr muted">{{ r.key }}</span>
                @if (r.description) {
                  <p class="muted">{{ r.description }}</p>
                }
                <div class="row">
                  <app-badge [tone]="r.scope === 'system' ? 'info' : 'gold'">{{ r.scope === 'system' ? 'نظام' : 'مشروع' }}</app-badge>
                  @if (r.builtIn) {
                    <app-badge tone="neutral">مدمج</app-badge>
                  }
                  <app-badge tone="emerald">{{ r.permissions.length }} صلاحية</app-badge>
                  <app-badge tone="info">يستخدمه {{ usage(r) }} {{ usage(r) === 1 ? 'مستخدم' : 'مستخدمًا' }}</app-badge>
                  @if (r.denied.length) {
                    <app-badge tone="danger">{{ r.denied.length }} ممنوعة</app-badge>
                  }
                </div>
              </div>
            </article>
          }
        </div>
      }
    </div>
  `,
  styles: `
    h3 { font-size: var(--fs-lg); color: var(--c-emerald-900); }
    .grow { flex: 1; min-width: min(100%, 260px); }
    .role .stack { gap: var(--s-2); }
    .stack > .row { flex-wrap: wrap; }
    .lock { display: inline-flex; }
  `,
})
export class RolesTab {
  protected readonly roles = inject(RoleLookup);
  private readonly dialog = inject(DialogService);
  private readonly users = inject(UserLookup);
  private readonly projects = inject(ProjectLookup);
  private readonly api = inject(RolesApi);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  /** roleId -> number of distinct users holding it (system roles via the account, project roles via memberships). */
  private readonly usageByRole = computed(() => {
    const holders = new Map<string, Set<string>>();
    const add = (roleId: string, userId: string): void => {
      holders.set(roleId, (holders.get(roleId) ?? new Set<string>()).add(userId));
    };
    for (const u of this.users.items()) for (const id of u.systemRoleIds) add(id, u.id);
    for (const p of this.projects.items()) for (const m of p.members) add(m.roleId, m.userId);
    return holders;
  });

  protected usage(role: Role): number {
    return this.usageByRole().get(role.id)?.size ?? 0;
  }

  protected remove(role: Role): void {
    this.confirm
      .confirm({ title: 'حذف الدور', message: `سيُحذف الدور «${role.name}». لا يمكن التراجع.`, confirmText: 'حذف', danger: true })
      .subscribe((ok) => {
        if (!ok) return;
        this.api.remove(role.id).subscribe({
          next: () => {
            this.toast.success('تم حذف الدور');
            this.roles.reload();
          },
          // The server may refuse (roles with history are deactivated instead); the interceptor already toasted the reason.
          error: (e: unknown) => {
            if (isApiError(e) && e.status === 409) this.roles.reload();
          },
        });
      });
  }

  protected open(role: Role | null): void {
    this.dialog.open<RoleDialog, RoleDialogData, Role>(RoleDialog, {
      data: { role },
      width: 'min(820px, calc(100vw - 32px))',
    });
  }
}
