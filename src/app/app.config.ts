import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, ErrorHandler, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import {
  provideRouter,
  RedirectCommand,
  Router,
  TitleStrategy,
  withComponentInputBinding,
  withInMemoryScrolling,
  withNavigationErrorHandler,
} from '@angular/router';
import { AppErrorHandler } from '@core/layout/app-error-handler';
import { AppTitleStrategy } from '@core/layout/title-strategy';
import { AuthService } from '@core/auth/auth.service';
import { authTokenInterceptor, correlationIdInterceptor, errorInterceptor, refreshInterceptor } from '@core/http/interceptors';
import { environment } from '@env/environment';
import { mockBackendInterceptor } from '@mock/mock-backend.interceptor';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // A returning user gets the session back from the refresh cookie before the first screen is chosen.
    provideAppInitializer(() => inject(AuthService).initialize()),
    { provide: TitleStrategy, useClass: AppTitleStrategy },
    { provide: ErrorHandler, useClass: AppErrorHandler },
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' }),
      // Failed lazy chunks / resolvers: offline page when disconnected, otherwise the 500 page (NFR-11).
      withNavigationErrorHandler(() => {
        const router = inject(Router);
        return new RedirectCommand(router.parseUrl(navigator.onLine ? '/error' : '/offline'));
      }),
    ),
    provideHttpClient(
      withInterceptors([
        correlationIdInterceptor,
        authTokenInterceptor,
        errorInterceptor,
        // Below the error interceptor: a 401 is renewed once here, and only a failed renewal reaches the logout above.
        refreshInterceptor,
        // Must stay last: it answers requests instead of forwarding them.
        ...(environment.useMockBackend ? [mockBackendInterceptor] : []),
      ]),
    ),
  ],
};
