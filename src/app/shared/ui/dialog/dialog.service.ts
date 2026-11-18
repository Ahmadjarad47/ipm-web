import {
  ApplicationRef,
  ComponentRef,
  createComponent,
  EnvironmentInjector,
  inject,
  Injectable,
  InjectionToken,
  Injector,
  Type,
} from '@angular/core';
import { Observable, Subject } from 'rxjs';

/** Data passed to the opened component; read it with `inject(DIALOG_DATA)`. */
export const DIALOG_DATA = new InjectionToken<unknown>('DIALOG_DATA');

/** Handle to an open dialog, typed by the result it can close with. */
export class DialogRef<TResult = unknown> {
  private readonly closed$ = new Subject<TResult | undefined>();
  /** Emits once with the result (or `undefined` when dismissed), then completes. */
  readonly afterClosed: Observable<TResult | undefined> = this.closed$.asObservable();

  constructor(private readonly destroy: () => void) {}

  close(result?: TResult): void {
    this.closed$.next(result);
    this.closed$.complete();
    this.destroy();
  }
}

export interface DialogOptions<TData> {
  readonly data?: TData;
  readonly width?: string;
  /** Close on backdrop click / Escape. Default true. */
  readonly dismissible?: boolean;
}

/**
 * Generic modal service built on the native `<dialog>` element (focus trap, Escape, top layer for free).
 *
 *   const ref = dialog.open<ProjectForm, ProjectFormData, ProjectSummary>(ProjectForm, { data });
 *   ref.afterClosed.subscribe(project => …);
 *
 * Inside the opened component: `inject(DialogRef<ProjectSummary>)` and `inject(DIALOG_DATA) as ProjectFormData`.
 */
@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly appRef = inject(ApplicationRef);
  private readonly envInjector = inject(EnvironmentInjector);

  open<TComponent, TData = unknown, TResult = unknown>(
    component: Type<TComponent>,
    options: DialogOptions<TData> = {},
  ): DialogRef<TResult> {
    const host = document.createElement('dialog');
    host.className = 'app-dialog';
    host.style.width = options.width ?? 'min(560px, calc(100vw - 32px))';
    document.body.appendChild(host);

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    let componentRef: ComponentRef<TComponent> | null = null;
    const ref: DialogRef<TResult> = new DialogRef<TResult>(() => {
      if (componentRef) {
        this.appRef.detachView(componentRef.hostView);
        componentRef.destroy();
      }
      host.close();
      host.remove();
      if (opener?.isConnected) opener.focus();
    });

    const injector = Injector.create({
      parent: this.envInjector,
      providers: [
        { provide: DialogRef, useValue: ref },
        { provide: DIALOG_DATA, useValue: options.data },
      ],
    });

    componentRef = createComponent(component, { environmentInjector: this.envInjector, elementInjector: injector });
    host.appendChild(componentRef.location.nativeElement as HTMLElement);
    this.appRef.attachView(componentRef.hostView);

    const dismissible = options.dismissible ?? true;
    host.addEventListener('cancel', (e) => {
      e.preventDefault();
      if (dismissible) ref.close();
    });
    host.addEventListener('click', (e) => {
      if (dismissible && e.target === host) ref.close();
    });

    host.showModal();
    componentRef.changeDetectorRef.detectChanges();
    this.focusInitial(host);
    return ref;
  }

  /** First form control in the body, else the heading (made programmatically focusable). */
  private focusInitial(host: HTMLDialogElement): void {
    const control = host.querySelector<HTMLElement>('.db :is(input:not([type="hidden"]), select, textarea):not([disabled])');
    if (control) {
      control.focus();
      return;
    }
    const heading = host.querySelector<HTMLElement>('h1, h2, h3');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }
}
