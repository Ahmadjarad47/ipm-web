import { ChangeDetectionStrategy, Component, forwardRef, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/** Preset swatches taken from the design tokens (`_tokens.scss`). */
export const COLOR_PRESETS: readonly string[] = [
  '#14614a',
  '#1a7a5c',
  '#23946f',
  '#a9822c',
  '#c9a24a',
  '#2f6fb5',
  '#7c5cbf',
  '#b7791f',
  '#c0392b',
  '#6b7280',
];

/** `<app-color-field formControlName="color" />` — native colour input plus preset swatches. */
@Component({
  selector: 'app-color-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => ColorField), multi: true }],
  template: `
    <div class="cf">
      <input type="color" [value]="value()" [disabled]="disabled()" aria-label="اللون" (input)="pickFrom($event)" />
      @for (c of presets; track c) {
        <button type="button" class="chip" [style.background]="c" [class.on]="c === value()" [disabled]="disabled()"
          [attr.aria-label]="'اللون ' + c" [attr.aria-pressed]="c === value()" (click)="pick(c)"></button>
      }
    </div>
  `,
  styles: `
    .cf { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    input[type='color'] { width: 38px; height: 34px; padding: 2px; border: 1px solid var(--c-border-strong); border-radius: var(--r-sm); background: var(--c-surface); cursor: pointer; }
    .chip { width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--c-surface); box-shadow: 0 0 0 1px var(--c-border-strong); cursor: pointer; }
    .chip.on { box-shadow: 0 0 0 2px var(--c-emerald-800); }
  `,
})
export class ColorField implements ControlValueAccessor {
  protected readonly presets = COLOR_PRESETS;
  protected readonly value = signal('#14614a');
  protected readonly disabled = signal(false);
  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  protected pickFrom(event: Event): void {
    this.pick((event.target as HTMLInputElement).value);
  }

  protected pick(color: string): void {
    this.value.set(color);
    this.onChange(color);
    this.onTouched();
  }

  writeValue(value: string | null): void {
    if (value) this.value.set(value);
  }
  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }
}
