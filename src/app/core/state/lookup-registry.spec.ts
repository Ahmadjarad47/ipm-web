import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL } from '@core/api/api.config';
import { invalidationInterceptor } from '@core/http/interceptors';
import { Invalidatable, LookupRegistry } from './lookup-registry';

function store(...resources: string[]): { readonly store: Invalidatable; readonly reload: ReturnType<typeof vi.fn> } {
  const reload = vi.fn();
  return { reload, store: { dependsOn: () => resources, reload: () => reload() } };
}

describe('LookupRegistry', () => {
  let registry: LookupRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    registry = TestBed.inject(LookupRegistry);
  });

  afterEach(() => vi.useRealTimers());

  it('reloads only the lookups that depend on the changed resource', () => {
    const projects = store('projects', 'work-items');
    const users = store('users');
    registry.register(projects.store);
    registry.register(users.store);

    registry.invalidate('work-items');
    vi.advanceTimersByTime(100);

    expect(projects.reload).toHaveBeenCalledOnce();
    expect(users.reload).not.toHaveBeenCalled();
  });

  it('reloads once for a burst of writes (an edit that takes three requests)', () => {
    const users = store('users');
    registry.register(users.store);

    registry.invalidate('users');
    registry.invalidate('users');
    registry.invalidate('users');
    vi.advanceTimersByTime(100);

    expect(users.reload).toHaveBeenCalledOnce();
  });
});

describe('invalidationInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let registry: LookupRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([invalidationInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
    registry = TestBed.inject(LookupRegistry);
    vi.spyOn(registry, 'invalidate');
  });

  const api = (path: string) => `${TestBed.inject(API_BASE_URL)}${path}`;

  it('tells the registry which resource a successful write changed', () => {
    http.put(api('/projects/p1/members'), {}).subscribe();
    controller.expectOne(api('/projects/p1/members')).flush({});

    expect(registry.invalidate).toHaveBeenCalledWith('projects');
  });

  it('ignores reads, failed writes and sign-in calls', () => {
    http.get(api('/projects')).subscribe();
    controller.expectOne(api('/projects')).flush([]);
    http.post(api('/work-items'), {}).subscribe({ error: () => undefined });
    controller.expectOne(api('/work-items')).flush({}, { status: 422, statusText: 'Unprocessable' });
    http.post(api('/auth/login'), {}).subscribe();
    controller.expectOne(api('/auth/login')).flush({});

    expect(registry.invalidate).not.toHaveBeenCalled();
  });
});
