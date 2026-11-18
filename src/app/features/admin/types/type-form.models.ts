import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { FieldDefinition, FieldType, IconName } from '@domain/work-items/work-item.models';

/** Immutable key format shared by work item types and their fields (FR-TYP-02). */
export const KEY_PATTERN = /^[a-z][a-z0-9_]{1,30}$/;

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'نص',
  number: 'رقم',
  date: 'تاريخ',
  boolean: 'نعم / لا',
  select: 'قائمة اختيار',
  user: 'مستخدم',
};

export const FIELD_TYPES = Object.keys(FIELD_TYPE_LABELS) as readonly FieldType[];

export const ICON_LABELS: Record<IconName, string> = {
  feature: 'ميزة',
  task: 'مهمة',
  bug: 'خلل',
  subtask: 'مهمة فرعية',
  milestone: 'معلم',
  epic: 'ملحمة',
  story: 'قصة',
};

export const ICON_NAMES = Object.keys(ICON_LABELS) as readonly IconName[];

export type OptionForm = FormGroup<{ value: FormControl<string>; label: FormControl<string> }>;

export type FieldForm = FormGroup<{
  key: FormControl<string>;
  label: FormControl<string>;
  type: FormControl<FieldType>;
  required: FormControl<boolean>;
  min: FormControl<number | null>;
  max: FormControl<number | null>;
  hint: FormControl<string>;
  showInList: FormControl<boolean>;
  showOnCard: FormControl<boolean>;
  options: FormArray<OptionForm>;
}>;

export function createOptionForm(fb: NonNullableFormBuilder, value = '', label = ''): OptionForm {
  return fb.group({ value: fb.control(value, Validators.required), label: fb.control(label, Validators.required) });
}

/** Row-level rules shown inline: a select needs options, option values are unique, min <= max. */
export const fieldRowValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const v = (control as FieldForm).getRawValue();
  const errors: ValidationErrors = {};
  if (v.type === 'select') {
    if (!v.options.length) errors['noOptions'] = true;
    const values = v.options.map((o) => o.value).filter(Boolean);
    const dup = values.find((x, i) => values.indexOf(x) !== i);
    if (dup) errors['dupOption'] = dup;
  }
  if (v.type === 'number' && v.min !== null && v.max !== null && v.min > v.max) errors['minMax'] = true;
  return Object.keys(errors).length ? errors : null;
};

export function createFieldForm(fb: NonNullableFormBuilder, def?: FieldDefinition): FieldForm {
  return fb.group(
    {
      key: fb.control(def?.key ?? '', [Validators.required, Validators.pattern(KEY_PATTERN)]),
      label: fb.control(def?.label ?? '', Validators.required),
      type: fb.control<FieldType>(def?.type ?? 'text'),
      required: fb.control(def?.required ?? false),
      min: fb.control<number | null>(def?.min ?? null),
      max: fb.control<number | null>(def?.max ?? null),
      hint: fb.control(def?.hint ?? ''),
      showInList: fb.control(def?.showInList ?? false),
      showOnCard: fb.control(def?.showOnCard ?? false),
      options: fb.array((def?.options ?? []).map((o) => createOptionForm(fb, o.value, o.label))),
    },
    { validators: [fieldRowValidator] },
  );
}

/** Stored fields in display order (`order` ascending; fields without it keep their stored position). */
export function sortFieldsByOrder(fields: readonly FieldDefinition[]): readonly FieldDefinition[] {
  return fields
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (a.f.order ?? a.i) - (b.f.order ?? b.i) || a.i - b.i)
    .map((x) => x.f);
}

/** Indexes of rows whose key already appeared in an earlier row (inline duplicate-key error). */
export function duplicateKeyIndexes(keys: readonly string[]): ReadonlySet<number> {
  const seen = new Set<string>();
  const dup = new Set<number>();
  keys.forEach((k, i) => {
    if (!k) return;
    if (seen.has(k)) dup.add(i);
    seen.add(k);
  });
  return dup;
}

/** Field keys must be unique inside one type (FR-TYP-06). */
export const uniqueFieldKeys: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const keys = (control as FormArray<FieldForm>).controls.map((c) => c.controls.key.value).filter(Boolean);
  const duplicate = keys.find((k, i) => keys.indexOf(k) !== i);
  return duplicate ? { duplicateKey: duplicate } : null;
};

/** `order` is the row position, so the saved order always matches what the admin sees. */
export function toFieldDefinition(form: FieldForm, order?: number): FieldDefinition {
  const v = form.getRawValue();
  const hint = v.hint.trim();
  return {
    key: v.key,
    label: v.label.trim(),
    type: v.type,
    required: v.required,
    ...(v.type === 'number' && v.min !== null ? { min: v.min } : {}),
    ...(v.type === 'number' && v.max !== null ? { max: v.max } : {}),
    ...(v.type === 'select' ? { options: v.options.filter((o) => o.value && o.label) } : {}),
    ...(hint ? { hint } : {}),
    showInList: v.showInList,
    showOnCard: v.showOnCard,
    ...(order !== undefined ? { order } : {}),
  };
}

export type FieldServerErrors = ReadonlyMap<number, Readonly<Record<string, string>>>;

export interface MappedTypeErrors {
  /** `fields[i].prop` messages, by row index. */
  readonly byField: FieldServerErrors;
  /** Messages of top-level controls (`key`, `name`, ...). */
  readonly top: Readonly<Record<string, string>>;
  /** Everything that maps to no visible control. */
  readonly general: readonly string[];
}

export const TYPE_ERROR_CONTROLS: readonly string[] = ['key', 'name', 'description', 'color', 'icon', 'order', 'workflowId'];

const FIELD_ERROR_KEY = /^fields\[(\d+)\]\.(\w+)$/;

/** Maps a 400 `details` object of the types API onto the form (`fields[2].key` -> row 2). */
export function mapTypeErrors(details: Readonly<Record<string, string>> | undefined): MappedTypeErrors {
  const byField = new Map<number, Record<string, string>>();
  const top: Record<string, string> = {};
  const general: string[] = [];
  for (const [key, message] of Object.entries(details ?? {})) {
    const m = FIELD_ERROR_KEY.exec(key);
    if (m) {
      const index = Number(m[1]);
      byField.set(index, { ...(byField.get(index) ?? {}), [m[2]]: message });
    } else if (TYPE_ERROR_CONTROLS.includes(key)) top[key] = message;
    else general.push(message);
  }
  return { byField, top, general };
}
