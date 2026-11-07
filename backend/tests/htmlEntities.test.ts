import { describe, expect, it } from "vitest";
import { escapeHtml, paragraphOf, textOfHtml } from "../src/utils/htmlEntities";

describe("HTML text", () => {
  it("writes every character HTML gives a meaning to as an entity", () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jo'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jo&#39;&lt;/a&gt;",
    );
  });

  it("reads back the text it wrote, line breaks and all", () => {
    const text = `Bin <v2> & "lid"\nfits Jo's shelf`;
    expect(paragraphOf(text)).toBe("<p>Bin &lt;v2&gt; &amp; &quot;lid&quot;<br>fits Jo&#39;s shelf</p>");
    expect(textOfHtml(paragraphOf(text))).toBe(text);
  });

  it("keeps paragraphs apart and drops tags, without reading an escaped one as a tag", () => {
    expect(textOfHtml("<p>One</p><p>Two &lt;b&gt;</p><script>x</script>")).toBe("One\n\nTwo <b>x");
  });
});
