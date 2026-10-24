// section navigation: jumps between the page's sections (landmarks and the
// groups Jev found) with the keyboard.
//
// built for screen readers: each jump moves keyboard focus to the section's
// title (its heading, or what it starts with), so the screen reader reads the
// page's own text, and the reading cursor carries on from there. a hidden live
// region then adds where you are ("card, 7 of 25 sections"). the section's
// title is also read out loud with speechSynthesis, and sighted users get a
// highlight box around the section; nothing else is drawn.
//
// keys:
//   alt+shift+down / up   next / previous section (always; works with a
//                         screen reader running, which keeps plain arrows)
//   alt+shift+n           section mode on / off
// while section mode is on:
//   down / up, home / end move between sections
//   enter / escape        leave section mode, keeping focus where it is

import { buildNav, sectionName, sectionsOf, type NavItem, type Section } from './vdom/nav.js';
import type { GroupedNode } from './vdom/types.js';

export type SectionNavOptions = {
  /** node id -> live element, filled by `parse` */
  elements: Map<number, Element>;
  /** parse the page and run the passes; resolves to the grouped tree */
  analyze: () => Promise<{ tree: GroupedNode; jevCalls: number; ms: number }>;
};

const FOCUSABLE =
  'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

const STYLE = `
  :host { all: initial; }
  .box {
    position: fixed; pointer-events: none; z-index: 2147483646; display: none;
    border: 3px solid #ffbf00; border-radius: 6px;
    box-shadow: 0 0 0 4px rgba(0,0,0,.35);
    transition: all .12s ease-out;
  }
  .status {
    position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
    z-index: 2147483647; display: none; padding: 6px 12px; border-radius: 999px;
    background: #14161a; color: #f2f2f2; pointer-events: none;
    font: 13px/1.3 system-ui, -apple-system, sans-serif;
  }
  .sr {
    position: fixed; width: 1px; height: 1px; overflow: hidden;
    clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
  }
`;

export const createSectionNav = ({ elements, analyze }: SectionNavOptions) => {
  let host: HTMLElement | null = null;
  let box!: HTMLElement;
  let status!: HTMLElement;
  let live!: HTMLElement;

  let sections: Section[] = [];
  let current = -1;
  let loading: Promise<void> | null = null;
  let on = false;

  const elementsOf = (it: NavItem) =>
    it.elementIds
      .map((id) => elements.get(id))
      .filter((el): el is Element => !!el && el.isConnected);

  /** drop what isn't rendered (display: none menus etc.) */
  const visible = (it: NavItem): NavItem | null => {
    const els = elementsOf(it);
    if (els.length && !els.some((el) => el.checkVisibility())) return null;
    return {
      ...it,
      children: it.children.map(visible).filter((c): c is NavItem => c !== null),
    };
  };

  // ---------------------------------------------------------------------------
  // output: the box, a status pill while loading, and the live region
  // ---------------------------------------------------------------------------

  const mount = () => {
    host = document.createElement('esr-sections');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${STYLE}</style>
      <div class="box"></div>
      <div class="status" aria-hidden="true"></div>
      <div class="sr" role="status" aria-live="polite"></div>`;
    box = shadow.querySelector('.box')!;
    status = shadow.querySelector('.status')!;
    live = shadow.querySelector('.sr')!;
    document.documentElement.append(host);
  };

  /** say `text` through the screen reader (cleared first, so repeats are read) */
  const announce = (text: string) => {
    console.log('[esr] announce:', text);
    live.textContent = '';
    setTimeout(() => (live.textContent = text), 50);
  };

  /** read `text` out loud with the browser's own voice, cutting off the last one */
  const speak = (text: string) => {
    console.log('[esr] speak:', text);
    speechSynthesis.cancel();
    if (text) speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  };

  /** a short visible message, only for loading and errors */
  const showStatus = (text: string) => {
    status.textContent = text;
    status.style.display = text ? 'block' : 'none';
  };

  /** the box: the union of the section's elements on screen */
  const place = () => {
    const s = sections[current];
    const rects = s
      ? elementsOf(s.item)
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 || r.height > 0)
      : [];
    if (!on || rects.length === 0) {
      box.style.display = 'none';
      return;
    }
    const top = Math.min(...rects.map((r) => r.top)) - 4;
    const left = Math.min(...rects.map((r) => r.left)) - 4;
    const bottom = Math.max(...rects.map((r) => r.bottom)) + 4;
    const right = Math.max(...rects.map((r) => r.right)) + 4;
    Object.assign(box.style, {
      display: 'block',
      top: `${top}px`,
      left: `${left}px`,
      width: `${right - left}px`,
      height: `${bottom - top}px`,
    });
  };

  let frame = 0;
  const onViewportChange = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(place);
  };

  // ---------------------------------------------------------------------------
  // moving
  // ---------------------------------------------------------------------------

  /**
   * focus `el` without scrolling. elements that can't take focus get a
   * tabindex of -1 just while they have it (it's gone again on blur), so the
   * page is left as it was
   */
  const focus = (el: HTMLElement) => {
    if (!el.matches(FOCUSABLE) && !el.hasAttribute('tabindex')) {
      el.setAttribute('tabindex', '-1');
      el.addEventListener('blur', () => el.removeAttribute('tabindex'), { once: true });
    }
    el.focus({ preventScroll: true });
  };

  const go = (i: number) => {
    const s = sections[i];
    if (!s) return;
    current = i;
    const it = s.item;

    const title = it.titleId === undefined ? undefined : elements.get(it.titleId);
    const target = (title?.isConnected ? title : elementsOf(it)[0]) as HTMLElement | undefined;
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (target) focus(target);
    place();
    // smooth scrolling moves the element after we measured it. content that
    // is visibility: hidden until it scrolls in can't take focus yet, so try
    // again once it's on screen
    setTimeout(() => {
      place();
      if (target && current === i && document.activeElement !== target) focus(target);
    }, 600);

    // the screen reader reads the focused title itself; add only what it
    // can't know. if focus didn't land on the title, say the name too
    const where = `${i + 1} of ${sections.length} sections`;
    const titled = target === title && it.label && document.activeElement === target;
    const named = it.label ? `${it.label}, ${it.role}` : it.role;
    announce(`${titled ? it.role : named}, ${where}`);
    // and read the title out loud, for when no screen reader is running
    speak(sectionName(it));
  };

  /** analyze the page if we haven't yet; false if there's nothing to move to */
  const ready = async () => {
    if (!loading) loading = load();
    await loading;
    return sections.length > 0;
  };

  const move = async (step: 1 | -1) => {
    if (!on) start();
    if (!(await ready())) return;
    const next = current + step;
    if (next < 0) announce('first section');
    else if (next >= sections.length) announce('last section');
    else go(next);
  };

  const onKey = (e: KeyboardEvent) => {
    // alt+shift+arrows are handled in the content script, on or off
    if (e.altKey || e.ctrlKey || e.metaKey || !sections.length) return;
    let handled = true;
    if (e.key === 'Escape' || e.key === 'Enter') stop();
    else if (e.key === 'ArrowDown') void move(1);
    else if (e.key === 'ArrowUp') void move(-1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(sections.length - 1);
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // ---------------------------------------------------------------------------
  // on / off
  // ---------------------------------------------------------------------------

  const load = async () => {
    showStatus('Finding sections…');
    announce('Finding sections');
    try {
      const { tree, jevCalls, ms } = await analyze();
      const root = visible(buildNav(tree, document.title));
      sections = root ? sectionsOf(root) : [];
      console.log('[esr] sections ready', { sections: sections.length, jevCalls, ms });
      showStatus('');
      if (!sections.length) announce('No sections found on this page');
    } catch (e) {
      showStatus("Couldn't find sections on this page");
      announce("Couldn't find sections on this page");
      console.warn('[esr] analysis failed', e);
      loading = null;
    }
  };

  const start = () => {
    if (on) return;
    on = true;
    if (!host) mount();
    host!.style.display = '';
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onViewportChange, { capture: true, passive: true });
    window.addEventListener('resize', onViewportChange);
  };

  const stop = () => {
    on = false;
    speechSynthesis.cancel();
    showStatus('');
    place();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onViewportChange, { capture: true });
    window.removeEventListener('resize', onViewportChange);
    if (sections.length) announce('Section mode off');
  };

  /** alt+shift+n: on (going to the current or first section) or off */
  const toggle = async () => {
    if (on) return stop();
    start();
    if (await ready()) go(Math.max(current, 0));
  };

  return {
    toggle,
    next: () => move(1),
    previous: () => move(-1),
    isOn: () => on,
  };
};
