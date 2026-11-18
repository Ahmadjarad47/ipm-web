import { computed, ResourceRef } from '@angular/core';
import { rxResource as angularRxResource, RxResourceOptions } from '@angular/core/rxjs-interop';

/**
 * Drop-in replacement for Angular's `rxResource` whose `value()` never throws.
 *
 * Angular throws `ResourceValueError` when `value()` is read while the resource is in the `error`
 * state. Reading it inside a `computed`, `effect` or template then crashes the whole component
 * instead of letting the page show its error state. Here, in the error state `value()` returns the
 * `defaultValue` (or `undefined`); check `error()` / `status()` to render the failure.
 *
 * Everything else — `reload()`, `set()`, `update()`, `isLoading()`, `hasValue()`, `error()` — is the
 * original resource, unchanged.
 */
export function rxResource<T, R>(opts: RxResourceOptions<T, R> & { defaultValue: NoInfer<T> }): ResourceRef<T>;
export function rxResource<T, R>(opts: RxResourceOptions<T, R>): ResourceRef<T | undefined>;
export function rxResource<T, R>(opts: RxResourceOptions<T, R>): ResourceRef<T | undefined> {
  const ref = angularRxResource<T, R>(opts as RxResourceOptions<T, R> & { defaultValue: NoInfer<T> });
  const original = ref.value;
  const fallback = (opts as { defaultValue?: T }).defaultValue;

  const safe = computed<T | undefined>(() => (ref.status() === 'error' ? fallback : original()));
  // The writable-signal surface the original value signal exposes.
  Object.assign(safe, { set: original.set, update: original.update, asReadonly: () => safe });
  (ref as { value: unknown }).value = safe;
  return ref;
}
