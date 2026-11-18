/** Live explanation of the project progress formula for the selected types (SRS §4.4). */
export interface ProgressExample {
  /** Which types are counted. */
  readonly scope: string;
  readonly formula: string;
  readonly example: string;
}

/** Illustrative sample used in the example line (not real data). */
export const SAMPLE = { counted: 20, done: 8 } as const;

export function progressExample(includedTypeNames: readonly string[]): ProgressExample {
  const all = includedTypeNames.length === 0;
  const { counted, done } = SAMPLE;
  const percent = Math.round((done / counted) * 100);
  const scope = all ? 'كل أنواع عناصر العمل' : `الأنواع المحددة فقط: ${includedTypeNames.join('، ')}`;
  const subject = all ? 'عنصرًا ورقيًا' : `عنصرًا ورقيًا من الأنواع المحددة`;
  return {
    scope,
    formula: 'التقدم = العناصر الورقية المنجزة ÷ العناصر الورقية المحتسبة. الأب لا يُحتسب مع أبنائه، وتُستثنى الملغاة والمؤرشفة، والموافقة لا تعني الإنجاز.',
    example: `مثال توضيحي: مشروع فيه ${counted} ${subject}، أُنجز منها ${done}، فيكون التقدم ${done} ÷ ${counted} = ${percent}%.`,
  };
}

export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().every((id, i) => id === [...b].sort()[i]);
}
