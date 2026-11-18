import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from '@core/preferences/theme.service';
import { ToastHost } from '@shared/ui/toast-host/toast-host';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<router-outlet /><app-toast-host />`,
})
export class App {
  // Instantiated here so the saved theme is applied on every screen, including login.
  private readonly theme = inject(ThemeService);
}
