/** a simplified version of what appears in the DOM. */
interface RealElement {
  /** a reference to the real DOM element */
  element: HTMLElement;

  /** children of said RealElement, as RealElements */
  children: RealElement[];
  /** parent as a RealElement */
  parent: RealElement | null;

  /** the tag name of the element */
  tag: string;
  /** the text content of the element */
  text: string;

  /** the aria label of the element */
  ariaLabel?: string;
  /** the aria role of the element */
  ariaRole?: string;
}

/**
 * a `RealElement` enriched with additional accessibility information coming
 * from jevving it.
 *
 * As an example, a `RealElement` representing this HTML:
 * ```
 * div
 *  span: font-bold, "Hello world"
 *  div: border-b
 *  form
 *    div
 *      span: "Name"
 *      input
 *    button: "Submit"
 * ```
 *
 * can be enriched with the information that: "Name" span is labeling the
 * input, and that the button is a submit button, that "Hello world" is a
 * heading, etc. This creates the virtual tree:
 *
 * ```
 * <main content>
 *  <h1>Hello world</h1>
 *  <hr>
 *  <form>
 *    <label for="name">Name</label>
 *    <input id="name" />
 *    <button type="submit">Submit</button>
 * ```
 *
 * With this virtual tree, we can then navigate the DOM in a more meaninful
 * way, answering questions like "what is the label for this input?".
 */
interface VirtualElement { }
