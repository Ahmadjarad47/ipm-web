import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import { FormControl, FormRecord, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { UserLookup } from '@domain/users/user.api';
import { FieldDefinition, FieldValue } from '@domain/work-items/work-item.models';

export type DynamicFieldsGroup = FormRecord<FormControl<FieldValue>>;

/** Builds validators from an admin-defined field (FR-TYP-06). */
function validatorsFor(def: FieldDefinition): ValidatorFn[] {
  const v: ValidatorFn[] = [];
  if (def.required) v.push(Validators.required);
  if (def.min !== undefined) v.push(Validators.min(def.min));
  if (def.max !== undefined) v.push(Validators.max(def.max));
  return v;
}

/**
 * Syncs `group` with `definitions`: adds missing controls, removes stale ones, keeps values that still apply.
 * Call it whenever the selected work item type changes.
 */
export function syncDynamicControls(
  group: DynamicFieldsGroup,
  definitions: readonly FieldDefinition[],
  values: Readonly<Record<string, FieldValue>> = {},
): void {
  const keys = new Set(definitions.map((d) => d.key));
  for (const name of Object.keys(group.controls)) if (!keys.has(name)) group.removeControl(name);
  for (const def of definitions) {
    const initial = values[def.key] ?? group.controls[def.key]?.value ?? (def.type === 'boolean' ? false : null);
    if (group.controls[def.key]) group.removeControl(def.key);
    // Booleans are optional checkboxes; "required" is not meaningful for them in this UI.
    const validators = def.type === 'boolean' ? [] : validatorsFor(def);
    group.addControl(def.key, new FormControl<FieldValue>(initial, { validators }));
  }
}

/**
 * Renders the extra fields of a work item type with no field hard-coded in Angular (FR-TYP-11).
 *   <app-dynamic-fields [definitions]="type.fields" [group]="form.controls.fields" />
 */
@Component({
  selector: 'app-dynamic-fields',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="form-grid" [formGroup]="group()">
      @for (def of definitions(); track def.key) {
        <div class="field" [class.span-2]="def.type === 'text' && !def.options">
          @if (def.type !== 'boolean') {
            <label [for]="'df-' + def.key">{{ def.label }} @if (def.required) {<span class="req">*</span>}</label>
          }
          @switch (def.type) {
            @case ('number') {
              <input class="input" type="number" [id]="'df-' + def.key" [formControlName]="def.key" [attr.min]="def.min ?? null" [attr.max]="def.max ?? null" />
            }
            @case ('date') {
              <input class="input" type="date" [id]="'df-' + def.key" [formControlName]="def.key" />
            }
            @case ('boolean') {
              <label class="checkbox"><input type="checkbox" [formControlName]="def.key" /> {{ def.label }}</label>
            }
            @case ('select') {
              <select class="select" [id]="'df-' + def.key" [formControlName]="def.key">
                <option [ngValue]="null">— اختر —</option>
                @for (o of def.options ?? []; track o.value) {
                  <option [ngValue]="o.value">{{ o.label }}</option>
                }
              </select>
            }
            @case ('user') {
              <select class="select" [id]="'df-' + def.key" [formControlName]="def.key">
                <option [ngValue]="null">— اختر مستخدمًا —</option>
                @for (u of users.items(); track u.id) {
                  @if (u.active) {
                    <option [ngValue]="u.id">{{ u.name }}</option>
                  }
                }
              </select>
            }
            @default {
              <input class="input" type="text" [id]="'df-' + def.key" [formControlName]="def.key" />
            }
          }
          @if (def.hint) {
            <span class="hint">{{ def.hint }}</span>
          }
          @if (group().controls[def.key]?.invalid && group().controls[def.key]?.touched) {
            <span class="error">{{ errorText(def) }}</span>
          }
        </div>
      }
    </div>
  `,
})
export class DynamicFields {
  protected readonly users = inject(UserLookup);
  readonly definitions = input.required<readonly FieldDefinition[]>();
  readonly group = input.required<DynamicFieldsGroup>();
  /** Server-side field errors (from ApiError.details) shown on the matching control. */
  readonly serverErrors = input<Readonly<Record<string, string>> | undefined>(undefined);

  constructor() {
    effect(() => {
      const errors = this.serverErrors() ?? {};
      for (const [key, message] of Object.entries(errors)) {
        const control = this.group().controls[key];
        control?.setErrors({ server: message });
        control?.markAsTouched();
      }
    });
  }

  protected errorText(def: FieldDefinition): string {
    const errors = this.group().controls[def.key]?.errors ?? {};
    if (errors['server']) return String(errors['server']);
    if (errors['required']) return `${def.label} مطلوب`;
    if (errors['min']) return `الحد الأدنى ${def.min}`;
    if (errors['max']) return `الحد الأعلى ${def.max}`;
    return 'قيمة غير صالحة';
  }
}
