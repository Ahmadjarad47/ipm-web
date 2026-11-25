import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { map, startWith } from 'rxjs';
import { isApiError } from '@core/models/api-error.model';
import { ToastService } from '@core/notifications/toast.service';
import { SettingsStore } from '@domain/settings/settings.api';
import { WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { HELP } from '@shared/help/help-texts';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { HelpTip } from '@shared/ui/help-tip/help-tip';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { DEFAULT_SETTINGS, SettingsUpdate } from '@domain/settings/settings.models';
import { Icon } from '@shared/ui/icon/icon';
import { PageHeader } from '@shared/ui/page-header/page-header';
import { ADMIN_HELP } from '../shared/admin-help';
import { AdminNotice } from '../shared/admin-notice';
import { HasUnsavedChanges, warnBeforeUnload } from '../shared/unsaved-changes';
import { progressExample, sameIds } from './progress-example';

/** Extensions that may never be uploaded (FR-COL-05). */
const BLOCKED_EXTENSIONS: readonly string[] = ['exe', 'bat', 'cmd', 'sh', 'ps1', 'msi', 'js', 'vbs', 'jar', 'scr', 'dll', 'com'];

const TIME_ZONES: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'Asia/Riyadh', label: 'الرياض (Asia/Riyadh)' },
  { id: 'Asia/Dubai', label: 'دبي (Asia/Dubai)' },
  { id: 'Asia/Kuwait', label: 'الكويت (Asia/Kuwait)' },
  { id: 'Africa/Cairo', label: 'القاهرة (Africa/Cairo)' },
  { id: 'Asia/Amman', label: 'عمّان (Asia/Amman)' },
  { id: 'UTC', label: 'التوقيت العالمي (UTC)' },
];

type NumberKey = 'sessionHours' | 'commentEditHours' | 'attachmentMaxMb' | 'auditRetentionDays';
type BoolKey = 'allowCrossProjectRelations' | 'allowSelfApproval' | 'projectsPrivateByDefault';

/** Organisation settings (`settings.manage`); every change is audited (NFR-13). */
@Component({
  selector: 'app-settings-page',
  imports: [ReactiveFormsModule, PageHeader, AdminNotice, Icon, Skeleton, ErrorState, HelpTip],
  host: { '(window:beforeunload)': 'onUnload($event)' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './settings-page.scss',
  template: `
    <app-page-header title="إعدادات النظام" subtitle="سياسات المؤسسة القابلة للضبط. كل تغيير يُسجَّل في سجل التدقيق." />

    @if (store.loading() && !store.current()) {
      <app-skeleton variant="detail" [count]="5" />
    } @else if (!store.current()) {
      <section class="card"><app-error-state title="تعذّر تحميل الإعدادات" (retry)="store.reload()" /></section>
    } @else {
      <form class="stack" [formGroup]="form" (ngSubmit)="save()" aria-label="إعدادات النظام">
        <section class="card" aria-labelledby="g-session">
          <div class="card-body stack">
            <div><h2 id="g-session">الجلسات</h2><p class="muted">مدة بقاء الجلسة قبل طلب تسجيل الدخول من جديد (FR-AUTH-06).</p></div>
            <div class="field narrow">
              <label for="s-session">مدة الجلسة (ساعات)</label>
              <input id="s-session" class="input ltr" type="number" min="1" max="24" formControlName="sessionHours" [attr.aria-invalid]="invalid('sessionHours')" />
              <span class="hint">من 1 إلى 24 ساعة. تُطبَّق على الجلسات الجديدة.</span>
              @if (invalid('sessionHours')) { <span class="error" role="alert">{{ errorOf('sessionHours', 'القيمة بين 1 و 24.') }}</span> }
            </div>
          </div>
        </section>

        <section class="card" aria-labelledby="g-collab">
          <div class="card-body stack">
            <div><h2 id="g-collab">التعاون</h2><p class="muted">قواعد التعليقات والنقاش (FR-COL-02).</p></div>
            <div class="field narrow">
              <label for="s-comment">مهلة تعديل التعليق (ساعات)</label>
              <input id="s-comment" class="input ltr" type="number" min="0" max="168" formControlName="commentEditHours" [attr.aria-invalid]="invalid('commentEditHours')" />
              <span class="hint">من 0 إلى 168 ساعة؛ 0 يعني منع التعديل بعد النشر.</span>
              @if (invalid('commentEditHours')) { <span class="error" role="alert">{{ errorOf('commentEditHours', 'القيمة بين 0 و 168.') }}</span> }
            </div>
          </div>
        </section>

        <section class="card" aria-labelledby="g-att">
          <div class="card-body stack">
            <div><h2 id="g-att">المرفقات</h2><p class="muted">الحد الأقصى للحجم والامتدادات المسموحة (FR-COL-05).</p></div>
            <div class="field narrow">
              <label for="s-mb">الحجم الأقصى للملف (ميغابايت)</label>
              <input id="s-mb" class="input ltr" type="number" min="1" max="100" formControlName="attachmentMaxMb" [attr.aria-invalid]="invalid('attachmentMaxMb')" />
              <span class="hint">من 1 إلى 100.</span>
              @if (invalid('attachmentMaxMb')) { <span class="error" role="alert">{{ errorOf('attachmentMaxMb', 'القيمة بين 1 و 100.') }}</span> }
            </div>
            <div class="field">
              <label for="s-ext">الامتدادات المسموحة</label>
              <ul class="chips" aria-label="الامتدادات المسموحة">
                @for (ext of extensions(); track ext) {
                  <li class="chip">
                    <span class="ltr">{{ ext }}</span>
                    <button type="button" class="chip-x" (click)="removeExtension(ext)" [attr.aria-label]="'إزالة الامتداد ' + ext"><app-icon name="close" [size]="12" /></button>
                  </li>
                } @empty {
                  <li class="muted">لا توجد امتدادات.</li>
                }
              </ul>
              <div class="add-row">
                <input id="s-ext" class="input ltr" [value]="extDraft()" placeholder="مثال: pdf" autocomplete="off" aria-describedby="s-ext-hint"
                  (input)="extDraft.set($any($event.target).value)" (keydown.enter)="$event.preventDefault(); addExtension()" />
                <button type="button" class="btn btn--outline" (click)="addExtension()"><app-icon name="plus" [size]="14" /> إضافة</button>
              </div>
              <span id="s-ext-hint" class="hint">أحرف إنجليزية صغيرة وأرقام بدون نقطة. الامتدادات التنفيذية محظورة دائمًا.</span>
              @if (extError()) { <span class="error" role="alert">{{ extError() }}</span> }
              @if (serverErrors()['attachmentExtensions']; as e) { <span class="error" role="alert">{{ e }}</span> }
            </div>
          </div>
        </section>

        <section class="card" aria-labelledby="g-pol">
          <div class="card-body stack">
            <div><h2 id="g-pol">السياسات</h2><p class="muted">قواعد الوصول والعلاقات والموافقات.</p></div>
            <label class="opt">
              <input type="checkbox" formControlName="allowCrossProjectRelations" />
              <span><strong>السماح بعلاقات بين المشاريع</strong><span class="hint">يتيح ربط أعمال من مشاريع مختلفة (FR-REL-07). الافتراضي: معطّل.</span></span>
            </label>
            <label class="opt">
              <input type="checkbox" formControlName="projectsPrivateByDefault" />
              <span><strong>المشاريع الجديدة خاصة افتراضيًا</strong><span class="hint">لا يراها إلا أعضاؤها حتى يُغيَّر ذلك صراحةً.</span></span>
            </label>
            <label class="opt">
              <input type="checkbox" formControlName="allowSelfApproval" />
              <span><strong>السماح بالموافقة الذاتية</strong><span class="hint">استثناء من منع الموافقة على طلبك (FR-APR-06).</span></span>
            </label>
            @if (form.controls.allowSelfApproval.value) {
              <app-admin-notice tone="warning">تحذير: تفعيل الموافقة الذاتية يُضعف الفصل بين مقدِّم الطلب ومعتمِده. هذا استثناء يُسجَّل في سجل التدقيق، ولا يُنصح به إلا للضرورة.</app-admin-notice>
            }
          </div>
        </section>

        <section class="card" aria-labelledby="g-prog">
          <div class="card-body stack">
            <div><h2 id="g-prog">احتساب التقدم</h2><p class="muted">أنواع الأعمال التي يُحتسب منها تقدم المشروع (§4.4).</p></div>
            <fieldset class="types">
              <legend>الأنواع المحتسبة <app-help-tip [text]="progressHelp" /></legend>
              <div class="chk-list">
                @for (t of types(); track t.id) {
                  <label class="checkbox">
                    <input type="checkbox" [checked]="includedTypeIds().includes(t.id)" (change)="toggleType(t.id, $any($event.target).checked)" />
                    {{ t.name }}@if (!t.active) { <span class="muted"> (معطّل)</span> }
                  </label>
                } @empty {
                  <span class="muted">لا توجد أنواع.</span>
                }
              </div>
              <span class="hint">{{ includedTypeIds().length ? 'يُحتسب التقدم من الأنواع المحددة فقط.' : 'لم تُحدَّد أنواع: تُحتسب كل الأنواع (الافتراضي).' }}</span>
              @if (includedTypeIds().length) {
                <button type="button" class="btn btn--ghost btn--sm clear" (click)="includedTypeIds.set([])">احتساب كل الأنواع</button>
              }
              @if (serverErrors()['progressIncludedTypeIds']; as e) { <span class="error" role="alert">{{ e }}</span> }
            </fieldset>
            <div class="example" role="note" aria-label="مثال حي على معادلة التقدم">
              <strong>{{ example().scope }} <app-help-tip [text]="progressRuleHelp" /></strong>
              <span>{{ example().formula }}</span>
              <span class="hl">{{ example().example }}</span>
            </div>
          </div>
        </section>

        <section class="card" aria-labelledby="g-ops">
          <div class="card-body stack">
            <div><h2 id="g-ops">التشغيل</h2><p class="muted">المنطقة الزمنية ومدة الاحتفاظ بسجل التدقيق (NFR-10، NFR-13).</p></div>
            <div class="field narrow">
              <label for="s-tz">المنطقة الزمنية <app-help-tip [text]="timeZoneHint" /></label>
              <select id="s-tz" class="select" formControlName="timeZone">
                @for (z of zones(); track z.id) { <option [value]="z.id">{{ z.label }}</option> }
              </select>
              <span class="hint">{{ timeZoneHint }}</span>
              @if (serverErrors()['timeZone']; as e) { <span class="error" role="alert">{{ e }}</span> }
            </div>
            <div class="field narrow">
              <label for="s-ret">الاحتفاظ بسجل التدقيق (أيام)</label>
              <input id="s-ret" class="input ltr" type="number" min="365" formControlName="auditRetentionDays" [attr.aria-invalid]="invalid('auditRetentionDays')" />
              <span class="hint">365 يومًا كحد أدنى @if (retentionYears(); as y) { — يعادل نحو {{ y }} سنة }.</span>
              @if (invalid('auditRetentionDays')) { <span class="error" role="alert">{{ errorOf('auditRetentionDays', 'لا تقل المدة عن 365 يومًا.') }}</span> }
            </div>
          </div>
        </section>

        @if (dirty()) {
          <div class="savebar" role="region" aria-label="حفظ التغييرات">
            <span class="muted">لديك تغييرات غير محفوظة. ستُسجَّل في سجل التدقيق.</span>
            <span class="spacer"></span>
            <button type="button" class="btn btn--outline" [disabled]="saving()" (click)="reset()">تراجع</button>
            <button type="submit" class="btn btn--primary" [disabled]="saving()">{{ saving() ? 'جارٍ الحفظ…' : 'حفظ التغييرات' }}</button>
          </div>
        }
      </form>
    }
  `,
})
export class SettingsPage implements HasUnsavedChanges {
  protected readonly store = inject(SettingsStore);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly typeLookup = inject(WorkItemTypeLookup);

  protected readonly timeZoneHint = ADMIN_HELP.timeZone;
  protected readonly progressHelp = ADMIN_HELP.progressTypes;
  protected readonly progressRuleHelp = HELP.progressRule;
  protected readonly types = computed(() => [...this.typeLookup.items()].sort((a, b) => a.order - b.order));
  protected readonly includedTypeIds = signal<readonly string[]>([]);
  protected readonly example = computed(() =>
    progressExample(this.types().filter((t) => this.includedTypeIds().includes(t.id)).map((t) => t.name)),
  );

  protected readonly zones = computed(() => {
    const tz = this.store.value().timeZone;
    return TIME_ZONES.some((z) => z.id === tz) ? TIME_ZONES : [...TIME_ZONES, { id: tz, label: tz }];
  });

  protected readonly form = this.fb.group({
    sessionHours: this.fb.control(DEFAULT_SETTINGS.sessionHours, [Validators.required, Validators.min(1), Validators.max(24)]),
    commentEditHours: this.fb.control(DEFAULT_SETTINGS.commentEditHours, [Validators.required, Validators.min(0), Validators.max(168)]),
    attachmentMaxMb: this.fb.control(DEFAULT_SETTINGS.attachmentMaxMb, [Validators.required, Validators.min(1), Validators.max(100)]),
    auditRetentionDays: this.fb.control(DEFAULT_SETTINGS.auditRetentionDays, [Validators.required, Validators.min(365)]),
    allowCrossProjectRelations: this.fb.control(DEFAULT_SETTINGS.allowCrossProjectRelations),
    allowSelfApproval: this.fb.control(DEFAULT_SETTINGS.allowSelfApproval),
    projectsPrivateByDefault: this.fb.control(DEFAULT_SETTINGS.projectsPrivateByDefault),
    timeZone: this.fb.control(DEFAULT_SETTINGS.timeZone),
  });

  protected readonly extensions = signal<readonly string[]>(DEFAULT_SETTINGS.attachmentExtensions);
  protected readonly extDraft = signal('');
  protected readonly extError = signal('');
  protected readonly saving = signal(false);
  protected readonly serverErrors = signal<Readonly<Record<string, string>>>({});

  private readonly formValue = toSignal(this.form.valueChanges.pipe(startWith(null), map(() => this.form.getRawValue())), {
    initialValue: this.form.getRawValue(),
  });

  protected readonly dirty = computed(() => {
    const base = this.store.value();
    const v = this.formValue();
    const exts = this.extensions();
    return (
      (Object.keys(v) as (keyof typeof v)[]).some((k) => v[k] !== base[k]) ||
      !sameIds(this.includedTypeIds(), base.progressIncludedTypeIds ?? []) ||
      exts.length !== base.attachmentExtensions.length ||
      exts.some((e, i) => e !== base.attachmentExtensions[i])
    );
  });

  protected readonly retentionYears = computed(() => {
    const d = this.formValue().auditRetentionDays;
    return typeof d === 'number' && d > 0 ? (d / 365).toFixed(1).replace(/\.0$/, '') : '';
  });

  constructor() {
    // Load (or reload after a 409) the server record into the form.
    effect(() => {
      this.store.current();
      untracked(() => this.reset());
    });
  }

  hasUnsavedChanges(): boolean {
    return this.dirty();
  }

  protected onUnload(event: BeforeUnloadEvent): void {
    warnBeforeUnload(event, this.dirty());
  }

  protected toggleType(id: string, checked: boolean): void {
    this.includedTypeIds.update((ids) => (checked ? [...ids.filter((i) => i !== id), id] : ids.filter((i) => i !== id)));
  }

  protected invalid(key: NumberKey): boolean {
    const c = this.form.controls[key];
    return (c.invalid && c.touched) || !!this.serverErrors()[key];
  }

  protected errorOf(key: NumberKey, fallback: string): string {
    return this.serverErrors()[key] ?? fallback;
  }

  protected reset(): void {
    const s = this.store.value();
    this.form.reset({
      sessionHours: s.sessionHours,
      commentEditHours: s.commentEditHours,
      attachmentMaxMb: s.attachmentMaxMb,
      auditRetentionDays: s.auditRetentionDays,
      allowCrossProjectRelations: s.allowCrossProjectRelations,
      allowSelfApproval: s.allowSelfApproval,
      projectsPrivateByDefault: s.projectsPrivateByDefault,
      timeZone: s.timeZone,
    });
    this.extensions.set(s.attachmentExtensions);
    this.includedTypeIds.set(s.progressIncludedTypeIds ?? []);
    this.extDraft.set('');
    this.extError.set('');
    this.serverErrors.set({});
  }

  protected addExtension(): void {
    const ext = this.extDraft().trim().toLowerCase().replace(/^\./, '');
    if (!ext) return;
    if (!/^[a-z0-9]{1,10}$/.test(ext)) {
      this.extError.set('الامتداد أحرف إنجليزية وأرقام فقط، بدون نقطة (حتى 10 خانات).');
    } else if (BLOCKED_EXTENSIONS.includes(ext)) {
      this.extError.set(`الامتداد «${ext}» تنفيذي ومحظور لأسباب أمنية.`);
    } else if (this.extensions().includes(ext)) {
      this.extError.set('الامتداد مضاف مسبقًا.');
    } else {
      this.extensions.update((list) => [...list, ext]);
      this.extDraft.set('');
      this.extError.set('');
    }
  }

  protected removeExtension(ext: string): void {
    this.extensions.update((list) => list.filter((e) => e !== ext));
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const current = this.store.current();
    if (!current) return;
    const v = this.form.getRawValue();
    const changes: SettingsUpdate = {
      ...v,
      attachmentExtensions: this.extensions(),
      progressIncludedTypeIds: this.includedTypeIds(),
      version: current.version,
    };
    this.saving.set(true);
    this.serverErrors.set({});
    this.store.update(changes).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success('تم حفظ الإعدادات. التغييرات مسجَّلة في سجل التدقيق.');
      },
      error: (e: unknown) => {
        this.saving.set(false);
        if (!isApiError(e)) return;
        if (e.status === 409) {
          // Someone else saved first: the interceptor toasted the message; load the fresh record.
          this.store.reload();
          this.toast.info('أُعيد تحميل الإعدادات لأن نسخة أحدث حُفظت. راجع القيم ثم أعد المحاولة.');
        } else {
          this.serverErrors.set(e.details ?? {});
        }
      },
    });
  }
}
