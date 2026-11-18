import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const PALETTE = ['#14614a', '#a9822c', '#2f6fb5', '#7c5cbf', '#b7791f', '#0f766e', '#9d4b6e'];

function hash(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

/** Initials avatar with a stable colour per name. */
@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
    '[style.font-size.px]': 'size() * 0.4',
    '[style.background]': 'bg()',
    '[attr.title]': 'name()',
    role: 'img',
    '[attr.aria-label]': 'name()',
  },
  template: `{{ initials() }}`,
  styles: `:host { display: inline-grid; place-items: center; flex-shrink: 0; border-radius: 50%; color: #fff; font-weight: 700; border: 2px solid var(--c-surface); }`,
})
export class Avatar {
  readonly name = input.required<string>();
  readonly size = input(32);
  protected readonly initials = computed(() =>
    this.name()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join(' '),
  );
  protected readonly bg = computed(() => PALETTE[hash(this.name()) % PALETTE.length]);
}

/** Overlapping avatars: `<app-avatar-stack [names]="['…','…']" />` */
@Component({
  selector: 'app-avatar-stack',
  imports: [Avatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (n of visible(); track $index) {
      <app-avatar [name]="n" [size]="size()" />
    }
    @if (extra() > 0) {
      <span class="more" [style.width.px]="size()" [style.height.px]="size()">+{{ extra() }}</span>
    }
    @if (!names().length) {
      <span class="muted">غير مكلَّف</span>
    }
  `,
  styles: `
    :host { display: inline-flex; align-items: center; }
    :host > * + * { margin-inline-start: -8px; }
    .more { display: inline-grid; place-items: center; border-radius: 50%; background: var(--c-neutral-bg); font-size: 11px; font-weight: 700; border: 2px solid var(--c-surface); }
    .muted { font-size: var(--fs-sm); }
  `,
})
export class AvatarStack {
  readonly names = input.required<readonly string[]>();
  readonly max = input(3);
  readonly size = input(28);
  protected readonly visible = computed(() => this.names().slice(0, this.max()));
  protected readonly extra = computed(() => this.names().length - this.max());
}
