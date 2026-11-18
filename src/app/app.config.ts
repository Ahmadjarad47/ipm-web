import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, ErrorHandler, inject, provideBrowserGlobalErrorListeners } from '@angular/core';
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
import { authTokenInterceptor, correlationIdInterceptor, errorInterceptor } from '@core/http/interceptors';
import { environment } from '@env/environment';
import { mockBackendInterceptor } from '@mock/mock-backend.interceptor';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
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
        // Must stay last: it answers requests instead of forwarding them.
        ...(environment.useMockBackend ? [mockBackendInterceptor] : []),
      ]),
    ),
  ],
};
