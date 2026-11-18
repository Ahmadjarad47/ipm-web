import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { FormsModule } from '@angular/forms';
import { filter, switchMap } from 'rxjs';
import { ConfirmService } from '@shared/ui/dialog/confirm-dialog';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { DIALOG_DATA, DialogRef, DialogService } from '@shared/ui/dialog/dialog.service';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { SettingsStore } from '@domain/settings/settings.api';
import { ProjectLookup } from '@domain/projects/project.api';
import { UserLookup } from '@domain/users/user.api';
import { AuthService } from '@core/auth/auth.service';
import { CommentsApi } from '@domain/activity/activity.api';
import { Comment } from '@domain/activity/activity.models';
import { AppDatePipe, RelativeTimePipe, UserNamePipe } from '@shared/pipes/pipes';
import { Avatar } from '@shared/ui/avatar/avatar';
import { EmptyState } from '@shared/ui/empty-state/empty-state';


/** Comments for any subject (FR-COL-01/02/06/07). `@username` mentions notify that user. */
@Component({
  selector: 'app-comments-panel',
  imports: [FormsModule, Avatar, EmptyState, RelativeTimePipe, UserNamePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="comments">
      @for (c of comments.value(); track c.id) {
        <li>
          <app-avatar [name]="c.authorId | userName" [size]="32" />
          <div class="bubble">
            <header>
              <strong>{{ c.authorId | userName }}</strong>
              <small class="muted">{{ c.createdAt | relativeTime }}</small>
              @if (c.edited) {
                <button type="button" class="edited" aria-haspopup="dialog" (click)="showRevisions(c)">معدّل</button>
              }
              <span class="spacer"></span>
              @if (!c.deleted && canEdit(c)) {
                <button type="button" class="btn btn--ghost btn--sm" (click)="startEdit(c)">تعديل</button>
              }
              @if (!c.deleted && c.authorId === me()) {
                <button type="button" class="btn btn--ghost btn--sm" (click)="remove(c)">حذف</button>
              }
            </header>
            @if (c.deleted) {
              <p class="muted deleted">حُذف هذا التعليق.</p>
            } @else if (editingId() === c.id) {
              <textarea class="textarea" [(ngModel)]="editText" aria-label="تعديل التعليق"></textarea>
              <div class="row end">
                <button type="button" class="btn btn--outline btn--sm" (click)="editingId.set(null)">إلغاء</button>
                <button type="button" class="btn btn--primary btn--sm" [disabled]="!editText.trim()" (click)="saveEdit(c)">حفظ</button>
              </div>
            } @else {
              <p class="body">{{ c.body }}</p>
            }
          </div>
        </li>
      } @empty {
        @if (!comments.isLoading()) {
          <app-empty-state icon="comment" title="لا توجد تعليقات بعد" />
        }
      }
    </ol>

    @if (canComment()) {
      <form class="composer" (ngSubmit)="add()">
        <div class="mention-wrap">
          <textarea #composer class="textarea" name="body" [(ngModel)]="draft" placeholder="اكتب تعليقًا… اكتب @ للإشارة إلى عضو" aria-label="تعليق جديد"
            (input)="onComposerInput(composer)" (keydown)="onComposerKey($event, composer)" (blur)="closeMentions()"
            role="combobox" aria-autocomplete="list" [attr.aria-expanded]="mentionOptions().length > 0" aria-controls="mention-list"></textarea>
          @if (mentionOptions().length) {
            <ul id="mention-list" class="mentions" role="listbox" aria-label="أعضاء المشروع">
              @for (u of mentionOptions(); track u.id; let i = $index) {
                <li role="option" [attr.aria-selected]="i === mentionIndex()" [class.active]="i === mentionIndex()"
                  (mousedown)="$event.preventDefault(); pickMention(u.username, composer)">
                  <app-avatar [name]="u.name" [size]="22" /> {{ u.name }} <span class="ltr muted">&#64;{{ u.username }}</span>
                </li>
              }
            </ul>
          }
        </div>
        <div class="row end">
          <button type="submit" class="btn btn--primary" [disabled]="!draft.trim() || posting()">إضافة تعليق</button>
        </div>
      </form>
    }
  `,
  styles: `
    .comments { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-4); }
    li { display: flex; gap: var(--s-3); }
    .bubble { flex: 1; min-width: 0; padding: var(--s-3) var(--s-4); border-radius: var(--r-md); background: var(--c-surface-2); border: 1px solid var(--c-border); }
    header { display: flex; align-items: center; gap: var(--s-2); margin-bottom: 4px; flex-wrap: wrap; }
    .body { white-space: pre-wrap; }
    .edited { padding: 0 var(--s-2); min-height: 24px; border: 0; background: transparent; color: var(--c-emerald-700); font-size: var(--fs-xs); text-decoration: underline; cursor: pointer; }
    .edited:focus-visible { outline: 2px solid var(--c-emerald-600); outline-offset: 1px; }
    .deleted { font-style: italic; }
    .composer { margin-top: var(--s-4); display: grid; gap: var(--s-2); }
    .end { justify-content: flex-end; }
    .bubble .textarea { margin-bottom: var(--s-2); }
    .mention-wrap { position: relative; }
    .mentions { position: absolute; inset-inline-start: 0; top: 100%; z-index: 5; margin: 4px 0 0; padding: 4px; list-style: none; min-width: 240px; background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--r-md); box-shadow: var(--shadow-md); }
    .mentions li { display: flex; align-items: center; gap: var(--s-2); padding: 6px var(--s-2); border-radius: var(--r-sm); cursor: pointer; font-size: var(--fs-sm); }
    .mentions li.active { background: var(--c-emerald-50); }
  `,
})
export class CommentsPanel {
  private readonly api = inject(CommentsApi);
  private readonly auth = inject(AuthService);
  private readonly confirm = inject(ConfirmService);
  private readonly settings = inject(SettingsStore);
  private readonly dialog = inject(DialogService);

  readonly subjectType = input.required<Comment['subjectType']>();
  readonly subjectId = input.required<string>();
  readonly projectId = input.required<string>();

  protected readonly me = computed(() => this.auth.user()?.id);
  protected readonly canComment = computed(() => this.auth.can('comments.create', this.projectId()));
  protected readonly comments = rxResource({
    params: () => ({ type: this.subjectType(), id: this.subjectId() }),
    stream: ({ params }) => this.api.forSubject(params.type, params.id),
    defaultValue: [],
  });

  protected draft = '';
  protected editText = '';
  protected readonly posting = signal(false);
  protected readonly editingId = signal<string | null>(null);

  // ---------- @mentions (FR-COL-07): suggest only project members, who can see the resource ----------

  private readonly projects = inject(ProjectLookup);
  private readonly users = inject(UserLookup);
  private readonly mentionQuery = signal<string | null>(null);
  protected readonly mentionIndex = signal(0);

  protected readonly mentionOptions = computed(() => {
    const q = this.mentionQuery();
    if (q === null) return [];
    const memberIds = new Set(this.projects.get(this.projectId())?.members.map((m) => m.userId) ?? []);
    return this.users
      .items()
      .filter((u) => u.active && memberIds.has(u.id) && u.id !== this.me())
      .filter((u) => !q || u.username.includes(q.toLowerCase()) || u.name.includes(q))
      .slice(0, 6);
  });

  protected onComposerInput(el: HTMLTextAreaElement): void {
    const before = el.value.slice(0, el.selectionStart ?? el.value.length);
    const match = /(?:^|\s)@([\p{L}\w.-]*)$/u.exec(before);
    this.mentionQuery.set(match ? match[1] : null);
    this.mentionIndex.set(0);
  }

  protected onComposerKey(event: KeyboardEvent, el: HTMLTextAreaElement): void {
    const options = this.mentionOptions();
    if (!options.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      this.mentionIndex.set((this.mentionIndex() + delta + options.length) % options.length);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      this.pickMention(options[this.mentionIndex()].username, el);
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      this.closeMentions();
    }
  }

  protected pickMention(username: string, el: HTMLTextAreaElement): void {
    const caret = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, caret).replace(/@([\p{L}\w.-]*)$/u, `@${username} `);
    this.draft = before + el.value.slice(caret);
    el.value = this.draft;
    el.setSelectionRange(before.length, before.length);
    el.focus();
    this.closeMentions();
  }

  protected closeMentions(): void {
    this.mentionQuery.set(null);
  }

  protected canEdit(c: Comment): boolean {
    return c.authorId === this.me() && this.auth.can('comments.edit_own', this.projectId()) && Date.now() - new Date(c.createdAt).getTime() < this.settings.value().commentEditHours * 3_600_000;
  }

  protected add(): void {
    const body = this.draft.trim();
    if (!body) return;
    this.posting.set(true);
    this.api.create({ subjectType: this.subjectType(), subjectId: this.subjectId(), body }).subscribe({
      next: () => {
        this.draft = '';
        this.posting.set(false);
        this.comments.reload();
      },
      error: () => this.posting.set(false),
    });
  }

  /** FR-COL-02: edit history, newest first (the oldest revision is the original text). */
  protected showRevisions(c: Comment): void {
    this.dialog.open<CommentRevisionsDialog, { commentId: string }>(CommentRevisionsDialog, { data: { commentId: c.id }, width: 'min(560px, calc(100vw - 32px))' });
  }

  protected startEdit(c: Comment): void {
    this.editText = c.body;
    this.editingId.set(c.id);
  }

  protected saveEdit(c: Comment): void {
    this.api.update(c.id, { body: this.editText.trim(), version: c.version }).subscribe(() => {
      this.editingId.set(null);
      this.comments.reload();
    });
  }

  protected remove(c: Comment): void {
    this.confirm
      .confirm({ title: 'حذف التعليق', message: 'سيُخفى نص التعليق ويبقى أثره في السجل. هل تريد المتابعة؟', confirmText: 'حذف', danger: true })
      .pipe(filter(Boolean), switchMap(() => this.api.remove(c.id)))
      .subscribe({ next: () => this.comments.reload(), error: () => this.comments.reload() });
  }
}

/** Edit history of one comment (FR-COL-02), newest first. */
@Component({
  selector: 'app-comment-revisions-dialog',
  imports: [DialogShell, ErrorState, Skeleton, AppDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell title="سجل التعديلات">
      @if (revisions.error()) {
        <app-error-state title="تعذّر تحميل السجل" (retry)="revisions.reload()" />
      } @else if (revisions.isLoading()) {
        <app-skeleton variant="lines" [count]="4" />
      } @else {
        <ol class="revs">
          @for (r of ordered(); track r.editedAt) {
            <li>
              <small class="muted">{{ r.editedAt | appDate: true }}@if ($last) { · النص الأصلي }</small>
              <p>{{ r.body }}</p>
            </li>
          } @empty {
            <li class="muted">لا توجد تعديلات مسجّلة.</li>
          }
        </ol>
      }
      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">إغلاق</button>
      </ng-container>
    </app-dialog-shell>
  `,
  styles: `
    .revs { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); max-height: 50vh; overflow: auto; }
    .revs li { padding: var(--s-3); border: 1px solid var(--c-border); border-radius: var(--r-md); background: var(--c-surface-2); }
    .revs p { margin: var(--s-1) 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  `,
})
export class CommentRevisionsDialog {
  private readonly api = inject(CommentsApi);
  private readonly data = inject(DIALOG_DATA) as { commentId: string };
  protected readonly ref = inject(DialogRef);

  protected readonly revisions = rxResource({ params: () => this.data.commentId, stream: ({ params }) => this.api.revisions(params) });
  protected readonly ordered = computed(() =>
    this.revisions.hasValue() ? [...this.revisions.value()].sort((a, b) => b.editedAt.localeCompare(a.editedAt)) : [],
  );
}
