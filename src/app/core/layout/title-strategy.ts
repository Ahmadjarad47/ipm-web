import { inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

const APP_NAME = 'إدارة المشاريع';

/**
 * "<page> · إدارة المشاريع". Detail pages can refine it at runtime with `PageTitle.set('ERP-104 …')`.
 */
@Injectable({ providedIn: 'root' })
export class AppTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const page = this.buildTitle(snapshot);
    this.title.setTitle(page ? `${page} · ${APP_NAME}` : APP_NAME);
  }
}

/** Lets a loaded detail page put its entity name in the browser tab. */
@Injectable({ providedIn: 'root' })
export class PageTitle {
  private readonly title = inject(Title);

  set(page: string): void {
    this.title.setTitle(`${page} · ${APP_NAME}`);
  }
}
