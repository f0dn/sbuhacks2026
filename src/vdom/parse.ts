import type { ParsedNode } from './types.js';

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * turn the DOM under `root` into a `ParsedNode` tree. every element is also
 * recorded in `elements` under its node id, so later passes can find it.
 */
export const parse = (
  root: Element,
  elements: Map<number, Element> = new Map(),
): ParsedNode => {
  const id = elements.size;
  elements.set(id, root);

  return {
    id,
    tag: root.tagName,
    aria: Object.fromEntries(
      root
        .getAttributeNames()
        .filter((name) => name.startsWith('aria-') || name === 'role')
        .map((name) => [name, root.getAttribute(name) ?? '']),
    ),
    text: squash(
      [...root.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join(' '),
    ),
    children: [...root.children].map((el) => parse(el, elements)),
  };
};
