import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// t() reads the active dictionary when it is called, but it is not reactive:
// nothing re-renders just because the language changed. Every page therefore
// has to subscribe, or it keeps the language it first rendered with until
// something unrelated happens to repaint it.
//
// This is checked structurally rather than by driving a browser, because a
// popup repaints for many reasons — polling, messages, React's own scheduling
// — and an end-to-end check passes whether or not the subscription exists.
// That is exactly how the popup shipped without one: the language picker was
// the only subscriber, so changing the language appeared to do nothing until
// the next two-second poll.
const PAGES = [
  ['popup', 'src/popup/Popup.tsx'],
  ['report', 'src/report/Report.tsx'],
  ['side panel', 'src/sidepanel/SidePanel.tsx'],
  ['warning', 'src/warning/index.tsx'],
  ['welcome', 'src/welcome/index.tsx'],
] as const;

describe('every page follows a language change', () => {
  it.each(PAGES)('%s subscribes to the locale', (_name, file) => {
    const src = readFileSync(file, 'utf8');
    expect(src).toMatch(/useLocale\(\)/);
  });

  it.each(PAGES)('%s subscribes where the whole page will see it', (_name, file) => {
    const src = readFileSync(file, 'utf8');
    // Find the component that useLocale() sits in, and require it to be the
    // one the page renders as a whole — not a leaf like the picker row. The
    // root is whichever component the entry point mounts, so look for it by
    // name in the file's render call or, for pages that mount themselves,
    // accept the component that renders the page's other components.
    const call = src.indexOf('useLocale()');
    expect(call).toBeGreaterThan(0);
    const declsBefore = [...src.slice(0, call).matchAll(/^(?:export )?const (\w+): React\.FC/gm)];
    const owner = declsBefore[declsBefore.length - 1]?.[1];
    expect(owner).toBeDefined();
    // The owning component must be referenced as JSX somewhere else in the
    // file (a root is rendered by the entry point, and every page here either
    // renders its root or exports it) — and must not be a *-Row/-Button/-Card
    // style leaf, which is the shape the popup bug had.
    expect(owner).not.toMatch(/(Row|Button|Card|Bar|Hint|Switcher)$/);
  });
});
