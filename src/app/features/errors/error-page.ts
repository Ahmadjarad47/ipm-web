import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EmptyState } from '@shared/ui/empty-state/empty-state';

@Component({
  selector: 'app-forbidden-page',
  imports: [EmptyState, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card">
      <app-empty-state icon="lock" title="لا تملك صلاحية الوصول" text="هذه الصفحة تتطلب صلاحية غير ممنوحة لحسابك. تواصل مع مدير النظام إن كنت تحتاجها.">
        <a class="btn btn--primary" routerLink="/dashboard">العودة للوحة القيادة</a>
      </app-empty-state>
    </div>
  `,
})
export class ForbiddenPage {}

@Component({
  selector: 'app-not-found-page',
  imports: [EmptyState, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card">
      <app-empty-state icon="search" title="الصفحة غير موجودة" text="الرابط غير صحيح أو أن العنصر لم يعد متاحًا لك.">
        <a class="btn btn--primary" routerLink="/dashboard">العودة للوحة القيادة</a>
      </app-empty-state>
    </div>
  `,
})
export class NotFoundPage {}

@Component({
  selector: 'app-server-error-page',
  imports: [EmptyState, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card">
      <app-empty-state icon="alert" title="حدث خطأ في الخادم" text="تعذّر إكمال طلبك الآن. جرّب مرة أخرى بعد قليل، وإن استمرت المشكلة تواصل مع مدير النظام.">
        <button type="button" class="btn btn--primary" (click)="retry()">إعادة المحاولة</button>
        <a class="btn btn--outline" routerLink="/dashboard">العودة للوحة القيادة</a>
      </app-empty-state>
    </div>
  `,
})
export class ServerErrorPage {
  protected retry(): void {
    window.location.assign('/');
  }
}

@Component({
  selector: 'app-offline-page',
  imports: [EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:online)': 'retry()' },
  template: `
    <div class="card">
      <app-empty-state icon="alert" title="لا يوجد اتصال بالإنترنت" text="تعذّر تحميل الصفحة لأنك غير متصل. ستُعاد المحاولة تلقائيًا عند عودة الاتصال.">
        <button type="button" class="btn btn--primary" (click)="retry()">إعادة المحاولة</button>
      </app-empty-state>
    </div>
  `,
})
export class OfflinePage {
  protected retry(): void {
    if (navigator.onLine) window.location.assign('/');
  }
}
