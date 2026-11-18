import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, linkedSignal, signal, viewChild } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { RouterLink } from '@angular/router';
import { ProjectLookup } from '@domain/projects/project.api';
import { SettingsStore } from '@domain/settings/settings.api';
import { UserLookup } from '@domain/users/user.api';
import { PagedResult } from '@core/models/entity.model';
import { WorkItemsApi } from '@domain/work-items/work-item.api';
import { WorkItem } from '@domain/work-items/work-item.models';
import { StatusLookup } from '@domain/workflow/workflow.api';
import { StatusCategory } from '@domain/workflow/workflow.models';
import { TypeChip } from '@shared/domain-ui/domain-ui';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { dayNumber, isClosedCategory, ReportFilters, resolvePeriod, todayIso } from './report-filters.model';

type WorkItemPage = PagedResult<WorkItem>;
type Zoom = 'week' | 'month' | 'quarter';

const ZOOMS: readonly { key: Zoom; label: string; pxPerDay: number }[] = [
  { key: 'week', label: 'أسبوع', pxPerDay: 24 },
  { key: 'month', label: 'شهر', pxPerDay: 8 },
  { key: 'quarter', label: 'ربع', pxPerDay: 3 },
];

const LABEL_WIDTH = 280;
const PAGE_SIZE = 100;
const NEUTRAL = 'var(--c-neutral)';

const monthFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

interface TimelineRow {
  readonly id: string;
  readonly projectId: string;
  readonly assignees: string;
  /** Progress % (projects only; work items carry none). */
  readonly percent: number | null;
  readonly kind: 'project' | 'item';
  readonly link: readonly string[];
  readonly ref: string;
  readonly title: string;
  readonly typeId: string | null;
  readonly color: string;
  readonly statusName: string;
  readonly start: number;
  readonly end: number;
  /** Only a due date: drawn as a diamond. */
  readonly diamond: boolean;
  readonly overdue: boolean;
  readonly aria: string;
}

interface Tick {
  readonly label: string;
  readonly left: number;
  readonly width: number;
}

/** Simple Gantt-lite (FR-UI-04): CSS-positioned bars, RTL so the earliest date is on the right. No critical path. */
@Component({
  selector: 'app-timeline-chart',
  imports: [RouterLink, TypeChip, EmptyState, ErrorState, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './timeline-chart.html',
  styleUrl: './timeline-chart.scss',
})
export class TimelineChart {
  private readonly api = inject(WorkItemsApi);
  private readonly projects = inject(ProjectLookup);
  private readonly statuses = inject(StatusLookup);
  private readonly settings = inject(SettingsStore);
  private readonly users = inject(UserLookup);

  readonly filters = input.required<ReportFilters>();

  protected readonly zooms = ZOOMS;
  protected readonly zoom = signal<Zoom>('month');
  protected readonly labelWidth = LABEL_WIDTH;
  /** Day number of today in the ORGANISATION time zone (NFR-10). */
  protected readonly today = computed(() => dayNumber(todayIso(this.settings.value().timeZone)));
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  constructor() {
    // Open centred on today instead of on the earliest date (RTL: scrollLeft is 0 at the right edge, negative leftwards).
    // Only once, so later zoom/filter changes keep the user's own scroll position.
    let centred = false;
    afterRenderEffect(() => {
      const el = this.scroller()?.nativeElement;
      const left = this.todayLeft();
      if (centred || !el || left === null) return;
      centred = true;
      el.scrollLeft = -Math.max(0, LABEL_WIDTH + left - el.clientWidth / 2);
    });
  }

  protected readonly data = rxResource({
    params: () => ({ projectId: this.filters().projectId, assigneeId: this.filters().assigneeId }),
    stream: ({ params }) => this.api.list(this.query(params, 1)),
  });

  /** Items loaded so far: the first page, plus pages appended by loadMore(); reset when the query changes. */
  private readonly loaded = linkedSignal<WorkItemPage | undefined, readonly WorkItem[]>({
    source: () => (this.data.hasValue() ? this.data.value() : undefined),
    computation: (page) => page?.items ?? [],
  });
  protected readonly total = computed(() => (this.data.hasValue() ? this.data.value().total : 0));
  protected readonly loadedCount = computed(() => this.loaded().length);
  protected readonly loadingMore = signal(false);
  protected readonly hasMore = computed(() => this.loaded().length < this.total());

  protected loadMore(): void {
    if (this.loadingMore() || !this.hasMore()) return;
    const params = { projectId: this.filters().projectId, assigneeId: this.filters().assigneeId };
    this.loadingMore.set(true);
    this.api.list(this.query(params, Math.floor(this.loaded().length / PAGE_SIZE) + 1)).subscribe({
      next: (page) => {
        const known = new Set(this.loaded().map((i) => i.id));
        this.loaded.update((list) => [...list, ...page.items.filter((i) => !known.has(i.id))]);
        this.loadingMore.set(false);
      },
      error: () => this.loadingMore.set(false),
    });
  }

  private query(params: { projectId: string; assigneeId: string }, page: number) {
    return {
      page,
      pageSize: PAGE_SIZE,
      filters: {
        ...(params.projectId ? { projectId: params.projectId } : {}),
        ...(params.assigneeId ? { assigneeIds: [params.assigneeId] } : {}),
      },
    };
  }

  private readonly pxPerDay = computed(() => ZOOMS.find((z) => z.key === this.zoom())?.pxPerDay ?? 8);

  private readonly period = computed(() => resolvePeriod(this.filters(), todayIso(this.settings.value().timeZone)));

  private overlaps(start: number, end: number): boolean {
    const { from, to } = this.period();
    return (!from || end >= dayNumber(from)) && (!to || start <= dayNumber(to));
  }

  private category(statusId: string): StatusCategory | undefined {
    return this.statuses.get(statusId)?.category;
  }

  private fmt(day: number): string {
    return dayFmt.format(new Date(day * 86_400_000));
  }

  protected readonly rows = computed<readonly TimelineRow[]>(() => {
    const f = this.filters();
    const items = this.loaded();
    const today = this.today();
    const byProject = new Map<string, TimelineRow[]>();

    for (const it of items) {
      if (it.archived || (!it.startDate && !it.dueDate)) continue;
      if (f.category && this.category(it.statusId) !== f.category) continue;
      const start = dayNumber((it.startDate ?? it.dueDate) as string);
      const end = Math.max(start, dayNumber((it.dueDate ?? it.startDate) as string));
      if (!this.overlaps(start, end)) continue;
      const diamond = !it.startDate;
      const status = this.statuses.get(it.statusId);
      const overdue = !!it.dueDate && end < today && !isClosedCategory(status?.category);
      const range = diamond ? `الاستحقاق ${this.fmt(end)}` : `من ${this.fmt(start)} إلى ${this.fmt(end)}`;
      const assignees = it.assigneeIds.map((id) => this.users.nameOf(id)).join('، ');
      const row: TimelineRow = {
        id: it.id, projectId: it.projectId, assignees, percent: null, kind: 'item', link: ['/work-items', it.id], ref: it.ref, title: it.title, typeId: it.typeId,
        color: status?.color ?? NEUTRAL, statusName: status?.name ?? '', start, end, diamond, overdue,
        aria: `${it.ref} ${it.title}، ${range}${overdue ? '، متأخر' : ''}`,
      };
      byProject.set(it.projectId, [...(byProject.get(it.projectId) ?? []), row]);
    }

    const itemFiltered = !!f.category || !!f.assigneeId;
    const out: TimelineRow[] = [];
    for (const p of this.projects.items()) {
      if (p.archived || (f.projectId && p.id !== f.projectId)) continue;
      const children = byProject.get(p.id) ?? [];
      const start = dayNumber(p.startDate);
      const end = Math.max(start, dayNumber(p.endDate));
      if (!children.length && (itemFiltered || !this.overlaps(start, end))) continue;
      const status = this.statuses.get(p.statusId);
      const overdue = end < today && !isClosedCategory(status?.category);
      out.push({
        id: p.id, projectId: p.id, assignees: '', percent: p.progress.percent, kind: 'project', link: ['/projects', p.id], ref: p.code, title: p.name, typeId: null,
        color: status?.color ?? NEUTRAL, statusName: status?.name ?? '', start, end, diamond: false, overdue,
        aria: `${p.code} ${p.name}، من ${this.fmt(start)} إلى ${this.fmt(end)}${overdue ? '، متأخر' : ''}`,
      });
      out.push(...children.sort((a, b) => a.start - b.start));
    }
    return out;
  });

  /** Visible window, snapped to whole months so header ticks align. */
  private readonly window = computed(() => {
    const rows = this.rows();
    const { from, to } = this.period();
    const dataMin = rows.length ? Math.min(...rows.map((r) => r.start), this.today()) : this.today();
    const dataMax = rows.length ? Math.max(...rows.map((r) => r.end), this.today()) : this.today();
    const a = new Date((from ? dayNumber(from) : dataMin) * 86_400_000);
    const b = new Date((to ? dayNumber(to) : dataMax) * 86_400_000);
    const start = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1) / 86_400_000;
    const end = Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + 1, 0) / 86_400_000;
    return { start, end: Math.max(end, start + 29) };
  });

  protected readonly trackWidth = computed(() => (this.window().end - this.window().start + 1) * this.pxPerDay());

  protected readonly ticks = computed<readonly Tick[]>(() => {
    const { start, end } = this.window();
    const px = this.pxPerDay();
    const out: Tick[] = [];
    let cursor = start;
    while (cursor <= end) {
      const d = new Date(cursor * 86_400_000);
      const monthEnd = Math.min(end, Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0) / 86_400_000);
      out.push({ label: monthFmt.format(d), left: (cursor - start) * px, width: (monthEnd - cursor + 1) * px });
      cursor = monthEnd + 1;
    }
    return out;
  });

  protected readonly todayLeft = computed(() => {
    const { start, end } = this.window();
    return this.today() >= start && this.today() <= end ? (this.today() - start + 0.5) * this.pxPerDay() : null;
  });

  protected readonly legend = computed(() => {
    const seen = new Map<string, string>();
    for (const r of this.rows()) if (r.statusName) seen.set(r.statusName, r.color);
    return [...seen].map(([name, color]) => ({ name, color }));
  });

  // ---------- Group by project: collapse / expand ----------

  protected readonly collapsed = signal<ReadonlySet<string>>(new Set());
  private readonly projectIds = computed(() => this.rows().filter((r) => r.kind === 'project').map((r) => r.id));
  protected readonly allCollapsed = computed(() => this.projectIds().length > 0 && this.projectIds().every((id) => this.collapsed().has(id)));
  protected readonly visibleRows = computed(() => {
    const hidden = this.collapsed();
    return this.rows().filter((r) => r.kind === 'project' || !hidden.has(r.projectId));
  });

  protected toggleGroup(id: string): void {
    this.collapsed.update((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  protected setAllCollapsed(collapse: boolean): void {
    this.collapsed.set(collapse ? new Set(this.projectIds()) : new Set());
  }

  // ---------- Hover / focus popover (one shared element, positioned from the bar's rectangle) ----------

  protected readonly tip = signal<{ row: TimelineRow; inline: number; top: number } | null>(null);

  protected showTip(row: TimelineRow, event: Event): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const rtl = document.documentElement.dir === 'rtl';
    const inline = Math.max(8, Math.min(rtl ? window.innerWidth - rect.right : rect.left, window.innerWidth - 300));
    this.tip.set({ row, inline, top: rect.bottom + 6 });
  }

  protected hideTip(): void {
    this.tip.set(null);
  }

  protected range(r: TimelineRow): string {
    return r.diamond ? 'الاستحقاق ' + this.fmt(r.end) : 'من ' + this.fmt(r.start) + ' إلى ' + this.fmt(r.end);
  }

  protected barLeft(r: TimelineRow): number {
    return (Math.max(r.start, this.window().start) - this.window().start) * this.pxPerDay();
  }

  protected barWidth(r: TimelineRow): number {
    const { start, end } = this.window();
    const s = Math.max(r.start, start);
    const e = Math.min(r.end, end);
    return Math.max((e - s + 1) * this.pxPerDay(), 8);
  }

  protected diamondLeft(r: TimelineRow): number {
    return (r.end - this.window().start + 0.5) * this.pxPerDay() - 8;
  }

  protected asZoom(event: Event): Zoom {
    const v = (event.target as HTMLSelectElement).value;
    return ZOOMS.find((z) => z.key === v)?.key ?? 'month';
  }
}
