import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { DialogRef, DialogService } from './dialog.service';

@Component({
  template: `<h2>عنوان</h2><div class="db"><input id="first" /><input id="second" /></div>`,
})
class WithForm {
  readonly ref = inject(DialogRef);
}

@Component({ template: `<h2 id="head">عنوان</h2><p>نص</p>` })
class NoForm {}

describe('DialogService focus management', () => {
  // jsdom does not implement the modal <dialog> API.
  beforeAll(() => {
    const proto = HTMLDialogElement.prototype;
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });

  it('focuses the first form control and restores focus to the opener on close', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const ref = TestBed.inject(DialogService).open(WithForm);
    expect((document.activeElement as HTMLElement).id).toBe('first');

    ref.close();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('falls back to the heading when there is no form control', () => {
    const ref = TestBed.inject(DialogService).open(NoForm);
    expect((document.activeElement as HTMLElement).id).toBe('head');
    ref.close();
  });
});
