type RealElement = {
  el: Element;
  tag: string;
  ariaAttributes: string[];
  text: string;
  children: RealElement[];
};

export const parse = (root: Element): RealElement => {
  return {
    el: root,
    tag: root.tagName,
    ariaAttributes: root
      .getAttributeNames()
      .filter((attr) => attr.startsWith("aria"))
      .map(root.getAttribute)
      .filter((attr) => attr !== null),
    text: root.textContent,
    children:
      root.children.length > 0 ? [...root.children].map((el) => parse(el)) : [],
  };
};
