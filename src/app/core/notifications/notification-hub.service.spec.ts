import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '@core/auth/auth.service';

const fakeConnection = {
  state: 'Disconnected',
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockImplementation(async function (this: typeof fakeConnection) {
    this.state = 'Disconnected';
  }),
  on: vi.fn(),
  off: vi.fn(),
  onreconnected: vi.fn(),
  onreconnecting: vi.fn(),
  onclose: vi.fn(),
};

let capturedUrl: string | undefined;
let capturedOptions: { accessTokenFactory?: () => string } | undefined;

vi.mock('@microsoft/signalr', () => ({
  HubConnectionState: { Disconnected: 'Disconnected', Connected: 'Connected' },
  LogLevel: { Warning: 2 },
  HubConnectionBuilder: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this['withUrl'] = (url: string, options: typeof capturedOptions) => {
      capturedUrl = url;
      capturedOptions = options;
      return this;
    };
    this['withAutomaticReconnect'] = () => this;
    this['configureLogging'] = () => this;
    this['build'] = () => fakeConnection;
    return this;
  }),
}));

describe('NotificationHubService', () => {
  beforeEach(() => {
    fakeConnection.state = 'Disconnected';
    fakeConnection.start.mockClear().mockImplementation(async () => {
      fakeConnection.state = 'Connected';
    });
    fakeConnection.stop.mockClear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
  });
  afterEach(() => vi.clearAllMocks());

  it('reads the live access token on every (re)connect attempt via accessTokenFactory, not a captured value', async () => {
    const auth = TestBed.inject(AuthService);
    // Trigger the service's construction (and so the builder call) after auth is established, so `withUrl`'s
    // options object exists to assert against.
    const { NotificationHubService } = await import('./notification-hub.service');
    TestBed.inject(NotificationHubService);

    expect(capturedUrl).toContain('/hubs/notifications');
    auth.establish({
      token: 'first-token',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      user: { id: 'u1', name: 'U', email: 'u@x', title: '' },
      systemPermissions: [],
      projectPermissions: {},
      denied: [],
    });
    TestBed.tick();
    expect(capturedOptions?.accessTokenFactory?.()).toBe('first-token');

    auth.establish({
      token: 'second-token',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      user: { id: 'u1', name: 'U', email: 'u@x', title: '' },
      systemPermissions: [],
      projectPermissions: {},
      denied: [],
    });
    TestBed.tick();
    expect(capturedOptions?.accessTokenFactory?.()).toBe('second-token');
  });

  it('connects when signed in and stops the connection on logout', async () => {
    const auth = TestBed.inject(AuthService);
    const { NotificationHubService } = await import('./notification-hub.service');
    TestBed.inject(NotificationHubService);

    auth.establish({
      token: 't',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      user: { id: 'u1', name: 'U', email: 'u@x', title: '' },
      systemPermissions: [],
      projectPermissions: {},
      denied: [],
    });
    TestBed.tick();
    await Promise.resolve();
    expect(fakeConnection.start).toHaveBeenCalled();

    auth.logout(false);
    TestBed.tick();
    await Promise.resolve();
    expect(fakeConnection.stop).toHaveBeenCalled();
  });
});
