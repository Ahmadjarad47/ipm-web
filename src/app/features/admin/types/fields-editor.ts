import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormRecord, ReactiveFormsModule } from '@angular/forms';
import { NonNullableFormBuilder } from '@angular/forms';
import { map, startWith, switchMap } from 'rxjs';
import { ConfirmService } from '@shared/ui/dialog/confirm-dialog';
import { DynamicFields, syncDynamicControls } from '@shared/ui/dynamic-field/dynamic-fields';
import { HelpTip } from '@shared/ui/help-tip/help-tip';
import { Icon } from '@shared/ui/icon/icon';
import { FieldDefinition, FieldValue } from '@domain/work-items/work-item.models';
import { ADMIN_HELP } from '../shared/admin-help';
import { moveControl } from '../shared/reorder';
import {
  createFieldForm,
  createOptionForm,
  duplicateKeyIndexes,
  FIELD_TYPE_LABELS,
  FIELD_TYPES,
  FieldForm,
  FieldServerErrors,
  KEY_PATTERN,
  toFieldDefinition,
} from './type-form.models';

/** Repeatable editor for the extra fields of a work item type (FR-TYP-06) with display config and a live preview. */
@Component({
  selector: 'app-fields-editor',
  imports: [ReactiveFormsModule, Icon, DynamicFields, HelpTip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './fields-editor.scss',
  template: `
    <section class="fe" aria-labelledby="fe-title">
      <div class="row">
        <strong id="fe-title">الحقول الإضافية</strong>
        <span class="spacer"></span>
        <button type="button" class="btn btn--outline btn--sm" (click)="add()"><app-icon name="plus" [size]="14" /> حقل جديد</button>
      </div>
      @if (!array().length) {
        <p class="muted">لا توجد حقول إضافية لهذا النوع.</p>
      } @else {
        <p class="muted">يُحفظ ترتيب الحقول كما يظهر هنا. اسحب المقبض أو استخدم السهمين (أو مفتاحي ↑ ↓ على المقبض) لإعادة الترتيب.</p>
      }
      @if (array().errors?.['duplicateKey']; as dup) {
        <p class="error" role="alert">المفتاح «{{ dup }}» مكرر؛ مفاتيح الحقول يجب أن تكون فريدة.</p>
      }

      @for (row of array().controls; track row; let i = $index) {
        <div class="frow" [formGroup]="row" [class.over]="overIndex === i" (dragover)="onDragOver($event, i)" (drop)="onDrop($event, i)"
          (dragend)="onDragEnd()" [attr.draggable]="armed === i ? 'true' : null" (dragstart)="onDragStart($event, i)">
          <div class="frow-head">
            <button type="button" class="btn btn--ghost btn--sm btn--icon grip" [id]="'fdrag-' + i"
              [attr.aria-label]="'ترتيب الحقل ' + (i + 1) + ': استخدم مفتاحي السهم للأعلى وللأسفل'"
              (mousedown)="armed = i" (mouseup)="armed = null" (keydown.arrowup)="key($event, i, -1)" (keydown.arrowdown)="key($event, i, 1)">⠿</button>
            <span class="num">{{ i + 1 }}</span>
            <span class="spacer"></span>
            <button type="button" class="btn btn--ghost btn--sm btn--icon" [disabled]="i === 0" (click)="move(i, -1)" aria-label="تحريك للأعلى">▲</button>
            <button type="button" class="btn btn--ghost btn--sm btn--icon" [disabled]="i === array().length - 1" (click)="move(i, 1)" aria-label="تحريك للأسفل">▼</button>
            <button type="button" class="btn btn--ghost btn--sm btn--icon" (click)="remove(i)" aria-label="حذف الحقل"><app-icon name="trash" [size]="15" /></button>
          </div>
          <div class="form-grid">
            <div class="field">
              <label [for]="'fk-' + i">المفتاح <span class="req">*</span></label>
              <input class="input ltr" [id]="'fk-' + i" formControlName="key" placeholder="story_points"
                [attr.aria-invalid]="keyError(i) ? 'true' : null" [attr.aria-describedby]="keyError(i) ? 'fk-err-' + i : null" />
              @if (keyError(i); as msg) {
                <span class="error" [id]="'fk-err-' + i" role="alert">{{ msg }}</span>
              }
            </div>
            <div class="field">
              <label [for]="'fl-' + i">العنوان <span class="req">*</span></label>
              <input class="input" [id]="'fl-' + i" formControlName="label" [attr.aria-invalid]="srv(i, 'label') ? 'true' : null" />
              @if (srv(i, 'label'); as msg) {
                <span class="error" role="alert">{{ msg }}</span>
              }
            </div>
            <div class="field">
              <label [for]="'ft-' + i">النوع</label>
              <select class="select" [id]="'ft-' + i" formControlName="type">
                @for (t of fieldTypes; track t) {
                  <option [value]="t">{{ typeLabels[t] }}</option>
                }
              </select>
              @if (srv(i, 'type'); as msg) {
                <span class="error" role="alert">{{ msg }}</span>
              }
            </div>
            <div class="field">
              <label [for]="'fh-' + i">تلميح</label>
              <input class="input" [id]="'fh-' + i" formControlName="hint" />
            </div>
            @if (row.controls.type.value === 'number') {
              <div class="field">
                <label [for]="'fmin-' + i">الحد الأدنى</label>
                <input class="input" type="number" [id]="'fmin-' + i" formControlName="min" [attr.aria-invalid]="row.errors?.['minMax'] || srv(i, 'min') ? 'true' : null" />
                @if (srv(i, 'min'); as msg) {
                  <span class="error" role="alert">{{ msg }}</span>
                }
              </div>
              <div class="field">
                <label [for]="'fmax-' + i">الحد الأعلى</label>
                <input class="input" type="number" [id]="'fmax-' + i" formControlName="max" [attr.aria-invalid]="row.errors?.['minMax'] || srv(i, 'max') ? 'true' : null" />
                @if (srv(i, 'max'); as msg) {
                  <span class="error" role="alert">{{ msg }}</span>
                }
              </div>
              @if (row.errors?.['minMax']) {
                <p class="error span-2" role="alert">الحد الأدنى يجب ألا يتجاوز الحد الأعلى.</p>
              }
            }
            <div class="span-2 flags">
              @if (row.controls.type.value !== 'boolean') {
                <label class="checkbox"><input type="checkbox" formControlName="required" /> حقل إلزامي</label>
              }
              <label class="checkbox"><input type="checkbox" formControlName="showInList" /> إظهار في القائمة</label>
              <label class="checkbox"><input type="checkbox" formControlName="showOnCard" /> إظهار على البطاقة</label>
              <app-help-tip [text]="displayHelp" />
            </div>
          </div>

          @if (row.controls.type.value === 'select') {
            <div class="options" formArrayName="options">
              <div class="row">
                <strong>الخيارات</strong>
                <span class="spacer"></span>
                <button type="button" class="btn btn--outline btn--sm" (click)="addOption(row)">+ خيار</button>
              </div>
              @for (opt of row.controls.options.controls; track opt; let j = $index) {
                <div class="opt" [formGroupName]="j">
                  <input class="input ltr" formControlName="value" placeholder="value" aria-label="قيمة الخيار" />
                  <input class="input" formControlName="label" placeholder="العنوان" aria-label="عنوان الخيار" />
                  <button type="button" class="btn btn--ghost btn--sm btn--icon" (click)="row.controls.options.removeAt(j)" aria-label="حذف الخيار"><app-icon name="close" [size]="14" /></button>
                </div>
              }
              @if (row.errors?.['noOptions']) {
                <span class="error" role="alert">حقل القائمة يحتاج خيارًا واحدًا على الأقل.</span>
              }
              @if (row.errors?.['dupOption']; as dupOpt) {
                <span class="error" role="alert">قيمة الخيار «{{ dupOpt }}» مكررة.</span>
              }
              @if (srv(i, 'options'); as msg) {
                <span class="error" role="alert">{{ msg }}</span>
              }
            </div>
          }
        </div>
      }

      @if (definitions().length) {
        <div class="preview">
          <strong>معاينة مباشرة</strong>
          <app-dynamic-fields [definitions]="definitions()" [group]="previewGroup" />
        </div>
      }
    </section>
  `,
})
export class FieldsEditor {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly confirm = inject(ConfirmService);

  readonly array = input.required<FormArray<FieldForm>>();
  /** Server 400 messages by row index (`fields[i].key` -> row i). */
  readonly serverErrors = input<FieldServerErrors>(new Map());

  protected readonly fieldTypes = FIELD_TYPES;
  protected readonly typeLabels = FIELD_TYPE_LABELS;
  protected readonly displayHelp = ADMIN_HELP.fieldDisplay;
  protected readonly previewGroup = new FormRecord<FormControl<FieldValue>>({});

  /** Drag state (HTML5 drag and drop, armed only from the handle). */
  protected armed: number | null = null;
  protected overIndex: number | null = null;
  private dragFrom: number | null = null;

  /** Only complete, valid and unique rows reach the preview. */
  protected readonly definitions = toSignal(
    toObservable(this.array).pipe(
      switchMap((a) => a.valueChanges.pipe(startWith(null), map(() => this.validDefinitions(a)))),
    ),
    { initialValue: [] as readonly FieldDefinition[] },
  );

  constructor() {
    effect(() => syncDynamicControls(this.previewGroup, this.definitions()));
  }

  protected srv(index: number, prop: string): string | undefined {
    return this.serverErrors().get(index)?.[prop];
  }

  /** Server message first, then duplicate key, then the pattern error. */
  protected keyError(index: number): string | null {
    const server = this.srv(index, 'key');
    if (server) return server;
    const row = this.array().at(index);
    const key = row.controls.key.value;
    if (key && duplicateKeyIndexes(this.array().controls.map((c) => c.controls.key.value)).has(index)) {
      return `المفتاح «${key}» مكرر في حقل آخر.`;
    }
    return row.controls.key.touched && row.controls.key.invalid ? 'حروف إنجليزية صغيرة وأرقام و_، تبدأ بحرف (2-31).' : null;
  }

  protected add(): void {
    this.array().push(createFieldForm(this.fb));
  }

  protected remove(index: number): void {
    const row = this.array().at(index);
    const label = row.controls.label.value.trim() || row.controls.key.value.trim();
    this.confirm
      .confirm({
        title: 'حذف الحقل',
        message: label ? `سيتم حذف الحقل «${label}» من النوع. هل تريد المتابعة؟` : 'سيتم حذف الحقل من النوع. هل تريد المتابعة؟',
        confirmText: 'حذف',
        danger: true,
      })
      .subscribe((ok) => {
        if (ok) this.array().removeAt(index);
      });
  }

  protected move(index: number, delta: number): void {
    moveControl(this.array(), index, index + delta);
  }

  protected key(event: Event, index: number, delta: number): void {
    event.preventDefault();
    const target = index + delta;
    if (target < 0 || target >= this.array().length) return;
    this.move(index, delta);
    // Moving the node can drop focus; put it back on the same row's handle.
    setTimeout(() => document.getElementById(`fdrag-${target}`)?.focus());
  }

  protected onDragStart(event: DragEvent, index: number): void {
    this.dragFrom = index;
    event.dataTransfer?.setData('text/plain', String(index));
  }

  protected onDragOver(event: DragEvent, index: number): void {
    if (this.dragFrom === null) return;
    event.preventDefault();
    this.overIndex = index;
  }

  protected onDrop(event: DragEvent, index: number): void {
    event.preventDefault();
    if (this.dragFrom !== null) moveControl(this.array(), this.dragFrom, index);
    this.onDragEnd();
  }

  protected onDragEnd(): void {
    this.dragFrom = null;
    this.overIndex = null;
    this.armed = null;
  }

  protected addOption(row: FieldForm): void {
    row.controls.options.push(createOptionForm(this.fb));
  }

  private validDefinitions(array: FormArray<FieldForm>): readonly FieldDefinition[] {
    const seen = new Set<string>();
    const result: FieldDefinition[] = [];
    for (const row of array.controls) {
      const def = toFieldDefinition(row);
      if (!KEY_PATTERN.test(def.key) || !def.label || seen.has(def.key)) continue;
      seen.add(def.key);
      result.push(def);
    }
    return result;
  }
}
