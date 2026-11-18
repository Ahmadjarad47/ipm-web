import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, TemplateRef, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import { CanDirective } from '@core/auth/can.directive';
import { RoleLookup } from '@domain/users/user.api';
import { User } from '@domain/users/user.models';
import { Avatar } from '@shared/ui/avatar/avatar';
import { Badge } from '@shared/ui/badge/badge';
import { CellContext, ColumnDef } from '@shared/ui/data-table/data-table.models';
import { DataTable } from '@shared/ui/data-table/data-table';
import { DialogService } from '@shared/ui/dialog/dialog.service';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { Icon } from '@shared/ui/icon/icon';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { UserCreateDialog } from './user-create-dialog';
import { UserDialog } from './user-dialog';
import { UserListStore } from './user-list.store';

@Component({
  selector: 'app-users-tab',
  imports: [DataTable, Avatar, Badge, Icon, CanDirective, EmptyState, ErrorState, Skeleton],
  providers: [UserListStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card">
      <div class="toolbar">
        <div class="search">
          <app-icon name="search" [size]="16" />
          <input class="input" type="search" placeholder="بحث بالاسم أو اسم المستخدم أو البريد…" aria-label="بحث في المستخدمين"
            (input)="search$.next($any($event.target).value)" />
        </div>
        <select class="select" aria-label="تصفية بحالة الحساب" (change)="setFilter('active', $event)">
          <option value="">كل الحالات</option>
          <option value="true">نشط</option>
          <option value="false">معطّل</option>
        </select>
        <select class="select" aria-label="تصفية بدور النظام" (change)="setFilter('systemRoleIds', $event)">
          <option value="">كل الأدوار</option>
          @for (r of systemRoles(); track r.id) {
            <option [value]="r.id">{{ r.name }}</option>
          }
        </select>
        <span class="spacer"></span>
        <span class="muted">{{ store.total() }} مستخدم</span>
        <button *appCan="'roles.manage'" type="button" class="btn btn--primary" (click)="create()">
          <app-icon name="plus" [size]="16" /> مستخدم جديد
        </button>
      </div>
      @if (store.error(); as err) {
        <app-error-state title="تعذّر تحميل المستخدمين" [text]="err" (retry)="store.reload()" />
      } @else if (store.loading() && !store.items().length) {
        <div class="pad"><app-skeleton variant="table" [count]="6" /></div>
      } @else if (store.isEmpty()) {
        <app-empty-state icon="users" title="لا يوجد مستخدمون مطابقون" text="جرّب تعديل البحث أو الفلاتر، أو أنشئ حسابًا جديدًا.">
          <button *appCan="'roles.manage'" type="button" class="btn btn--primary" (click)="create()">
            <app-icon name="plus" [size]="16" /> مستخدم جديد
          </button>
        </app-empty-state>
      } @else {
        <app-data-table tableId="admin-users" [rows]="store.items()" [columns]="columns()" [loading]="store.loading()" [total]="store.total()"
          [page]="store.query().page" [pageSize]="store.query().pageSize" [sort]="store.query().sort" caption="المستخدمون"
          emptyTitle="لا يوجد مستخدمون" (sortChange)="store.setSort($event)" (pageChange)="store.setPage($event)"
          (pageSizeChange)="store.setPageSize($event)" (rowClick)="open($event)" />
      }
    </section>

    <ng-template #nameTpl let-u>
      <span class="row"><app-avatar [name]="u.name" [size]="30" /> <strong>{{ u.name }}</strong></span>
    </ng-template>
    <ng-template #usernameTpl let-u><span class="ltr">{{ u.username }}</span></ng-template>
    <ng-template #emailTpl let-u><span class="ltr">{{ u.email }}</span></ng-template>
    <ng-template #rolesTpl let-u>
      <span class="row">
        @for (id of u.systemRoleIds; track id) {
          <app-badge tone="emerald">{{ roles.get(id)?.name ?? id }}</app-badge>
        } @empty {
          <span class="muted">—</span>
        }
      </span>
    </ng-template>
    <ng-template #activeTpl let-u>
      <app-badge [tone]="u.active ? 'success' : 'neutral'" [dot]="true">{{ u.active ? 'نشط' : 'معطّل' }}</app-badge>
    </ng-template>
  `,
  styles: `
    .search { position: relative; display: flex; align-items: center; min-width: min(100%, 280px); }
    .search app-icon { position: absolute; inset-inline-start: 10px; color: var(--c-muted); }
    .search .input { padding-inline-start: 34px; }
    .pad { padding: var(--s-4); }
  `,
})
export class UsersTab {
  protected readonly store = inject(UserListStore);
  protected readonly roles = inject(RoleLookup);
  private readonly dialog = inject(DialogService);

  protected readonly search$ = new Subject<string>();
  protected readonly systemRoles = computed(() => this.roles.items().filter((r) => r.scope === 'system'));
  /** The email column is hidden unless the server returned at least one address (it is blanked without `roles.manage`). */
  private readonly hasEmail = computed(() => this.store.items().some((u) => !!u.email));

  private readonly nameTpl = viewChild.required<TemplateRef<CellContext<User>>>('nameTpl');
  private readonly usernameTpl = viewChild.required<TemplateRef<CellContext<User>>>('usernameTpl');
  private readonly emailTpl = viewChild.required<TemplateRef<CellContext<User>>>('emailTpl');
  private readonly rolesTpl = viewChild.required<TemplateRef<CellContext<User>>>('rolesTpl');
  private readonly activeTpl = viewChild.required<TemplateRef<CellContext<User>>>('activeTpl');

  protected readonly columns = computed<readonly ColumnDef<User>[]>(() => [
    { key: 'name', header: 'المستخدم', sortable: true, required: true, template: this.nameTpl() },
    { key: 'username', header: 'اسم المستخدم', sortable: true, template: this.usernameTpl(), hideOnMobile: true },
    { key: 'email', header: 'البريد', sortable: true, template: this.emailTpl(), hideOnMobile: true, hidden: !this.hasEmail() },
    { key: 'title', header: 'المسمى الوظيفي', sortable: true, hideOnMobile: true },
    { key: '_roles', header: 'أدوار النظام', template: this.rolesTpl() },
    { key: 'active', header: 'الحالة', sortable: true, template: this.activeTpl() },
  ]);

  constructor() {
    this.search$.pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(inject(DestroyRef))).subscribe((q) => this.store.setSearch(q.trim()));
  }

  protected setFilter(field: 'active' | 'systemRoleIds', event: Event): void {
    this.store.setFilter(field, (event.target as HTMLSelectElement).value || undefined);
  }

  /** FR-AUTH-02: create an internal account; the dialog reloads the user lookup itself. */
  protected create(): void {
    this.dialog
      .open<UserCreateDialog, void, User>(UserCreateDialog, { width: 'min(560px, calc(100vw - 32px))' })
      .afterClosed.subscribe((created) => {
        if (created) this.store.reload();
      });
  }

  protected open(user: User): void {
    this.dialog
      .open<UserDialog, User, User>(UserDialog, { data: user, width: 'min(560px, calc(100vw - 32px))' })
      .afterClosed.subscribe(() => {
        this.store.reload();
      });
  }
}
