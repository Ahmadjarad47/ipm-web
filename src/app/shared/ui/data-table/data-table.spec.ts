import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { DataTable } from './data-table';
import { ColumnDef, loadTablePrefs } from './data-table.models';

interface Row {
  id: string;
  name: string;
  note: string;
}

@Component({
  imports: [DataTable],
  template: `<app-data-table tableId="spec" [rows]="rows" [columns]="columns" />`,
})
class Host {
  rows: Row[] = [{ id: '1', name: 'A', note: 'N' }];
  columns: ColumnDef<Row>[] = [
    { key: 'name', header: 'الاسم', required: true },
    { key: 'note', header: 'ملاحظة', hidden: true },
  ];
}

describe('DataTable column preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
  });

  it('hides default-hidden columns, persists the choice and restores it', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('th')).toHaveLength(1);

    el.querySelector<HTMLButtonElement>('.chooser-btn')?.click();
    fixture.detectChanges();
    const boxes = el.querySelectorAll<HTMLInputElement>('.chooser-panel input');
    expect(boxes).toHaveLength(1); // required column is not listed
    boxes[0].click();
    fixture.detectChanges();
    expect(el.querySelectorAll('th')).toHaveLength(2);
    expect(loadTablePrefs('spec').columns).toEqual({ note: true });

    const again = TestBed.createComponent(Host);
    again.detectChanges();
    expect((again.nativeElement as HTMLElement).querySelectorAll('th')).toHaveLength(2);
  });

  it('survives corrupt storage', () => {
    localStorage.setItem('ipm.table.spec', '{nope');
    expect(loadTablePrefs('spec').density).toBe('comfortable');
  });
});
