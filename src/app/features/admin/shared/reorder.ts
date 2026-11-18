import { AbstractControl, FormArray } from '@angular/forms';

/** Moves a row inside a FormArray (used by the "up/down" buttons of repeatable editors). */
export function moveControl<T extends AbstractControl>(array: FormArray<T>, from: number, to: number): void {
  if (to < 0 || to >= array.length || from === to) return;
  const control = array.at(from) as T;
  array.removeAt(from);
  array.insert(to, control);
}
