# Accessibility (WCAG 2.2 AA)

## Checklist for every screen / component

- [ ] Every control is reachable and operable by keyboard; tab order follows the visual (RTL) order.
- [ ] A visible focus indicator on every custom control (global `:focus-visible` ring; flips to gold on dark surfaces via `.on-dark` / `.sidebar`).
- [ ] Buttons and links have an accessible name (`aria-label` for icon-only). Toggle buttons use `aria-pressed`, disclosures `aria-expanded`.
- [ ] Target size: at least 24x24 CSS px everywhere; 44px for `.btn`, inputs and menu items below 768px and on coarse pointers.
- [ ] Colour is never the only signal (badges also carry text/icons). Text contrast >= 4.5:1 in **both** themes (`node docs/contrast-check.mjs`).
- [ ] Forms: every input has a `<label for>`; errors are text, linked with `aria-describedby`, announced (`role="alert"`).
- [ ] Dynamic updates are announced: toasts use `role="status"` / `role="alert"`; loading uses `<app-skeleton>` (`role="status" aria-busy`); the offline banner is `role="alert"`.
- [ ] Popups (user menu, notifications, column chooser, help tip) close on `Esc` and outside click and return focus to the trigger.
- [ ] Tables: `<th scope="col">`, `aria-sort` on sortable headers, sr-only headers for checkbox/action columns (`ColumnDef.srHeader`), `aria-rowcount`, `aria-busy` while loading.
- [ ] Motion: animations respect `prefers-reduced-motion` (global rule + skeleton/spinner overrides).
- [ ] Windows High Contrast (`forced-colors`): cards, badges, buttons keep a border; focus outline stays visible.
- [ ] Page language/direction: `<html lang="ar" dir="rtl">`; Latin identifiers use `.ltr`.
- [ ] Reflow: no horizontal scroll at 320px width (data tables switch to stacked cards below 640px).
- [ ] Zoom to 200% and text spacing overrides do not clip content.

## Keyboard shortcuts (documented in-app with `?`)

`Ctrl/Cmd+K` or `/` search, `?` cheat sheet, `g d|p|w|a` navigation, `c` create work item. Shortcuts are ignored while typing and while a dialog is open (WCAG 2.1.4: they can be avoided because they are single-key only outside inputs; consider a setting to turn them off).

## Running an axe check manually

1. Start the app: `npm start`, open http://localhost:4200 and sign in with a demo account.
2. Install the **axe DevTools** browser extension (or use the Lighthouse "Accessibility" audit in Chrome DevTools).
3. For each main screen (login, dashboard, projects, work items list + detail, approvals, admin pages, profile): open DevTools -> axe DevTools -> *Scan all of my page*. Fix every *Critical* and *Serious* issue; review *Needs review* items by hand.
4. Repeat in **dark theme** (Profile -> المظهر -> داكن) and at a 360px wide viewport.
5. Interactive states to scan separately: open dialogs, the user menu, the notification panel, the command palette, the column chooser, toasts.
6. Optional CLI: `npx @axe-core/cli http://localhost:4200/login --exit` for the public login page (authenticated pages need the extension).
7. Manual passes that tools miss: keyboard-only walkthrough, screen reader (NVDA + Firefox/Chrome) on one task per module, 200% zoom, forced-colors emulation (DevTools -> Rendering).

## Known gaps

- Light-theme semantic text tokens (`gold-600`, `info`, `success`, `warning`, `neutral`) were darkened slightly so every pair in `docs/contrast-check.mjs` passes AA in both themes. Brand colours are unchanged. Deliberate exception: user-chosen status/type colours (data, not tokens) are tinted via `color-mix` and are the admin's responsibility.
- Drag and drop on the Kanban board needs a non-drag alternative (move action) - owned by the work-items stage.
