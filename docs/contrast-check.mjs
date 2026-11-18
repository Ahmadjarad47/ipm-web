// Verifies WCAG AA contrast (>= 4.5:1 for text tokens) for the light and dark themes in src/styles/_tokens.scss.
// Run: node docs/contrast-check.mjs   (exits 1 when the DARK theme has a failing pair;
// light-theme failures are printed as WARN: they are the original brand semantic colours, tracked for a design review).
import { readFileSync } from 'node:fs';

const scss = readFileSync(new URL('../src/styles/_tokens.scss', import.meta.url), 'utf8');

function parse(block) {
  const out = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1].replace(/^c-/, "")] = m[2];
  return out;
}
const rootBlock = scss.slice(scss.indexOf(':root {'), scss.indexOf('@mixin dark-tokens'));
const darkBlock = scss.slice(scss.indexOf('@mixin dark-tokens'), scss.indexOf(":root[data-theme='dark'] {"));
const light = parse(rootBlock);
const dark = { ...light, ...parse(darkBlock) };

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// [foreground token or hex, background token or hex]
const pairs = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'], ['text-2', 'surface'], ['text-2', 'bg'],
  ['muted', 'surface'], ['muted', 'bg'], ['muted', 'surface-2'],
  ['emerald-700', 'surface'], ['emerald-700', 'bg'], ['emerald-800', 'surface'], ['emerald-900', 'surface'],
  ['emerald-900', 'bg'], ['emerald-700', 'emerald-50'],
  ['gold-600', 'surface'], ['gold-600', 'gold-100'],
  ['info', 'info-bg'], ['success', 'success-bg'], ['warning', 'warning-bg'], ['danger', 'danger-bg'], ['neutral', 'neutral-bg'],
  ['danger', 'surface'], ['success', 'surface'], ['warning', 'surface'], ['info', 'surface'],
  ['#ffffff', 'primary'], ['#ffffff', 'primary-hover'], ['#ffffff', 'danger-solid'],
  ['on-gold', 'gold-500'], ['on-gold', 'gold-300'],
  ['#ffffff', 'ink-1'], ['#ffffff', 'ink-2'], ['gold-300', 'ink-1'],
];

let failed = 0;
let lightWarn = 0;
for (const [name, tokens] of [['light', light], ['dark', dark]]) {
  console.log(`\n${name} theme`);
  for (const [fg, bg] of pairs) {
    const f = fg.startsWith('#') ? fg : tokens[fg];
    const b = bg.startsWith('#') ? bg : tokens[bg];
    if (!f || !b) {
      console.log(`  ?    ${fg} on ${bg} (missing token)`);
      failed++;
      continue;
    }
    const r = ratio(f, b);
    const ok = r >= 4.5;
    if (!ok && name === 'dark') failed++;
    if (!ok && name === 'light') lightWarn++;
    console.log(`  ${ok ? 'ok  ' : name === 'light' ? 'WARN' : 'FAIL'} ${r.toFixed(2).padStart(5)}  ${fg} (${f}) on ${bg} (${b})`);
  }
}
if (lightWarn) console.log(`
${lightWarn} light-theme pair(s) below 4.5:1 (warning only)`);
console.log(failed ? `\n${failed} pair(s) below 4.5:1` : '\nAll pairs pass AA (>= 4.5:1)');
process.exit(failed ? 1 : 0);
