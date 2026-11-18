import { Directive, effect, inject, input, TemplateRef, ViewContainerRef } from '@angular/core';
import { AuthService } from './auth.service';
import { PermissionKey } from './permissions';

/**
 * Structural permission check:
 *   <button *appCan="'projects.create'">…</button>
 *   <button *appCan="'tasks.edit'; project: project.id; else readOnly">…</button>
 *
 * Hiding is UX only; the API is the real enforcement point.
 */
@Directive({ selector: '[appCan]' })
export class CanDirective {
  private readonly auth = inject(AuthService);
  private readonly template = inject(TemplateRef<unknown>);
  private readonly vcr = inject(ViewContainerRef);

  readonly appCan = input.required<PermissionKey | readonly PermissionKey[]>();
  readonly appCanProject = input<string | null | undefined>(undefined);
  readonly appCanElse = input<TemplateRef<unknown> | null>(null);

  constructor() {
    effect(() => {
      const keys = this.appCan();
      const list = (Array.isArray(keys) ? keys : [keys]) as readonly PermissionKey[];
      const allowed = this.auth.canAny(list, this.appCanProject());
      const elseTpl = this.appCanElse();

      this.vcr.clear();
      if (allowed) this.vcr.createEmbeddedView(this.template);
      else if (elseTpl) this.vcr.createEmbeddedView(elseTpl);
    });
  }
}
