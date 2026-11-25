import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { PreferencesStore } from '@core/preferences/preferences.store';
import { NotificationSeenDirective } from '@core/notifications/notification-seen.directive';
import { NotificationStore } from '@core/notifications/notification.store';
import { Notification } from '@domain/activity/activity.models';
import { Avatar } from '@shared/ui/avatar/avatar';
import { Icon } from '@shared/ui/icon/icon';
import { RelativeTimePipe } from '@shared/pipes/pipes';
import { DialogService } from '@shared/ui/dialog/dialog.service';
import { TabItem, Tabs } from '@shared/ui/tabs/tabs';
import { CommandPalette } from './command-palette';
import { NAVIGATION } from './navigation';
import { OfflineBanner } from './offline-banner';
import { RouteCrumbs } from './route-crumbs';
import { Shortcuts } from './shortcuts';

type NotifTab = 'all' | 'unread';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, Avatar, RelativeTimePipe, OfflineBanner, Tabs, NotificationSeenDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
  host: {
    '(document:keydown.escape)': 'onEscape()',
    '(document:keydown)': 'onGlobalKey($event)',
    '(document:click)': 'onDocumentClick($event)',
  },
})
export class Shell {
  protected readonly auth = inject(AuthService);
  protected readonly notifications = inject(NotificationStore);
  protected readonly crumbs = inject(RouteCrumbs);
  private readonly prefs = inject(PreferencesStore);
  private readonly router = inject(Router);
  private readonly dialog = inject(DialogService);
  private readonly shortcuts = inject(Shortcuts);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly sidebarOpen = signal(false);
  protected readonly notifOpen = signal(false);
  protected readonly userMenuOpen = signal(false);
  protected readonly notifTab = signal<NotifTab>('all');
  protected readonly today = new Intl.DateTimeFormat('ar', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  protected readonly isDark = computed(() => {
    const theme = this.prefs.prefs().theme;
    return theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  });
  protected readonly isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  private paletteOpen = false;

  private readonly notifBtn = viewChild<ElementRef<HTMLElement>>('notifBtn');
  private readonly userBtn = viewChild<ElementRef<HTMLElement>>('userBtn');

  protected readonly notifTabs = computed<readonly TabItem<NotifTab>[]>(() => [
    { key: 'all', label: 'الكل' },
    { key: 'unread', label: 'غير المقروءة', count: this.notifications.unread() },
  ]);
  protected readonly visibleNotifications = computed(() =>
    this.notifTab() === 'unread' ? this.notifications.items().filter((n) => !n.read) : this.notifications.items(),
  );

  /** Sidebar shows only what the user may open — the routes still guard direct links. */
  protected readonly sections = computed(() => {
    this.auth.session(); // re-evaluate when the session changes
    return NAVIGATION.map((s) => ({
      ...s,
      items: s.items.filter((i) => !i.permissions.length || i.permissions.some((p) => this.auth.canSomewhere(p))),
    })).filter((s) => s.items.length);
  });

  constructor() {
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(() => this.closePanels());
  }

  protected openNotification(n: Notification): void {
    this.notifications.markRead(n);
    this.notifOpen.set(false);
    void this.router.navigateByUrl(n.link);
  }

  protected toggleNotif(): void {
    this.userMenuOpen.set(false);
    this.notifOpen.update((v) => !v);
  }

  protected toggleUserMenu(): void {
    this.notifOpen.set(false);
    const open = !this.userMenuOpen();
    this.userMenuOpen.set(open);
    if (open) queueMicrotask(() => this.menuItems()[0]?.focus());
  }

  protected closePanels(): void {
    this.sidebarOpen.set(false);
    this.notifOpen.set(false);
    this.userMenuOpen.set(false);
  }

  /** Esc closes the open popup and returns focus to the control that opened it. */
  protected onEscape(): void {
    const restore = this.notifOpen() ? this.notifBtn() : this.userMenuOpen() ? this.userBtn() : null;
    this.closePanels();
    restore?.nativeElement.focus();
  }

  protected onDocumentClick(event: Event): void {
    const target = event.target as Node;
    if (this.notifOpen() && !this.el.nativeElement.querySelector('.notif')?.contains(target)) this.notifOpen.set(false);
    if (this.userMenuOpen() && !this.el.nativeElement.querySelector('.user-menu')?.contains(target)) this.userMenuOpen.set(false);
  }

  protected onMenuKey(event: KeyboardEvent): void {
    const items = this.menuItems();
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (event.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    if (next >= 0) {
      event.preventDefault();
      items[next]?.focus();
    }
  }

  protected toggleTheme(): void {
    this.prefs.update({ theme: this.isDark() ? 'light' : 'dark' });
  }

  protected openShortcuts(): void {
    this.closePanels();
    this.shortcuts.openCheatSheet();
  }

  protected logout(): void {
    this.closePanels();
    this.auth.logout();
  }

  private menuItems(): HTMLElement[] {
    return Array.from(this.el.nativeElement.querySelectorAll<HTMLElement>('.user-menu [role="menuitem"]'));
  }

  /** Ctrl/⌘+K or "/" (outside inputs) opens global search; other single keys go to `Shortcuts`. */
  protected onGlobalKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const typing = !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    const combo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
    if (combo || (event.key === '/' && !typing)) {
      event.preventDefault();
      this.openSearch();
      return;
    }
    this.shortcuts.handle(event);
  }

  protected openSearch(): void {
    if (this.paletteOpen) return;
    this.paletteOpen = true;
    this.closePanels();
    this.dialog
      .open<CommandPalette, void, void>(CommandPalette, { width: 'min(640px, calc(100vw - 32px))' })
      .afterClosed.subscribe(() => (this.paletteOpen = false));
  }
}
