import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ToastService } from '@core/notifications/toast.service';
import { ProjectLookup } from '@domain/projects/project.api';
import { WorkReportApi } from '@domain/reports/report.api';
import { SettingsStore } from '@domain/settings/settings.api';
import { UserLookup } from '@domain/users/user.api';
import { todayIso } from './report-filters.model';
import { RANGE_LABELS, rangeProblem, ReportRange, reportFileName, resolveRange } from './work-report.model';

/**
 * Downloads the work report as an Excel file: a ready-made month or a period of the user's own, for all projects, some of them, or one,
 * and for everyone or for one person (what they worked on across the chosen projects).
 */
@Component({
  selector: 'app-work-report-export',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="card card-body stack" aria-label="تنزيل تقرير العمل" (submit)="$event.preventDefault(); download()">
      <p class="muted">ملف Excel فيه ملخص لكل مشروع وقائمة بالأعمال التي أُنشئت أو تغيّرت حالتها أو تحدّثت خلال الفترة.</p>

      <div class="grid">
        <div class="field">
          <label for="wr-range">الفترة</label>
          <select id="wr-range" class="select" (change)="range.set(asRange(val($event)))">
            @for (r of ranges; track r.key) {
              <option [value]="r.key" [selected]="r.key === range()">{{ r.label }}</option>
            }
          </select>
        </div>
        @if (range() === 'custom') {
          <div class="field">
            <label for="wr-from">من</label>
            <input id="wr-from" type="date" class="input" dir="ltr" [value]="from()" [max]="to() || null" (change)="from.set(val($event))" />
          </div>
          <div class="field">
            <label for="wr-to">إلى</label>
            <input id="wr-to" type="date" class="input" dir="ltr" [value]="to()" [min]="from() || null" (change)="to.set(val($event))" />
          </div>
        }
        <div class="field">
          <label for="wr-person">الشخص</label>
          <select id="wr-person" class="select" (change)="person.set(val($event))">
            <option value="" [selected]="!person()">كل المكلَّفين</option>
            @for (u of users.items(); track u.id) {
              <option [value]="u.id" [selected]="u.id === person()">{{ u.name }}</option>
            }
          </select>
        </div>
      </div>

      <fieldset class="projects">
        <legend>المشاريع</legend>
        <label class="opt">
          <input type="checkbox" [checked]="allProjects()" (change)="toggleAll()" />
          <span>كل مشاريعي</span>
        </label>
        @if (!allProjects()) {
          <div class="list" role="group" aria-label="اختر المشاريع">
            @for (p of projectOptions(); track p.id) {
              <label class="opt">
                <input type="checkbox" [checked]="chosen().has(p.id)" (change)="toggle(p.id)" />
                <span>{{ p.name }} <span class="muted ltr">{{ p.code }}</span></span>
              </label>
            }
          </div>
        }
      </fieldset>

      @if (problem(); as p) {
        <p class="err" role="alert">{{ p }}</p>
      } @else {
        <p class="muted" role="status">{{ summary() }}</p>
      }

      <div class="actions">
        <button type="submit" class="btn btn--primary" [disabled]="!!problem() || busy()">{{ busy() ? 'جارٍ إعداد الملف…' : 'تنزيل التقرير (Excel)' }}</button>
      </div>
    </form>
  `,
  styles: `
    .stack { display: grid; gap: var(--s-4); }
    .grid { display: flex; flex-wrap: wrap; gap: var(--s-4); align-items: flex-end; }
    .field { min-width: 180px; }
    .projects { border: 1px solid var(--c-border); border-radius: var(--r-md); padding: var(--s-3) var(--s-4); display: grid; gap: var(--s-2); }
    .projects legend { font-weight: 600; padding-inline: var(--s-2); }
    .list { display: grid; gap: var(--s-1); max-height: 260px; overflow: auto; padding-block-start: var(--s-2); border-block-start: 1px solid var(--c-border); }
    .opt { display: flex; align-items: center; gap: var(--s-2); cursor: pointer; }
    .err { color: var(--c-danger); margin: 0; }
    .actions { display: flex; gap: var(--s-3); }
  `,
})
export class WorkReportExport {
  private readonly api = inject(WorkReportApi);
  private readonly settings = inject(SettingsStore);
  private readonly toast = inject(ToastService);
  private readonly projects = inject(ProjectLookup);
  protected readonly users = inject(UserLookup);

  protected readonly ranges = (Object.keys(RANGE_LABELS) as ReportRange[]).map((key) => ({ key, label: RANGE_LABELS[key] }));
  protected readonly range = signal<ReportRange>('last-month');
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly person = signal('');
  protected readonly allProjects = signal(true);
  protected readonly chosen = signal<ReadonlySet<string>>(new Set());
  protected readonly busy = signal(false);

  protected readonly projectOptions = computed(() => this.projects.items());
  private readonly today = computed(() => todayIso(this.settings.value().timeZone));
  private readonly bounds = computed(() => resolveRange(this.range(), this.today(), { from: this.from(), to: this.to() }));

  protected readonly problem = computed(() => rangeProblem(this.bounds()) ?? (!this.allProjects() && this.chosen().size === 0 ? 'اختر مشروعًا واحدًا على الأقل.' : null));

  protected readonly summary = computed(() => {
    const { from, to } = this.bounds();
    const scope = this.allProjects() ? 'كل مشاريعك' : `${this.chosen().size} مشروع`;
    const who = this.person() ? ` · ${this.users.get(this.person())?.name ?? ''}` : '';
    return `من ${from} إلى ${to} · ${scope}${who}`;
  });

  protected val(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected asRange(v: string): ReportRange {
    return this.ranges.find((r) => r.key === v)?.key ?? 'last-month';
  }

  protected toggleAll(): void {
    this.allProjects.update((v) => !v);
  }

  protected toggle(id: string): void {
    this.chosen.update((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  protected download(): void {
    if (this.problem() || this.busy()) return;
    const bounds = this.bounds();
    this.busy.set(true);
    this.api.download({ ...bounds, projectIds: this.allProjects() ? [] : [...this.chosen()], assigneeId: this.person() }).subscribe({
      next: (file) => {
        this.busy.set(false);
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url;
        a.download = reportFileName(bounds);
        a.click();
        URL.revokeObjectURL(url);
        this.toast.success('تم تنزيل التقرير');
      },
      error: () => this.busy.set(false),
    });
  }
}
