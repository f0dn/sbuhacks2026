import { choice, score, TypeSafeClient } from "@typesafe-ai/sdk";
import "dotenv/config";

const run = async () => {
  const elementOfInterest = `
<span
data-type-speed="25"
data-loop="false"
class="kt-typed-text"
>WASTE DATA &amp;
ANALYSIS&nbsp;CENTER</span
`;

  const state = `

                                <div class="kt-inside-inner-col">
                                  <div
                                    class="wp-block-kadence-column kadence-column8_f81250-eb"
                                  >
                                    <div class="kt-inside-inner-col">
                                      <h2
                                        class="kt-adv-heading8_95cafc-0c wp-block-kadence-advancedheading"
                                        data-kb-block="kb-adv-heading8_95cafc-0c"
                                      >
                                        <strong
                                          ><span
                                            data-type-speed="25"
                                            data-loop="false"
                                            class="kt-typed-text"
                                            >WASTE DATA &amp;
                                            ANALYSIS&nbsp;CENTER</span
                                          ><span
                                            class="typed-cursor typed-cursor--blink"
                                            aria-hidden="true"
                                            >_</span
                                          ><span
                                            class="kt-typed-text-sr-only"
                                            aria-live="polite"
                                            aria-atomic="true"
                                            style="
                                              position: absolute;
                                              width: 1px;
                                              height: 1px;
                                              padding: 0px;
                                              margin: -1px;
                                              overflow: hidden;
                                              clip: rect(0px, 0px, 0px, 0px);
                                              white-space: nowrap;
                                              border-width: 0px;
                                            "
                                            >WASTE DATA &amp;
                                            ANALYSIS&nbsp;CENTER</span
                                          ></strong
                                        >
                                      </h2>

                                      <p
                                        class="kt-adv-heading8_aeeb7a-55 wp-block-kadence-advancedheading has-theme-palette-3-color has-text-color"
                                        data-kb-block="kb-adv-heading8_aeeb7a-55"
                                      >
                                        A Stony Brook University research center
                                        dedicated to advancing sustainable waste
                                        management practices in New York State
                                        through data-driven insights
                                      </p>
                                    </div>
                                  </div>

Element of interest:\n${elementOfInterest}`;

  const client = new TypeSafeClient({ defaultModel: "jev-latest" });
  const response = await client.systemOne({
    state,
    questions: {
      element: choice("What type of element is the element of interest?", {
        paragraph:
          "A paragraph of text. Used to description or explaining something.",
        heading: "A heading or title. Used to introduce a section.",
        list: "A list of items. Used to present information in a structured way.",
        link: "A hyperlink. Used to navigate to another page or resource.",
        image: "An image. Used to visually represent something.",
        button: "A button. Used to trigger an action or event.",
        container: "A container. Used to group other elements together.",
      }),
      is_important: score(
        "How important is this element to the overall content of the page?",
        ["Not important at all", "Somewhat important", "Very important"],
      ),
    },
  });

  console.log(response.answers);
};

run();
