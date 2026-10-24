type RealElement = {
  tag: string;
  ariaAttributes: string[];
  text: string;
  children: RealElement[];
};

export const parse = (root: Element): RealElement => {
  return {
    tag: root.tagName,
    ariaAttributes: root
      .getAttributeNames()
      .filter((attr) => attr.startsWith('aria'))
      .map((attr) => root.getAttribute(attr))
      .filter((attr) => attr !== null),
    text: root.textContent,
    children:
      root.children.length > 0 ? [...root.children].map((el) => parse(el)) : [],
  };
};
