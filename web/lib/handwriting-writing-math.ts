import type { AbstractMmlNode, AbstractMmlTokenNode, MmlNode, TextNode } from "mathjax-full/js/core/MmlTree/MmlNode.js";
import { invisibleMath, scaleInsets, type WritingGlyph, type WritingSettings } from "./handwriting-writing.ts";

const isToken = (node: MmlNode) => ["mi", "mn", "mo", "mtext"].includes(node.kind);
const text = (node: MmlNode) => isToken(node) ? (node as AbstractMmlTokenNode).getText().replace(invisibleMath, "") : "";

/** Grow MathML metrics before SVG layout, so fractions, roots, scripts and
 * tables all reflow through MathJax. Each medoid is one spacing unit. */
export function applyMathMargins(root: AbstractMmlNode, aliases: ReadonlyMap<string, WritingGlyph>, settings: WritingSettings) {
  const margin = scaleInsets(settings.margin);
  if (!Object.values(margin).some(Boolean)) return;
  const factory = root.factory;
  const em = (px: number) => `${px / settings.size}em`;
  const wrap = (node: MmlNode): MmlNode => factory.create("mpadded", {
    ...(margin.left + margin.right ? { width: `+${em(margin.left + margin.right)}` } : {}),
    ...(margin.top ? { height: `+${em(margin.top)}` } : {}), ...(margin.bottom ? { depth: `+${em(margin.bottom)}` } : {}),
    lspace: em(margin.left), "data-writing-unit": "true",
  }, [node]);
  const transform = (node: MmlNode): MmlNode => {
    if (["mphantom", "merror", "annotation", "annotation-xml"].includes(node.kind)) return node;
    if (isToken(node)) {
      const value = text(node);
      if (!value.trim()) return node;
      if (node.kind === "mo" || Array.from(value).length === 1 || aliases.has(value)) return wrap(node);
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
      if (["mrow", "inferredMrow"].includes(node.kind) && joined) {
        for (let j = i + 1; j < Math.min(children.length, i + 8); j++) {
          const value = text(children[j]);
          if (!value || !isToken(children[j])) break;
          joined += value;
          if (aliases.has(joined)) end = j;
        }
      }
      if (end > i) { next.push(wrap(factory.create("mrow", {}, children.slice(i, end + 1)))); i = end; }
      else next.push(transform(children[i]));
    }
    node.setChildren(next);
    return node;
  };
  transform(root);
  root.setInheritedAttributes({}, root.attributes.get("display") === "block", 0, false);
}
