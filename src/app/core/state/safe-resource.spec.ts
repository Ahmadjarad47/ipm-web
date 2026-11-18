import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { rxResource } from './safe-resource';

function settle(): Promise<void> {
  TestBed.tick();
  return Promise.resolve().then(() => TestBed.tick());
}

describe('safe rxResource', () => {
  const injector = (): Injector => TestBed.inject(Injector);

  it('returns the loaded value', async () => {
    const res = runInInjectionContext(injector(), () =>
      rxResource<number[], true>({ params: () => true, stream: () => of([1, 2, 3]), defaultValue: [] }),
    );
    await settle();
    expect(res.value()).toEqual([1, 2, 3]);
    expect(res.hasValue()).toBe(true);
  });

  it('does not throw in the error state and falls back to the default value', async () => {
    const failing = (): Observable<number[]> => throwError(() => new Error('boom'));
    const res = runInInjectionContext(injector(), () =>
      rxResource<number[], true>({ params: () => true, stream: failing, defaultValue: [] }),
    );
    await settle();
    expect(res.error()).toBeTruthy();
    expect(() => res.value()).not.toThrow();
    expect(res.value()).toEqual([]);
    expect(res.hasValue()).toBe(false);
  });

  it('returns undefined in the error state when there is no default', async () => {
    const failing = (): Observable<string> => throwError(() => new Error('boom'));
    const res = runInInjectionContext(injector(), () => rxResource<string, true>({ params: () => true, stream: failing }));
    await settle();
    expect(res.error()).toBeTruthy();
    expect(res.value()).toBeUndefined();
  });

  it('still supports set() and reload()', async () => {
    const res = runInInjectionContext(injector(), () =>
      rxResource<number, true>({ params: () => true, stream: () => of(1), defaultValue: 0 }),
    );
    await settle();
    res.set(5);
    expect(res.value()).toBe(5);
    expect(() => res.reload()).not.toThrow();
  });
});
