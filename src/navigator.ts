// the screen-reader-style navigator: a panel (in its own shadow root, so the
// page's CSS can't reach it) that walks the outline from src/vdom/nav.ts, reads
// each item aloud with speechSynthesis, and draws a highlight box over the
// matching part of the page. it never changes the page's own elements.
//
// keys (while the panel has focus):
//   down / up        next / previous item, in reading order
//   right / left     into a group / back out to its parent
//   h g d k b f l    next heading, group, landmark, link, button, field, list
//                    (with shift: previous)
//   1-6              next heading of that level
//   enter            follow the link, press the button, or focus the field
//   space            read everything from here (any key stops)
//   s                speech on/off
//   escape           close

import { buildNav, speakable, type NavItem, type NavKind } from './vdom/nav.js';
import type { GroupedNode } from './vdom/types.js';

export type NavigatorOptions = {
  /** node id -> live element, filled by `parse` */
  elements: Map<number, Element>;
  /** parse the page and run the passes; resolves to the grouped tree */
  analyze: () => Promise<{ tree: GroupedNode; jevCalls: number; ms: number }>;
};

/** an outline item in reading order, with where it sits */
type Row = { item: NavItem; depth: number; parent: number | null };

const JUMP_KEYS: Record<string, { kinds: NavKind[]; name: string }> = {
  h: { kinds: ['heading'], name: 'heading' },
  g: { kinds: ['group'], name: 'group' },
  d: { kinds: ['landmark'], name: 'landmark' },
  k: { kinds: ['link'], name: 'link' },
  b: { kinds: ['button'], name: 'button' },
  f: { kinds: ['field'], name: 'form field' },
  l: { kinds: ['list'], name: 'list' },
};

/** items whose name is their text */
const TEXT_KINDS = new Set<NavKind>(['heading', 'link', 'button', 'text']);

const INPUT_ROLES: Record<string, string> = {
  checkbox: 'checkbox',
  radio: 'radio button',
  submit: 'button',
  button: 'button',
  reset: 'button',
  range: 'slider',
  search: 'search field',
};

const STYLE = `
  :host { all: initial; }
  .panel {
    position: fixed; top: 16px; right: 16px; bottom: 16px; width: 360px;
    display: flex; flex-direction: column; z-index: 2147483647;
    background: #14161a; color: #f2f2f2; border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,.45);
    font: 14px/1.4 system-ui, -apple-system, sans-serif; overflow: hidden;
  }
  .panel:focus { outline: 3px solid #ffbf00; outline-offset: 2px; }
  header { padding: 12px 14px 8px; border-bottom: 1px solid #2a2d33; }
  h1 { margin: 0; font-size: 15px; font-weight: 600; }
  .status { margin-top: 2px; color: #9aa0a6; font-size: 12px; }
  .now {
    padding: 12px 14px; font-size: 18px; font-weight: 500; min-height: 3em;
    border-bottom: 1px solid #2a2d33; overflow-wrap: anywhere;
  }
  .now .role { display: block; margin-top: 4px; color: #ffbf00; font-size: 13px; }
  ul { list-style: none; margin: 0; padding: 6px 0; overflow: auto; flex: 1; }
  li {
    padding: 3px 14px; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; color: #c9ccd1; cursor: pointer;
  }
  li .role { color: #7d838b; }
  li.current { background: #ffbf00; color: #14161a; }
  li.current .role { color: #3a3000; }
  footer { padding: 8px 14px; border-top: 1px solid #2a2d33; color: #9aa0a6; font-size: 12px; }
  kbd {
    font: 11px ui-monospace, monospace; padding: 0 4px; border-radius: 3px;
    background: #2a2d33; color: #f2f2f2;
  }
  .highlight {
    position: fixed; pointer-events: none; z-index: 2147483646; display: none;
    border: 3px solid #ffbf00; border-radius: 6px;
    background: rgba(255,191,0,.12); box-shadow: 0 0 0 4px rgba(0,0,0,.35);
    transition: all .12s ease-out;
  }
`;

export const createNavigator = ({ elements, analyze }: NavigatorOptions) => {
  let host: HTMLElement | null = null;
  let panel!: HTMLElement;
  let list!: HTMLUListElement;
  let now!: HTMLElement;
  let status!: HTMLElement;
  let highlight!: HTMLElement;

  let rows: Row[] = [];
  let current = 0;
  let loading: Promise<void> | null = null;
  let speech = true;
  let sayingAll = false;
  let returnFocus: Element | null = null;

  // ---------------------------------------------------------------------------
  // speech
  // ---------------------------------------------------------------------------

  const stopSpeech = () => {
    sayingAll = false;
    speechSynthesis.cancel();
  };

  const say = (text: string, onDone?: () => void) => {
    console.log('[esr] say:', text);
    speechSynthesis.cancel();
    if (!speech || !text) return onDone?.();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.15;
    if (onDone) u.onend = () => onDone();
    speechSynthesis.speak(u);
  };

  // ---------------------------------------------------------------------------
  // the outline, from the live page
  // ---------------------------------------------------------------------------

  const elementsOf = (it: NavItem) =>
    it.elementIds
      .map((id) => elements.get(id))
      .filter((el): el is Element => !!el && el.isConnected);

  /** what only the live page knows: alt text, field labels, input types */
  const fillFromPage = (it: NavItem) => {
    const el = elements.get(it.id);
    if (!el) return;
    // text that was still being typed in by an animation when we parsed
    if (!it.label && TEXT_KINDS.has(it.kind))
      it.label = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (it.kind === 'image' && !it.label)
      it.label = el.getAttribute('alt') || el.getAttribute('title') || '';
    if (it.kind === 'field') {
      const input = el as HTMLInputElement;
      if (el.tagName === 'INPUT') it.role = INPUT_ROLES[input.type] ?? 'edit field';
      if (!it.label)
        it.label =
          [...(input.labels ?? [])].map((l) => l.textContent?.trim()).join(' ') ||
          input.placeholder ||
          el.getAttribute('title') ||
          input.name ||
          '';
    }
    if (it.kind === 'button' && !it.label)
      it.label = el.getAttribute('title') || (el as HTMLElement).innerText.trim();
  };

  /**
   * drop what isn't rendered (display: none menus etc.), like a screen reader.
   * visibility: hidden is kept: pages use it for scroll-in animations, and
   * that content is real
   */
  const visible = (it: NavItem): NavItem | null => {
    const els = elementsOf(it);
    if (els.length && !els.some((el) => el.checkVisibility())) return null;
    fillFromPage(it);
    it.children = it.children.map(visible).filter((c): c is NavItem => c !== null);
    const empty = it.children.length === 0 && !it.label;
    return empty && it.kind !== 'page' && it.kind !== 'field' ? null : it;
  };

  const flatten = (it: NavItem, depth: number, parent: number | null) => {
    const i = rows.length;
    rows.push({ item: it, depth, parent });
    for (const c of it.children) flatten(c, depth + 1, i);
  };

  // ---------------------------------------------------------------------------
  // rendering
  // ---------------------------------------------------------------------------

  const mount = () => {
    host = document.createElement('esr-navigator');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${STYLE}</style>
      <div class="highlight"></div>
      <section class="panel" tabindex="0" role="application" aria-label="Page navigator">
        <header><h1>Page navigator</h1><div class="status"></div></header>
        <div class="now" aria-live="polite"></div>
        <ul></ul>
        <footer>
          <kbd>↑</kbd><kbd>↓</kbd> move · <kbd>→</kbd><kbd>←</kbd> in/out ·
          <kbd>H</kbd> heading · <kbd>G</kbd> group · <kbd>D</kbd> landmark ·
          <kbd>K</kbd> link · <kbd>F</kbd> field · <kbd>Enter</kbd> activate ·
          <kbd>Space</kbd> read all · <kbd>S</kbd> speech · <kbd>Esc</kbd> close
        </footer>
      </section>`;
    panel = shadow.querySelector('.panel')!;
    list = shadow.querySelector('ul')!;
    now = shadow.querySelector('.now')!;
    status = shadow.querySelector('.status')!;
    highlight = shadow.querySelector('.highlight')!;

    panel.addEventListener('keydown', onKey);
    list.addEventListener('click', (e) => {
      const li = (e.target as Element).closest('li');
      if (li) select(Number(li.dataset.index));
    });
    document.documentElement.append(host);
  };

  const renderList = () => {
    list.replaceChildren(
      ...rows.map((r, i) => {
        const li = document.createElement('li');
        li.dataset.index = String(i);
        li.style.paddingLeft = `${14 + r.depth * 14}px`;
        li.append(r.item.label || '');
        const role = document.createElement('span');
        role.className = 'role';
        role.textContent = `${r.item.label ? ' · ' : ''}${r.item.role}`;
        li.append(role);
        return li;
      }),
    );
  };

  /** the highlight box: the union of the item's elements on screen */
  const placeHighlight = () => {
    const row = rows[current];
    const rects = row
      ? elementsOf(row.item)
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 || r.height > 0)
      : [];
    if (rows[current]?.item.kind === 'page' || rects.length === 0) {
      highlight.style.display = 'none';
      return;
    }
    const top = Math.min(...rects.map((r) => r.top));
    const left = Math.min(...rects.map((r) => r.left));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    const right = Math.max(...rects.map((r) => r.right));
    Object.assign(highlight.style, {
      display: 'block',
      top: `${top - 4}px`,
      left: `${left - 4}px`,
      width: `${right - left + 8}px`,
      height: `${bottom - top + 8}px`,
    });
  };

  let frame = 0;
  const onViewportChange = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(placeHighlight);
  };

  const select = (i: number, speak = true) => {
    const row = rows[i];
    if (!row) return;
    list.children[current]?.classList.remove('current');
    current = i;
    const li = list.children[i] as HTMLElement | undefined;
    li?.classList.add('current');
    li?.scrollIntoView({ block: 'nearest' });

    const it = row.item;
    now.replaceChildren(it.label || '(no name)');
    const role = document.createElement('span');
    role.className = 'role';
    role.textContent = speakable(it).slice(it.label.length).replace(/^, /, '') || it.role;
    now.append(role);

    const target = elementsOf(it)[0];
    if (target && it.kind !== 'page')
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    placeHighlight();
    // smooth scrolling moves the element after we measured it
    setTimeout(placeHighlight, 400);
    if (speak) say(speakable(it));
  };

  // ---------------------------------------------------------------------------
  // moving around
  // ---------------------------------------------------------------------------

  const jump = (match: (it: NavItem) => boolean, dir: 1 | -1, name: string) => {
    for (let i = current + dir; i >= 0 && i < rows.length; i += dir)
      if (match(rows[i]!.item)) return select(i);
    say(`no ${dir > 0 ? 'more' : 'previous'} ${name}s`);
  };

  const activate = () => {
    const it = rows[current]?.item;
    const el = it && (elementsOf(it)[0] as HTMLElement | undefined);
    if (!it || !el) return;
    if (it.kind === 'link' || it.kind === 'button') {
      say(it.kind === 'link' ? `following ${it.label}` : `pressing ${it.label}`);
      if (it.kind === 'link') close();
      el.click();
    } else if (it.kind === 'field') {
      close();
      el.focus();
    } else {
      say(speakable(it));
    }
  };

  /** read from the current item to the end; any key stops */
  const sayAll = () => {
    sayingAll = true;
    const step = (i: number) => {
      if (!sayingAll || i >= rows.length) return;
      select(i, false);
      say(speakable(rows[i]!.item), () => step(i + 1));
    };
    step(current);
  };

  const onKey = (e: KeyboardEvent) => {
    if (sayingAll) stopSpeech();
    const key = e.key.toLowerCase();
    const row = rows[current];
    let handled = true;

    if (e.key === 'Escape') close();
    else if (!row) handled = false;
    else if (e.key === 'ArrowDown')
      current + 1 < rows.length ? select(current + 1) : say('end of page');
    else if (e.key === 'ArrowUp') current > 0 ? select(current - 1) : say('top of page');
    else if (e.key === 'ArrowRight')
      row.item.children.length ? select(current + 1) : say('nothing inside');
    else if (e.key === 'ArrowLeft')
      row.parent !== null ? select(row.parent) : say('top of page');
    else if (e.key === 'Home') select(0);
    else if (e.key === 'End') select(rows.length - 1);
    else if (e.key === 'Enter') activate();
    else if (e.key === ' ') sayAll();
    else if (key === 's' && !e.shiftKey) {
      speech = !speech;
      say(speech ? 'speech on' : '');
      status.textContent = status.textContent!.replace(/ · speech (on|off)$/, '') +
        ` · speech ${speech ? 'on' : 'off'}`;
    } else if (/^[1-6]$/.test(e.key))
      jump((it) => it.role === `heading level ${e.key}`, 1, `level ${e.key} heading`);
    else if (JUMP_KEYS[key]) {
      const { kinds, name } = JUMP_KEYS[key];
      jump((it) => kinds.includes(it.kind), e.shiftKey ? -1 : 1, name);
    } else handled = false;

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // ---------------------------------------------------------------------------
  // open / close
  // ---------------------------------------------------------------------------

  const load = async () => {
    status.textContent = 'Analyzing page with Jev…';
    say('Analyzing page');
    try {
      const { tree, jevCalls, ms } = await analyze();
      const root = visible(buildNav(tree, document.title, { keepEmpty: true }))!;
      rows = [];
      flatten(root, 0, null);
      renderList();

      const count = (kind: NavKind) => rows.filter((r) => r.item.kind === kind).length;
      status.textContent =
        `${rows.length} items · ${jevCalls} Jev calls in ${(ms / 1000).toFixed(1)}s · ` +
        `speech ${speech ? 'on' : 'off'}`;
      select(0, false);
      say(
        `${document.title}. ${count('landmark')} landmarks, ${count('group')} groups, ` +
          `${count('heading')} headings, ${count('link')} links. Press down arrow to start.`,
      );
      console.log('[esr] navigator ready', { items: rows.length, jevCalls, ms });
    } catch (e) {
      status.textContent = `Couldn't analyze this page: ${e}`;
      say("Couldn't analyze this page");
      console.warn('[esr] analysis failed', e);
      loading = null;
    }
  };

  const open = () => {
    returnFocus = document.activeElement;
    if (!host) mount();
    host!.style.display = '';
    panel.focus();
    window.addEventListener('scroll', onViewportChange, { capture: true, passive: true });
    window.addEventListener('resize', onViewportChange);
    if (!loading) loading = load();
    else if (rows.length) select(current);
  };

  const close = () => {
    stopSpeech();
    if (host) host.style.display = 'none';
    window.removeEventListener('scroll', onViewportChange, { capture: true });
    window.removeEventListener('resize', onViewportChange);
    if (returnFocus instanceof HTMLElement) returnFocus.focus();
  };

  const isOpen = () => !!host && host.style.display !== 'none';

  return { open, close, toggle: () => (isOpen() ? close() : open()), isOpen };
};
