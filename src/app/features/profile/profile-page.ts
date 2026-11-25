import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AuthService } from '@core/auth/auth.service';
import {
  DateFormatPreference,
  DensityPreference,
  LANDING_PAGES,
  NotifyEvent,
  PreferencesStore,
  ThemePreference,
} from '@core/preferences/preferences.store';
import { RoleLookup, UserLookup } from '@domain/users/user.api';
import { AppDatePipe } from '@shared/pipes/pipes';
import { PageHeader } from '@shared/ui/page-header/page-header';
import { TelegramLinkCard } from './telegram-link-card';

const NOTIFY_LABELS: readonly { readonly key: NotifyEvent; readonly label: string }[] = [
  { key: 'assignment', label: 'إسناد عنصر عمل إليّ' },
  { key: 'mention', label: 'الإشارة إليّ في تعليق' },
  { key: 'approvalRequest', label: 'طلب موافقة بانتظاري' },
  { key: 'decision', label: 'قرار على طلب أرسلته' },
  { key: 'comment', label: 'تعليق جديد على عنصر أتابعه' },
];

const THEMES: readonly { readonly value: ThemePreference; readonly label: string }[] = [
  { value: 'light', label: 'فاتح' },
  { value: 'dark', label: 'داكن' },
  { value: 'auto', label: 'تلقائي (حسب النظام)' },
];

@Component({
  selector: 'app-profile-page',
  imports: [PageHeader, AppDatePipe, TelegramLinkCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header title="الملف الشخصي" subtitle="بيانات حسابك وتفضيلات الواجهة." />

    <div class="grid cols">
      <section class="card card-body" aria-labelledby="acc-h">
        <h2 id="acc-h" class="section-title">بيانات الحساب</h2>
        @if (auth.user(); as user) {
          <dl class="kv">
            <dt>الاسم</dt><dd>{{ user.name }}</dd>
            <dt>البريد الإلكتروني</dt><dd class="ltr" dir="ltr">{{ user.email }}</dd>
            <dt>المسمى الوظيفي</dt><dd>{{ user.title || '—' }}</dd>
            <dt>الأدوار</dt><dd>{{ roles() || '—' }}</dd>
          </dl>
          <p class="muted hint">هذه البيانات للقراءة فقط؛ يعدّلها مدير النظام.</p>
        }
      </section>

      <section class="card card-body" aria-labelledby="sess-h">
        <h2 id="sess-h" class="section-title">الجلسة</h2>
        <dl class="kv">
          <dt>تنتهي في</dt><dd>{{ auth.session()?.expiresAt | appDate: true }}</dd>
        </dl>
        <button type="button" class="btn btn--danger" (click)="auth.logout()">إنهاء الجلسة</button>
      </section>

      <app-telegram-link-card />
    </div>

    <section id="preferences" class="card card-body prefs" aria-labelledby="pref-h">
      <h2 id="pref-h" class="section-title">تفضيلات الواجهة</h2>
      <p class="muted hint">تُحفظ هذه التفضيلات في هذا المتصفح فقط ولا تؤثر على الخادم.</p>

      <div class="form-grid">
        <div class="field">
          <label for="landing">صفحة البدء بعد الدخول</label>
          <select id="landing" class="select" (change)="setLanding($event)">
            @for (p of landingPages; track p.link) {
              <option [value]="p.link" [selected]="p.link === prefs().landingPage">{{ p.label }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label for="density">كثافة الجداول الافتراضية</label>
          <select id="density" class="select" (change)="setDensity($event)">
            <option value="comfortable" [selected]="prefs().tableDensity === 'comfortable'">مريحة</option>
            <option value="compact" [selected]="prefs().tableDensity === 'compact'">مضغوطة</option>
          </select>
        </div>
        <div class="field">
          <label for="datefmt">عرض التواريخ</label>
          <select id="datefmt" class="select" (change)="setDateFormat($event)" aria-describedby="datefmt-h">
            <option value="relative" [selected]="prefs().dateFormat === 'relative'">نسبي (قبل ساعتين)</option>
            <option value="absolute" [selected]="prefs().dateFormat === 'absolute'">مطلق (12 يناير 2026)</option>
          </select>
          <span id="datefmt-h" class="hint">تلميح لشاشات القوائم؛ بعض الشاشات تعرض التاريخ المطلق دائمًا.</span>
        </div>
        <fieldset class="field fs">
          <legend>المظهر</legend>
          <div class="seg">
            @for (t of themes; track t.value) {
              <label class="checkbox">
                <input type="radio" name="theme" [value]="t.value" [checked]="prefs().theme === t.value" (change)="prefsStore.update({ theme: t.value })" />
                {{ t.label }}
              </label>
            }
          </div>
        </fieldset>
      </div>

      <fieldset class="field fs">
        <legend>إشعارات الواجهة</legend>
        @for (n of notify; track n.key) {
          <label class="checkbox">
            <input type="checkbox" [checked]="prefs().notify[n.key]" (change)="toggleNotify(n.key, $event)" />
            {{ n.label }}
          </label>
        }
        <label class="checkbox">
          <input type="checkbox" [checked]="prefs().notifySound" (change)="toggleNotifySound($event)" />
          صوت عند وصول إشعار
        </label>
      </fieldset>

      <div class="actions">
        <button type="button" class="btn btn--outline" (click)="prefsStore.reset()">استعادة الافتراضي</button>
      </div>
    </section>
  `,
  styles: `
    .cols { grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: var(--s-4); margin-bottom: var(--s-4); }
    .kv { margin: 0 0 var(--s-3); }
    .hint { font-size: var(--fs-sm); margin-bottom: var(--s-3); }
    .prefs { display: flex; flex-direction: column; gap: var(--s-4); }
    .fs { border: 0; padding: 0; margin: 0; }
    .fs legend { font-size: var(--fs-sm); font-weight: 600; color: var(--c-text-2); padding: 0 0 var(--s-2); }
    .fs .checkbox { min-height: 32px; }
    .seg { display: flex; flex-wrap: wrap; gap: var(--s-4); }
    .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; }
    .kv dd { overflow-wrap: anywhere; }
    .form-grid { grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); }
    @media (pointer: coarse), (max-width: 768px) {
      .fs .checkbox { min-block-size: 44px; }
      .fs .checkbox input { inline-size: 20px; block-size: 20px; }
      .actions .btn, .cols .btn { min-block-size: 44px; }
    }
    @media (max-width: 480px) { .actions .btn { inline-size: 100%; } }
  `,
})
export class ProfilePage {
  protected readonly auth = inject(AuthService);
  protected readonly prefsStore = inject(PreferencesStore);
  private readonly users = inject(UserLookup);
  private readonly roleLookup = inject(RoleLookup);

  protected readonly prefs = this.prefsStore.prefs;
  protected readonly landingPages = LANDING_PAGES;
  protected readonly themes = THEMES;
  protected readonly notify = NOTIFY_LABELS;

  protected readonly roles = computed(() => {
    const me = this.users.get(this.auth.user()?.id);
    return (me?.systemRoleIds ?? [])
      .map((id) => this.roleLookup.get(id)?.name)
      .filter((n): n is string => !!n)
      .join('، ');
  });

  protected setLanding(e: Event): void {
    this.prefsStore.update({ landingPage: (e.target as HTMLSelectElement).value });
  }

  protected setDensity(e: Event): void {
    this.prefsStore.update({ tableDensity: (e.target as HTMLSelectElement).value as DensityPreference });
  }

  protected setDateFormat(e: Event): void {
    this.prefsStore.update({ dateFormat: (e.target as HTMLSelectElement).value as DateFormatPreference });
  }

  protected toggleNotify(key: NotifyEvent, e: Event): void {
    this.prefsStore.setNotify(key, (e.target as HTMLInputElement).checked);
  }

  protected toggleNotifySound(e: Event): void {
    this.prefsStore.setNotifySound((e.target as HTMLInputElement).checked);
  }
}
