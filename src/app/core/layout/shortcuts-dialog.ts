import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';

interface ShortcutGroup {
  readonly title: string;
  readonly items: readonly { readonly keys: readonly string[]; readonly label: string }[];
}

@Component({
  selector: 'app-shortcuts-dialog',
  imports: [DialogShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell title="اختصارات لوحة المفاتيح" subtitle="لا تعمل الاختصارات أثناء الكتابة في الحقول.">
      @for (g of groups; track g.title) {
        <section class="grp">
          <h3>{{ g.title }}</h3>
          <dl>
            @for (i of g.items; track i.label) {
              <div class="row-k">
                <dt>{{ i.label }}</dt>
                <dd>
                  @for (k of i.keys; track $index) {
                    <kbd>{{ k }}</kbd>
                    @if (!$last) { <span class="then" aria-hidden="true">ثم</span> }
                  }
                </dd>
              </div>
            }
          </dl>
        </section>
      }
    </app-dialog-shell>
  `,
  styles: `
    .grp { margin-bottom: var(--s-4); }
    h3 { font-size: var(--fs-md); color: var(--c-gold-600); margin-bottom: var(--s-2); }
    dl { margin: 0; }
    .row-k { display: flex; justify-content: space-between; align-items: center; gap: var(--s-3); padding: var(--s-2) 0; border-bottom: 1px solid var(--c-border); }
    dt { color: var(--c-text-2); }
    dd { margin: 0; display: flex; align-items: center; gap: 6px; }
    .then { color: var(--c-muted); font-size: var(--fs-xs); }
    kbd { min-width: 24px; padding: 1px 6px; border: 1px solid var(--c-border-strong); border-bottom-width: 2px; border-radius: 4px; background: var(--c-surface-2); font-family: inherit; font-size: var(--fs-xs); text-align: center; direction: ltr; }
  `,
})
export class ShortcutsDialog {
  protected readonly groups: readonly ShortcutGroup[] = [
    {
      title: 'عام',
      items: [
        { keys: ['Ctrl', 'K'], label: 'البحث الشامل' },
        { keys: ['/'], label: 'البحث الشامل (خارج الحقول)' },
        { keys: ['?'], label: 'عرض هذه القائمة' },
        { keys: ['Esc'], label: 'إغلاق النافذة أو القائمة' },
      ],
    },
    {
      title: 'التنقل',
      items: [
        { keys: ['g', 'd'], label: 'لوحة القيادة' },
        { keys: ['g', 'p'], label: 'المشاريع' },
        { keys: ['g', 'w'], label: 'عناصر العمل' },
        { keys: ['g', 'a'], label: 'مركز الموافقات' },
      ],
    },
    {
      title: 'إجراءات',
      items: [{ keys: ['c'], label: 'إنشاء عنصر عمل' }],
    },
  ];
}
