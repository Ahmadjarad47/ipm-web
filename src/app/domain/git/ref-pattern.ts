/** FR-GIT-03: per-project work item reference pattern, validated so it cannot be abused (ReDoS, §7.2). */

export const MAX_REF_PATTERN_LENGTH = 100;
/** Max quantifiers (`+ * ? {n,m}`) a pattern may contain in total. */
const MAX_QUANTIFIERS = 2;
/** Only this many leading characters of any scanned text are matched (bounds worst-case backtracking). */
export const MAX_SCAN_CHARS = 2000;

/** Default pattern derived from the project code: `ERP-104` anywhere in a message, branch or PR title. */
export function defaultRefPattern(code: string): string {
  return `\\b(${code}-\\d+)\\b`;
}

export function compileRefPattern(pattern: string): RegExp {
  return new RegExp(pattern, 'g');
}

/** Number of capturing groups (named ones included; `(?:` and lookarounds excluded). */
function captureGroups(pattern: string): number {
  return new RegExp(`${pattern}|`).exec('')!.length - 1;
}

interface GroupFrame {
  hasQuantifier: boolean;
  hasAlternation: boolean;
}

/**
 * Conservative structural ReDoS check (§7.2). Rejects: back-references, lookaheads/lookbehinds, more than
 * {@link MAX_QUANTIFIERS} quantifiers, and any group repeated more than once (`+ * {n,} {n,m>1}`) that
 * contains another quantifier or an alternation (`((a+))+`, `(a|a)*`).
 */
export function isCatastrophic(pattern: string): boolean {
  if (/\\[1-9]|\\k</.test(pattern) || /\(\?<?[=!]/.test(pattern)) return true;
  const stack: GroupFrame[] = [];
  let quantifiers = 0;
  let lastGroup: GroupFrame | null = null;
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    let closed: GroupFrame | null = null;
    if (c === '\\') {
      i += 2;
    } else if (c === '[') {
      i++;
      while (i < pattern.length && pattern[i] !== ']') i += pattern[i] === '\\' ? 2 : 1;
      i++;
    } else if (c === '(') {
      stack.push({ hasQuantifier: false, hasAlternation: false });
      i++;
      if (pattern.startsWith('?:', i)) i += 2;
      else if (pattern.startsWith('?<', i)) i = pattern.indexOf('>', i) + 1 || pattern.length;
    } else if (c === ')') {
      closed = stack.pop() ?? null;
      if (!closed) return true;
      i++;
    } else if (c === '|') {
      const top = stack[stack.length - 1];
      if (top) top.hasAlternation = true;
      i++;
    } else if (c === '+' || c === '*' || c === '?' || c === '{') {
      let max = c === '?' ? 1 : Infinity;
      let len = 1;
      if (c === '{') {
        const m = /^\{(\d+)(?:,(\d*))?\}/.exec(pattern.slice(i));
        if (!m) {
          i++;
          lastGroup = null;
          continue;
        }
        len = m[0].length;
        max = m[2] === undefined ? Number(m[1]) : m[2] === '' ? Infinity : Number(m[2]);
      }
      quantifiers++;
      if (quantifiers > MAX_QUANTIFIERS) return true;
      if (lastGroup && max > 1 && (lastGroup.hasQuantifier || lastGroup.hasAlternation)) return true;
      const top = stack[stack.length - 1];
      if (top) top.hasQuantifier = true;
      i += len;
      if (pattern[i] === '?') i++; // lazy modifier is not a separate quantifier
      lastGroup = null;
      continue;
    } else {
      i++;
    }
    if (closed) {
      const top = stack[stack.length - 1];
      if (top) {
        top.hasQuantifier ||= closed.hasQuantifier;
        top.hasAlternation ||= closed.hasAlternation;
      }
    }
    lastGroup = closed;
  }
  return stack.length > 0;
}

/** Returns an Arabic error message, or null when the pattern is acceptable (it must recognise the project's own refs). */
export function validateRefPattern(pattern: string, sampleRefs: readonly string[]): string | null {
  if (!pattern.trim()) return 'النمط فارغ.';
  if (pattern.length > MAX_REF_PATTERN_LENGTH) return `النمط أطول من ${MAX_REF_PATTERN_LENGTH} حرفًا.`;
  let regex: RegExp;
  try {
    regex = compileRefPattern(pattern);
  } catch {
    return 'النمط ليس تعبيرًا نمطيًا صالحًا.';
  }
  if (isCatastrophic(pattern)) return 'النمط قد يسبب بطئًا شديدًا (تكرار متداخل أو مراجع خلفية أو تطلّع أمامي/خلفي أو تكرارات كثيرة) ومرفوض.';
  if (captureGroups(pattern) !== 1) return 'يجب أن يحتوي النمط على مجموعة التقاط واحدة بالضبط تلتقط رمز العمل.';
  for (const ref of sampleRefs) {
    // The ref must be recognised in at least one of the usual places it appears (bare, bracketed, branch, message).
    const forms = [ref, `[${ref}]`, `(${ref})`, `#${ref}`, `feature/${ref}`, `${ref}: وصف`];
    const recognised = forms.some((text) => [...text.matchAll(regex)].some((m) => m[1] === ref));
    if (!recognised) return `النمط لا يلتقط رمز عمل المشروع «${ref}».`;
  }
  return null;
}

/** Refs found in `texts` by `pattern`, scanning only the first {@link MAX_SCAN_CHARS} characters of each text. */
export function extractRefs(pattern: string, ...texts: string[]): string[] {
  const regex = compileRefPattern(pattern);
  const found = new Set<string>();
  for (const text of texts) for (const m of text.slice(0, MAX_SCAN_CHARS).matchAll(regex)) if (m[1]) found.add(m[1]);
  return [...found];
}
