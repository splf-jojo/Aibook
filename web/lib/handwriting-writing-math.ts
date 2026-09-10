import type { AbstractMmlNode, AbstractMmlTokenNode, MmlNode, TextNode } from "mathjax-full/js/core/MmlTree/MmlNode.js";
import { invisibleMath, nativeGlyphLayout, scaleInsets, type WritingGlyph, type WritingSettings } from "./handwriting-writing.ts";

const isToken = (node: MmlNode) => ["mi", "mn", "mo", "mtext"].includes(node.kind);
const text = (node: MmlNode) => isToken(node) ? (node as AbstractMmlTokenNode).getText().replace(invisibleMath, "") : "";

/** Native source metrics participate in MathJax layout; legacy fonts keep their metrics. */
export function applyMathMargins(root: AbstractMmlNode, aliases: ReadonlyMap<string, WritingGlyph>, settings: WritingSettings, options: { preserveText?: boolean; native?: boolean } = {}) {
  const margin = scaleInsets(settings.margin);
  const factory = root.factory;
  const em = (px: number) => `${px / settings.size}em`;
  let nativeIndex = 0;
  const wrap = (node: MmlNode, label = text(node)): MmlNode => {
    const large = node.kind === "mo" && (node.attributes.get("largeop") || node.attributes.get("stretchy"));
    const glyph = options.native === false ? undefined : aliases.get(label);
    // Variable-height delimiters and radicals remain MathJax structures. Their
    // required size depends on the complete expression, not one source cell.
    const delimiter = /^[()[\]{}|√]$/.test(label) && node.kind === "mo" && node.attributes.get("stretchy");
    if (glyph?.metrics && !delimiter) {
      const index = nativeIndex++, n = nativeGlyphLayout(glyph, index, settings);
      return factory.create("mpadded", {
        width: em(n.advance), height: em(n.ascent + margin.top), depth: em(n.descent + margin.bottom),
        lspace: em(margin.left), "data-writing-unit": "true", "data-writing-native": String(index),
        "data-writing-text": label, "data-writing-cell": "native",
      }, [node]);
    }
    return factory.create("mpadded", {
      ...(margin.left + margin.right ? { width: `+${em(margin.left + margin.right)}` } : {}),
      ...(margin.top ? { height: `+${em(margin.top)}` } : {}),
      ...(margin.bottom ? { depth: `+${em(margin.bottom)}` } : {}),
      lspace: em(margin.left), "data-writing-unit": "true", "data-writing-cell": large ? "ink" : "line",
      ...(glyph?.metrics && delimiter ? { "data-writing-structure": "true" } : {}),
    }, [node]);
  };
  const transform = (node: MmlNode): MmlNode => {
    if (["mphantom", "merror", "annotation", "annotation-xml"].includes(node.kind)) return node;
    // Canvas explanations remain one font run. Splitting mtext into individual
    // glyph cells would alter its kerning and mix prose with handwritten math.
    if (options.preserveText && node.kind === "mtext") return node;
    if (isToken(node)) {
      const value = text(node);
      if (!value.trim()) return node;
      if (node.kind === "mo" || Array.from(value).length === 1 || aliases.has(value)) return wrap(node);
      // Functions remain one font run whether or not margins are enabled.
      if (options.preserveText && node.kind === "mi") return wrap(node);
      // A number such as 123 must get three margins. Preserve the original
      // font variant when splitting a multi-letter upright token.
      const pieces = Array.from((node as AbstractMmlTokenNode).getText()).map((character) => {
        const copy = (node as AbstractMmlNode).copy();
        copy.attributes.set("mathvariant", node.attributes.get("mathvariant"));
        copy.setChildren([(factory.create("text") as TextNode).setText(character)]);
        return character.trim() ? wrap(copy) : copy;
      });
      return factory.create("mrow", {}, pieces);
    }
    // Variadic MathML containers own an inferred row. Reusing that same row
    // through setChildren would insert it into itself.
    if (node.arity < 0) { transform(node.childNodes[0] as MmlNode); return node; }
    const children = node.childNodes as MmlNode[], next: MmlNode[] = [];
    for (let i = 0; i < children.length; i++) {
      let end = i, joined = text(children[i]);
      // Join only adjacent atoms of one row, never across a script or fraction.
      if (["mrow", "inferredMrow"].includes(node.kind) && joined && !(options.preserveText && children[i].kind === "mtext")) {
        for (let j = i + 1; j < Math.min(children.length, i + 8); j++) {
          if (options.preserveText && children[j].kind === "mtext") break;
          const value = text(children[j]);
          if (!value || !isToken(children[j])) break;
          joined += value;
          if (aliases.has(joined)) end = j;
        }
      }
      if (end > i) { const grouped = children.slice(i, end + 1); next.push(wrap(factory.create("mrow", {}, grouped), grouped.map(text).join(""))); i = end; }
      else next.push(transform(children[i]));
    }
    node.setChildren(next);
    return node;
  };
  transform(root);
  // Mark whole baseline items for the SVG scatter pass. An x with its scripts,
  // a fraction, or a root is a single item; aligned-table cells have their own rows.
  let index = 0;
  const rows = new Set(["math", "mrow", "inferredMrow", "mstyle", "TeXAtom", "mtable", "mtr", "mlabeledtr", "mtd"]);
  const markScatter = (node: MmlNode) => {
    if (node.arity < 0) { markScatter(node.childNodes[0] as MmlNode); return; }
    node.setChildren((node.childNodes as MmlNode[]).map((child) => {
      if (rows.has(child.kind)) { markScatter(child); return child; }
      if ((isToken(child) && !text(child).trim()) || ["mspace", "mphantom", "annotation", "annotation-xml"].includes(child.kind)) return child;
      return factory.create("mpadded", { "data-writing-scatter": String(index++) }, [child]);
    }));
  };
  markScatter(root);
  root.setInheritedAttributes({}, root.attributes.get("display") === "block", 0, false);
}
