import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin, map } from 'rxjs';
import { emptyPage, PagedResult } from '@core/models/entity.model';
import { GitIntegrationApi } from '@domain/git/git.api';
import { SimulatedGitEvent, suggestedBranch, WEBHOOK_OUTCOME_LABELS, WebhookDelivery, WebhookOutcome } from '@domain/git/git.models';
import { ProjectSummary } from '@domain/projects/project.models';
import { WorkItemsApi, WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { WorkItem } from '@domain/work-items/work-item.models';
import { Badge, BadgeTone } from '@shared/ui/badge/badge';
import { gitConnector } from '@domain/git/git-connector';
import { explainDelivery } from './git-logic';

const OUTCOME_TONES: Record<WebhookOutcome, BadgeTone> = { processed: 'success', duplicate: 'neutral', rejected: 'danger', failed: 'warning' };

let nextId = 0;

interface LinkedRef {
  readonly ref: string;
  readonly id: string | null;
}

/** Demo-only (mock backend): sends a signed provider-shaped event through the real verification path. */
@Component({
  selector: 'app-git-simulator',
  imports: [FormsModule, RouterLink, Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card card-body sim" [attr.aria-labelledby]="uid + '-title'">
      <h3 class="section-title" [id]="uid + '-title'">محاكاة حدث Git <app-badge tone="gold">وضع تجريبي</app-badge></h3>
      <p class="muted note">أداة للعرض التجريبي فقط (لا تظهر مع الخادم الحقيقي). يوقّع الحدث بسر المستودع ويمر عبر مسار التحقق الحقيقي (التوقيع، منع التكرار، الربط التلقائي).@if (headers(); as h) { الترويسات المرسلة لهذا المزوّد: <span class="ltr">{{ h }}</span>. }</p>
      <form class="form-grid" (ngSubmit)="submit()">
        <div class="field">
          <label [attr.for]="uid + '-repo'">المستودع</label>
          <select [id]="uid + '-repo'" class="select" name="repo" [ngModel]="repoId()" (ngModelChange)="repoId.set($event)">
            @for (r of connectedRepos(); track r.id) {
              <option [value]="r.id">{{ r.name }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label [attr.for]="uid + '-event'">الحدث</label>
          <select [id]="uid + '-event'" class="select" name="event" [ngModel]="event()" (ngModelChange)="event.set($event)">
            <option value="push">دفع (push)</option>
            <option value="pr_open">فتح PR</option>
            <option value="pr_merge">دمج PR</option>
          </select>
        </div>
        <div class="field">
          <label [attr.for]="uid + '-item'">عمل (لاقتراح الفرع)</label>
          <select [id]="uid + '-item'" class="select" name="item" [ngModel]="itemId()" (ngModelChange)="pickItem($event)">
            <option value="">—</option>
            @for (w of items.value().items; track w.id) {
              <option [value]="w.id">{{ w.ref }} — {{ w.title }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label [attr.for]="uid + '-branch'">الفرع</label>
          <input [id]="uid + '-branch'" class="input ltr" name="branch" [ngModel]="branch()" (ngModelChange)="branch.set($event)" autocomplete="off" />
        </div>
        <div class="field span-2">
          <label [attr.for]="uid + '-msg'">الرسالة</label>
          <input [id]="uid + '-msg'" class="input ltr" name="message" [ngModel]="message()" (ngModelChange)="message.set($event)" autocomplete="off" />
        </div>
        <div class="field">
          <label [attr.for]="uid + '-author'">المؤلف</label>
          <input [id]="uid + '-author'" class="input" name="author" [ngModel]="author()" (ngModelChange)="author.set($event)" autocomplete="off" />
        </div>
        <div class="field checks">
          <label class="chk"><input type="checkbox" name="unsigned" [ngModel]="unsigned()" (ngModelChange)="unsigned.set($event)" /> بدون توقيع صالح</label>
          <label class="chk"><input type="checkbox" name="replay" [ngModel]="replayLast()" (ngModelChange)="replayLast.set($event)" /> إعادة إرسال آخر تسليم</label>
        </div>
        <div class="field span-2">
          <button type="submit" class="btn btn--primary" [disabled]="sending() || !repoId()">{{ sending() ? 'جارٍ الإرسال…' : 'إرسال الحدث' }}</button>
        </div>
      </form>

      @if (result(); as d) {
        <div class="result" role="status" aria-live="polite">
          <app-badge [tone]="tone(d.outcome)">{{ label(d.outcome) }}</app-badge>
          <span>{{ d.signatureValid ? 'التوقيع صالح' : 'التوقيع غير صالح' }}</span>
          <span class="muted">{{ explain(d) }}</span>
          @for (l of links(); track l.ref) {
            @if (l.id) {
              <a class="ltr ref" [routerLink]="['/work-items', l.id]">{{ l.ref }}</a>
            } @else {
              <a class="ltr ref" routerLink="/work-items" [queryParams]="{ search: l.ref }">{{ l.ref }}</a>
            }
          }
        </div>
      }
    </section>
  `,
  styles: `
    .sim { margin-block-start: var(--s-6); }
    .note { margin: 0 0 var(--s-3); }
    .checks { display: flex; flex-direction: column; gap: var(--s-2); justify-content: flex-end; }
    .chk { display: inline-flex; align-items: center; gap: var(--s-2); }
    .result { display: flex; align-items: center; gap: var(--s-3); flex-wrap: wrap; margin-block-start: var(--s-3); padding: var(--s-3); border-radius: 8px; background: var(--c-surface-2); }
    .ref { color: var(--c-primary); font-weight: 600; }
    .result, .note { overflow-wrap: anywhere; }
    @media (pointer: coarse), (max-width: 768px) {
      .chk, .ref { min-block-size: 44px; display: inline-flex; align-items: center; }
      .chk input { inline-size: 20px; block-size: 20px; }
    }
  `,
})
export class GitSimulator {
  readonly project = input.required<ProjectSummary>();
  /** Emitted after a simulated delivery so the parent reloads events and deliveries. */
  readonly simulated = output<void>();
  protected readonly uid = `sim${++nextId}`;

  private readonly api = inject(GitIntegrationApi);
  private readonly workItems = inject(WorkItemsApi);
  private readonly types = inject(WorkItemTypeLookup);

  protected readonly connectedRepos = computed(() => this.project().repositories.filter((r) => r.connected));
  protected readonly repoId = linkedSignal(() => this.connectedRepos()[0]?.id ?? '');
  protected readonly event = signal<SimulatedGitEvent>('push');
  protected readonly itemId = signal('');
  protected readonly branch = signal('');
  protected readonly message = signal('');
  protected readonly author = signal('demo.dev');
  protected readonly unsigned = signal(false);
  protected readonly replayLast = signal(false);
  protected readonly sending = signal(false);
  protected readonly result = signal<WebhookDelivery | null>(null);
  protected readonly links = signal<readonly LinkedRef[]>([]);

  protected readonly items = rxResource<PagedResult<WorkItem>, string>({
    params: () => this.project().id,
    stream: ({ params }) => this.workItems.list({ page: 1, pageSize: 50, filters: { projectId: params } }),
    defaultValue: emptyPage<WorkItem>(50),
  });

  protected readonly headers = computed(() => {
    const repo = this.connectedRepos().find((r) => r.id === this.repoId());
    if (!repo) return '';
    const c = gitConnector(repo.provider);
    return `${c.eventHeader}, ${c.deliveryHeader}, ${c.signatureHeader}`;
  });

  protected explain(d: WebhookDelivery): string {
    return explainDelivery(d);
  }

  protected pickItem(id: string): void {
    this.itemId.set(id);
    const item = this.items.value().items.find((w) => w.id === id);
    if (!item) return;
    this.branch.set(suggestedBranch(item.ref, this.types.get(item.typeId)?.key));
    this.message.set(`${item.ref} `);
  }

  protected label(o: WebhookOutcome): string {
    return WEBHOOK_OUTCOME_LABELS[o];
  }

  protected tone(o: WebhookOutcome): BadgeTone {
    return OUTCOME_TONES[o];
  }

  protected submit(): void {
    const repositoryId = this.repoId();
    if (!repositoryId) return;
    this.sending.set(true);
    this.api
      .simulate({
        repositoryId,
        event: this.event(),
        branch: this.branch().trim() || 'main',
        message: this.message(),
        author: this.author().trim() || 'demo.dev',
        unsigned: this.unsigned(),
        replayLast: this.replayLast(),
      })
      .subscribe({
        next: (delivery) => {
          this.sending.set(false);
          this.result.set(delivery);
          this.links.set(delivery.linkedRefs.map((ref) => ({ ref, id: null })));
          this.resolveLinks(delivery.linkedRefs);
          this.simulated.emit();
        },
        error: () => this.sending.set(false),
      });
  }

  /** Looks each ref up so the chip can link straight to the work item. */
  private resolveLinks(refs: readonly string[]): void {
    if (!refs.length) return;
    forkJoin(
      refs.map((ref) =>
        this.workItems.list({ page: 1, pageSize: 1, search: ref }).pipe(
          map((p): LinkedRef => ({ ref, id: p.items.find((w) => w.ref === ref)?.id ?? null })),
        ),
      ),
    ).subscribe((resolved) => this.links.set(resolved));
  }
}
