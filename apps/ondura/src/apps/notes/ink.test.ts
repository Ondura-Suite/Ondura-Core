// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { inkBands, inkSvg, multipartParts, parseInk, traceValues } from "./ink";
import { diffBlocks, isEmbed, parsePage, readPageResponse } from "./onenote";
import { cleanEmbed } from "./editor";

const INK = `<inkml:ink xmlns:emma="http://www.w3.org/2003/04/emma" xmlns:msink="http://schemas.microsoft.com/ink/2010/main" xmlns:inkml="http://www.w3.org/2003/InkML">
 <inkml:definitions>
  <inkml:context xml:id="ctxCoordinatesWithPressure">
   <inkml:inkSource xml:id="inkSrcCoordinatesWithPressure">
    <inkml:traceFormat>
     <inkml:channel name="X" type="integer" max="32767" units="himetric"/>
     <inkml:channel name="Y" type="integer" max="32767" units="himetric"/>
     <inkml:channel name="F" type="integer" max="32767" units="dev"/>
    </inkml:traceFormat>
   </inkml:inkSource>
  </inkml:context>
  <inkml:brush xml:id="br0">
   <inkml:brushProperty name="width" value="100" units="himetric"/>
   <inkml:brushProperty name="color" value="#0000FF"/>
   <inkml:brushProperty name="transparency" value="0"/>
   <inkml:brushProperty name="rasterOp" value="copyPen"/>
  </inkml:brush>
  <inkml:brush xml:id="br1">
   <inkml:brushProperty name="width" value="400" units="himetric"/>
   <inkml:brushProperty name="color" value="#FFFF00"/>
   <inkml:brushProperty name="rasterOp" value="maskPen"/>
  </inkml:brush>
  <inkml:brush xml:id="br2">
   <inkml:brushProperty name="width" value="50" units="himetric"/>
   <inkml:brushProperty name="color" value="#000000"/>
  </inkml:brush>
 </inkml:definitions>
 <inkml:traceGroup>
  <inkml:trace xml:id="st0" contextRef="#ctxCoordinatesWithPressure" brushRef="#br0">3000 4000 100, 3100 4050 120, 3200 4100 90</inkml:trace>
  <inkml:trace xml:id="st1" contextRef="#ctxCoordinatesWithPressure" brushRef="#br1">3000 4500 0, 6000 4500 0</inkml:trace>
  <inkml:trace xml:id="st2" contextRef="#ctxCoordinatesWithPressure" brushRef="#br2">3000 20000 0</inkml:trace>
 </inkml:traceGroup>
</inkml:ink>`;

describe("OneNote ink", () => {
  it("reads strokes with their brushes", () => {
    const strokes = parseInk(INK);
    expect(strokes).toHaveLength(3);
    expect(strokes[0]).toMatchObject({ color: "#0000FF", width: 100, opacity: 1, highlighter: false });
    expect(strokes[0].points).toEqual([
      [3000, 4000],
      [3100, 4050],
      [3200, 4100],
    ]);
    expect(strokes[1]).toMatchObject({ color: "#FFFF00", highlighter: true });
    expect(strokes[1].opacity).toBeLessThan(1);
  });

  it("decodes InkML difference coding", () => {
    expect(traceValues("10 20, '1 '2, 1 2, \"0 \"0, !5 !5", 2)).toEqual([
      [10, 20],
      [11, 22],
      [12, 24],
      [13, 26],
      [5, 5],
    ]);
  });

  it("groups strokes into vertical bands and draws them as SVG", () => {
    const strokes = parseInk(INK);
    const bands = inkBands(strokes);
    expect(bands.map((b) => b.length)).toEqual([2, 1]);
    const svg = inkSvg(bands[0]);
    expect(svg).toContain('stroke="#0000FF"');
    // The highlighter is drawn first (underneath).
    expect(svg.indexOf("#FFFF00")).toBeLessThan(svg.indexOf("#0000FF"));
    // Black ink follows the text colour (dark mode).
    expect(inkSvg(bands[1])).toContain('stroke="currentColor"');
    // A single point becomes a dot.
    expect(inkSvg(bands[1])).toContain("l0 0");
  });

  it("splits the multipart page answer", () => {
    const body = `--b1\r\nContent-Type: text/html\r\nContent-Disposition: form-data; name=presentation\r\n\r\n<html><body><div style="top:600px"><p id="p:{a}{1}">Text unten</p></div></body></html>\r\n--b1\r\nContent-Type: application/inkml+xml\r\n\r\n${INK}\r\n--b1--\r\n`;
    expect(multipartParts(body, 'multipart/form-data; boundary="b1"')?.map((p) => p.type)).toEqual(["text/html", "application/inkml+xml"]);
    const page = readPageResponse(body, "multipart/form-data; boundary=b1");
    // Ink (around 150 px) comes before the text at 600 px, then the dot (≈ 756 px).
    expect(page.blocks.map((b) => (isEmbed(b.html) ? "ink" : b.id))).toEqual(["ink", "p:{a}{1}", "ink"]);
    // Plain HTML answers still work.
    expect(readPageResponse('<html><body><div><p id="p:{a}{2}">x</p></div></body></html>', "text/html").blocks).toHaveLength(1);
  });
});

describe("OneNote content Ondura cannot edit", () => {
  const PAGE = `<html><head><title>Mix</title></head><body>
<div id="div:{a}{1}" style="position:absolute;left:48px;top:120px">
  <p id="p:{a}{2}">Absatz</p>
  Lose <span>Zeile</span><br />
  <object id="object:{a}{3}" data="https://graph.microsoft.com/v1.0/me/onenote/resources/1/$value" data-attachment="Plan.pdf" type="application/pdf"></object>
  <iframe id="iframe:{a}{4}" data-original-src="https://www.youtube.com/watch?v=x" src="https://www.youtube.com/embed/x"></iframe>
</div></body></html>`;

  it("keeps attachments, videos and loose text as read-only blocks", () => {
    const blocks = parsePage(PAGE).blocks;
    expect(blocks.map((b) => (isEmbed(b.html) ? /data-one-embed="(\w+)"/.exec(b.html)![1] : "edit"))).toEqual(["edit", "text", "file", "video"]);
    expect(blocks[1].html).toContain("Lose Zeile");
    expect(blocks[2].html).toContain('data-name="Plan.pdf"');
    expect(blocks[3].html).toContain('data-src="https://www.youtube.com/watch?v=x"');
  });

  it("never writes or removes read-only blocks", () => {
    const before = parsePage(PAGE).blocks;
    // The user deleted the attachment and the loose text and added a paragraph after the video.
    const after = [
      { id: "p:{a}{2}", html: before[0].html },
      { id: "iframe:{a}{4}", html: before[3].html },
      { id: null, html: "<p>Neu</p>" },
    ];
    expect(diffBlocks(before, after, "Mix", "Mix")).toEqual([{ target: "iframe:{a}{4}", action: "insert", position: "after", content: "<p>Neu</p>" }]);
  });

  it("strips anything Ondura did not generate from embed HTML", () => {
    const html = cleanEmbed('<img src=x onerror="alert(1)">Text<svg viewBox="0 0 1 1" onload="x()"><path d="M0 0" stroke="red" style="color:red"/></svg><script>bad()</script>');
    expect(html).not.toMatch(/onerror|onload|<img|<script|style=/);
    expect(html).toContain("Text");
    expect(html).toContain('d="M0 0"');
  });
});

describe("Embeds in the editor", () => {
  it("keeps read-only blocks as atoms that round-trip unchanged", async () => {
    const { Editor } = await import("@tiptap/core");
    const { noteExtensions, editorBlocks } = await import("./editor");
    const strokes = parseInk(INK);
    const page = parsePage(`<html><body><div style="top:900px"><p id="p:{a}{1}">Hallo</p><object id="object:{a}{3}" data="https://graph.microsoft.com/x/$value" data-attachment="Plan.pdf"></object></div></body></html>`, strokes);
    const editor = new Editor({ extensions: noteExtensions(), content: page.blocks.map((b) => b.html).join("") });
    const blocks = editorBlocks(editor as never);
    expect(blocks.map((b) => (isEmbed(b.html) ? "embed" : b.id))).toEqual(["embed", "embed", "p:{a}{1}", "embed"]);
    expect(blocks[0].html).toContain("<path");
    expect(blocks[3].html).toContain('data-name="Plan.pdf"');
    expect(blocks[3].id).toBe("object:{a}{3}");
    // Nothing to write after loading.
    const base = blocks.filter((b) => b.id).map((b) => ({ id: b.id!, html: b.html }));
    expect(diffBlocks(base, editorBlocks(editor as never), "", "")).toEqual([]);
    // Stored HTML (local notebooks) parses back to the same blocks.
    const again = new Editor({ extensions: noteExtensions(), content: editor.getHTML() });
    expect(editorBlocks(again as never).map((b) => b.html)).toEqual(blocks.map((b) => b.html));
    editor.destroy();
    again.destroy();
  });
});
