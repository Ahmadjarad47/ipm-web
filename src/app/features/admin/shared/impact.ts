import { ImpactInfo } from '@domain/work-items/work-item.models';

export type ImpactKind = 'type' | 'status';

/** «سيتأثر: N عملًا، M مشروعًا (افتراضي في: …)» — the one-line summary of an impact preview (FR-TYP-09, FR-WF-06). */
export function impactSummary(impact: ImpactInfo, kind: ImpactKind): string {
  const parts = [`${impact.items} من الأعمال`, `${impact.projects} مشروعًا`];
  if (kind === 'status') parts.push(`${impact.workflows} مسار عمل`);
  const base = `سيتأثر: ${parts.join('، ')}`;
  if (!impact.asDefaultIn.length) return base;
  const label = kind === 'type' ? 'افتراضي في' : 'ابتدائية في';
  return `${base} (${label}: ${impact.asDefaultIn.map((d) => d.name).join('، ')})`;
}

export function hasImpact(impact: ImpactInfo): boolean {
  return impact.items > 0 || impact.projects > 0 || impact.asDefaultIn.length > 0;
}
