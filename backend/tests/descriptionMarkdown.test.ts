import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../src/services/descriptionMarkdown";
import { cleanThingiverseMarkdown } from "../src/providers/thingiverse/markdown";

describe("htmlToMarkdown", () => {
  it("keeps headings, emphasis, lists and step images from a MakerWorld summary", () => {
    const html =
      "<h2>Excavator Lamp</h2><boostme><boosttitle>Boost Me</boosttitle><boostcontent>A boost will really support my hobby!</boostcontent></boostme>" +
      "<ul><li><strong>No supports needed.</strong></li></ul>" +
      '<h3>STEP 1:</h3><figure class="image image_resized" style="width: 81.93%"><img src="https://makerworld.bblmw.com/a.jpg"></figure>' +
      '<p>&nbsp;</p><figure class="image"><img src="https://makerworld.bblmw.com/b.gif"></figure>';
    expect(htmlToMarkdown(html)).toBe(
      [
        "## Excavator Lamp",
        "",
        "- **No supports needed.**",
        "",
        "### STEP 1:",
        "",
        "![](https://makerworld.bblmw.com/a.jpg)",
        "",
        "![](https://makerworld.bblmw.com/b.gif)",
      ].join("\n"),
    );
  });

  it("keeps links and drops images that aren't absolute http(s) URLs", () => {
    const html =
      '<p>See <a href="https://example.com/guide">the guide</a>.</p><img src="data:image/png;base64,AAAA"><img src="//media.printables.com/x.jpg" alt="Side view">';
    expect(htmlToMarkdown(html)).toBe(
      "See [the guide](https://example.com/guide).\n\n![Side view](https://media.printables.com/x.jpg)",
    );
  });

  it("writes compact list markers, numbering ordered lists from their start", () => {
    expect(htmlToMarkdown('<ol start="3"><li>Print</li><li>Glue<ul><li>Let it dry</li></ul></li></ol>')).toBe(
      "3. Print\n4. Glue\n   - Let it dry",
    );
  });

  it("turns a data table without a header row into a Markdown table", () => {
    const html =
      "<table><colgroup><col></colgroup><tbody>" +
      "<tr><td><p><strong>Plate #</strong></p></td><td><p><strong>Part</strong></p></td></tr>" +
      "<tr><td><p>1</p></td><td><p>Main Hexa</p><p>5 magnets | strong</p></td></tr>" +
      "<tr><td>2</td></tr>" +
      "</tbody></table>";
    expect(htmlToMarkdown(html)).toBe(
      ["| **Plate #** | **Part** |", "| --- | --- |", "| 1 | Main Hexa 5 magnets \\| strong |", "| 2 |  |"].join("\n"),
    );
  });

  it("unrolls a layout table into its cells' content", () => {
    const html =
      '<table><tbody><tr><td><p><i>Added covers:</i></p><ul><li><a href="https://makerworld.com/m/1">Lisbon</a></li></ul></td>' +
      '<td><img src="https://makerworld.bblmw.com/c.png"></td></tr></tbody></table>';
    expect(htmlToMarkdown(html)).toBe(
      "*Added covers:*\n\n- [Lisbon](https://makerworld.com/m/1)\n\n![](https://makerworld.bblmw.com/c.png)",
    );
  });

  it("is null for an empty description", () => {
    expect(htmlToMarkdown("<p>&nbsp;</p>")).toBeNull();
  });
});

describe("cleanThingiverseMarkdown", () => {
  it("leaves plain Markdown alone", () => {
    expect(cleanThingiverseMarkdown("# Title\n\nA **flexible** dragon.\nSecond line.")).toBe(
      "# Title\n\nA **flexible** dragon.\nSecond line.",
    );
  });

  it("maps inline HTML onto Markdown without losing line breaks", () => {
    expect(
      cleanThingiverseMarkdown(
        'Line one<br>Line <b>two</b>\n<img src="https://cdn.thingiverse.com/a.jpg">\n<a href="https://x.com">x</a> &amp; <span>y</span>',
      ),
    ).toBe("Line one\nLine **two**\n![](https://cdn.thingiverse.com/a.jpg)\n[x](https://x.com) & y");
  });
});
