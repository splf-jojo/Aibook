from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import os
from pathlib import Path
from typing import Literal, TypeAlias

from PIL import ImageFont


LatexRole: TypeAlias = Literal[
    "ordinary", "binary", "relation", "delimiter", "function", "text"
]
AtomClass: TypeAlias = Literal[
    "ordinary", "binary", "relation", "operator", "delimiter", "space"
]
Node: TypeAlias = dict[str, object]
RenderObject: TypeAlias = dict[str, object]

MATH_FONT_FAMILY = '"Cambria Math", "STIX Two Math", "Times New Roman", serif'
LARGE_OPERATOR_FONT_FAMILY = (
    '"KaTeX_Size2", "Cambria Math", "STIX Two Math", "Times New Roman", serif'
)
LARGE_OPERATORS = {"∫", "∮", "∬", "∭", "∑", "∏"}
FUNCTION_COMMANDS = {
    "sin",
    "cos",
    "tan",
    "cot",
    "sec",
    "csc",
    "arcsin",
    "arccos",
    "arctan",
    "sinh",
    "cosh",
    "tanh",
    "ln",
    "log",
    "exp",
    "lim",
    "max",
    "min",
    "det",
}

COMMAND_SYMBOLS: dict[str, tuple[str, LatexRole]] = {
    "alpha": ("α", "ordinary"),
    "beta": ("β", "ordinary"),
    "gamma": ("γ", "ordinary"),
    "delta": ("δ", "ordinary"),
    "epsilon": ("ε", "ordinary"),
    "varepsilon": ("ϵ", "ordinary"),
    "zeta": ("ζ", "ordinary"),
    "eta": ("η", "ordinary"),
    "theta": ("θ", "ordinary"),
    "vartheta": ("ϑ", "ordinary"),
    "iota": ("ι", "ordinary"),
    "kappa": ("κ", "ordinary"),
    "lambda": ("λ", "ordinary"),
    "mu": ("μ", "ordinary"),
    "nu": ("ν", "ordinary"),
    "xi": ("ξ", "ordinary"),
    "pi": ("π", "ordinary"),
    "varpi": ("ϖ", "ordinary"),
    "rho": ("ρ", "ordinary"),
    "sigma": ("σ", "ordinary"),
    "tau": ("τ", "ordinary"),
    "upsilon": ("υ", "ordinary"),
    "phi": ("φ", "ordinary"),
    "varphi": ("ϕ", "ordinary"),
    "chi": ("χ", "ordinary"),
    "psi": ("ψ", "ordinary"),
    "omega": ("ω", "ordinary"),
    "Gamma": ("Γ", "ordinary"),
    "Delta": ("Δ", "ordinary"),
    "Theta": ("Θ", "ordinary"),
    "Lambda": ("Λ", "ordinary"),
    "Xi": ("Ξ", "ordinary"),
    "Pi": ("Π", "ordinary"),
    "Sigma": ("Σ", "ordinary"),
    "Phi": ("Φ", "ordinary"),
    "Psi": ("Ψ", "ordinary"),
    "Omega": ("Ω", "ordinary"),
    "infty": ("∞", "ordinary"),
    "partial": ("∂", "ordinary"),
    "nabla": ("∇", "ordinary"),
    "ell": ("ℓ", "ordinary"),
    "cdot": ("·", "binary"),
    "times": ("×", "binary"),
    "div": ("÷", "binary"),
    "pm": ("±", "binary"),
    "mp": ("∓", "binary"),
    "le": ("≤", "relation"),
    "leq": ("≤", "relation"),
    "ge": ("≥", "relation"),
    "geq": ("≥", "relation"),
    "neq": ("≠", "relation"),
    "approx": ("≈", "relation"),
    "equiv": ("≡", "relation"),
    "propto": ("∝", "relation"),
    "to": ("→", "relation"),
    "rightarrow": ("→", "relation"),
    "leftarrow": ("←", "relation"),
    "leftrightarrow": ("↔", "relation"),
    "Rightarrow": ("⇒", "relation"),
    "Leftrightarrow": ("⇔", "relation"),
    "cup": ("∪", "binary"),
    "cap": ("∩", "binary"),
    "subset": ("⊂", "relation"),
    "subseteq": ("⊆", "relation"),
    "supset": ("⊃", "relation"),
    "supseteq": ("⊇", "relation"),
    "in": ("∈", "relation"),
    "notin": ("∉", "relation"),
    "forall": ("∀", "ordinary"),
    "exists": ("∃", "ordinary"),
    "ldots": ("…", "ordinary"),
    "cdots": ("⋯", "ordinary"),
    "dots": ("…", "ordinary"),
}

DELIMITERS = {
    "(": "(",
    ")": ")",
    "[": "[",
    "]": "]",
    "|": "|",
    ".": "",
    "lbrace": "{",
    "rbrace": "}",
    "langle": "⟨",
    "rangle": "⟩",
    "vert": "|",
    "Vert": "‖",
}


class LatexParseError(ValueError):
    pass


class LatexParser:
    def __init__(self, source: str) -> None:
        self.source = source
        self.index = 0

    def parse(self) -> Node:
        result = self._parse_row()
        if self.index < len(self.source):
            raise LatexParseError(f"Unexpected token at position {self.index + 1}")
        return result

    def _parse_row(self, stop_at_brace: bool = False) -> Node:
        children: list[Node] = []
        while self.index < len(self.source):
            current = self.source[self.index]
            if current == "}":
                if stop_at_brace:
                    break
                raise LatexParseError(f"Unexpected }} at position {self.index + 1}")
            if current == "{":
                children.append(self._attach_scripts(self._parse_required_group()))
                continue
            if current in {"^", "_"}:
                raise LatexParseError(
                    f"Script {current} has no base at position {self.index + 1}"
                )
            if current.isspace():
                has_newline = False
                while self.index < len(self.source) and self.source[self.index].isspace():
                    has_newline = has_newline or self.source[self.index] == "\n"
                    self.index += 1
                if has_newline and children:
                    children.append({"type": "linebreak"})
                continue
            atom = self._parse_command() if current == "\\" else self._parse_character()
            if atom["type"] in {"space", "linebreak"}:
                children.append(atom)
            else:
                children.append(self._attach_scripts(atom))
        if len(children) == 1:
            return children[0]
        return {"type": "row", "children": children}

    def _parse_character(self) -> Node:
        value = self.source[self.index]
        self.index += 1
        if value == "&":
            return {"type": "space", "factor": 0.18}
        if value in {"+", "-", "−", "±", "·", "×"}:
            return {"type": "symbol", "value": value, "role": "binary"}
        if value in {"=", "<", ">", "≈", "≠"}:
            return {"type": "symbol", "value": value, "role": "relation"}
        if value in "()[]|":
            return {"type": "symbol", "value": value, "role": "delimiter"}
        return {"type": "symbol", "value": value, "role": "ordinary"}

    def _parse_command(self) -> Node:
        self.index += 1
        if self.index >= len(self.source):
            raise LatexParseError("Formula ends with an unfinished command")
        first = self.source[self.index]
        if first == "\\":
            self.index += 1
            return {"type": "linebreak"}
        if not first.isascii() or not first.isalpha():
            self.index += 1
            spaces = {",": 0.16, ";": 0.28, ":": 0.22, "!": -0.08}
            if first in spaces:
                return {"type": "space", "factor": spaces[first]}
            return {"type": "symbol", "value": first, "role": "ordinary"}

        start = self.index
        while (
            self.index < len(self.source)
            and self.source[self.index].isascii()
            and self.source[self.index].isalpha()
        ):
            self.index += 1
        command = self.source[start : self.index]

        if command in {"frac", "dfrac", "tfrac"}:
            return {
                "type": "fraction",
                "numerator": self._parse_required_group(),
                "denominator": self._parse_required_group(),
            }
        if command == "sqrt":
            self._skip_optional_bracket()
            return {"type": "root", "radicand": self._parse_required_group()}
        operators = {
            "int": "∫",
            "oint": "∮",
            "iint": "∬",
            "iiint": "∭",
            "sum": "∑",
            "prod": "∏",
        }
        if command in operators:
            return {"type": "operator", "value": operators[command]}
        if command in {"left", "right"}:
            return self._parse_delimiter()
        spaces = {"quad": 1.0, "qquad": 2.0, "enspace": 0.5}
        if command in spaces:
            return {"type": "space", "factor": spaces[command]}
        if command in {"limits", "displaystyle", "textstyle"}:
            return {"type": "space", "factor": 0.0}
        if command in {"begin", "end"}:
            self._read_raw_group()
            return {"type": "space", "factor": 0.0}
        if command in {"text", "mathrm", "mathbf", "mathit"}:
            return self._parse_required_group()
        if command == "operatorname":
            node = self._parse_required_group()
            if node["type"] == "symbol":
                return {**node, "role": "function"}
            return node
        if command in FUNCTION_COMMANDS:
            return {"type": "symbol", "value": command, "role": "function"}
        if command in COMMAND_SYMBOLS:
            value, role = COMMAND_SYMBOLS[command]
            return {"type": "symbol", "value": value, "role": role}
        raise LatexParseError(f"Unsupported command \\{command}")

    def _parse_delimiter(self) -> Node:
        self._skip_spaces()
        if self.index >= len(self.source):
            raise LatexParseError("Missing delimiter after \\left or \\right")
        if self.source[self.index] == "\\":
            self.index += 1
            start = self.index
            while (
                self.index < len(self.source)
                and self.source[self.index].isascii()
                and self.source[self.index].isalpha()
            ):
                self.index += 1
            name = self.source[start : self.index]
            if name not in DELIMITERS:
                raise LatexParseError(f"Unsupported delimiter \\{name}")
            value = DELIMITERS[name]
        else:
            name = self.source[self.index]
            self.index += 1
            if name not in DELIMITERS:
                raise LatexParseError("Unsupported delimiter")
            value = DELIMITERS[name]
        if value:
            return {"type": "symbol", "value": value, "role": "delimiter"}
        return {"type": "space", "factor": 0.0}

    def _attach_scripts(self, base: Node) -> Node:
        superscript: Node | None = None
        subscript: Node | None = None
        while self.index < len(self.source) and self.source[self.index] in {"^", "_"}:
            marker = self.source[self.index]
            self.index += 1
            script = self._parse_script_argument()
            if marker == "^":
                superscript = script
            else:
                subscript = script
        if superscript is None and subscript is None:
            return base
        node: Node = {"type": "scripts", "base": base}
        if superscript is not None:
            node["superscript"] = superscript
        if subscript is not None:
            node["subscript"] = subscript
        return node

    def _parse_script_argument(self) -> Node:
        if self.index >= len(self.source):
            raise LatexParseError("Missing script value")
        if self.source[self.index] == "{":
            return self._parse_required_group()
        if self.source[self.index] == "\\":
            return self._parse_command()
        return self._parse_character()

    def _parse_required_group(self) -> Node:
        self._skip_spaces()
        if self.index >= len(self.source) or self.source[self.index] != "{":
            raise LatexParseError(f"Expected {{ at position {self.index + 1}")
        self.index += 1
        result = self._parse_row(True)
        if self.index >= len(self.source) or self.source[self.index] != "}":
            raise LatexParseError("Missing closing }")
        self.index += 1
        return result

    def _read_raw_group(self) -> str:
        self._skip_spaces()
        if self.index >= len(self.source) or self.source[self.index] != "{":
            raise LatexParseError("Expected environment name")
        start = self.index + 1
        end = self.source.find("}", start)
        if end == -1:
            raise LatexParseError("Missing closing } for environment name")
        self.index = end + 1
        return self.source[start:end]

    def _skip_optional_bracket(self) -> None:
        self._skip_spaces()
        if self.index >= len(self.source) or self.source[self.index] != "[":
            return
        end = self.source.find("]", self.index + 1)
        if end == -1:
            raise LatexParseError("Missing closing ]")
        self.index = end + 1

    def _skip_spaces(self) -> None:
        while self.index < len(self.source) and self.source[self.index] in {" ", "\t"}:
            self.index += 1


@dataclass(frozen=True)
class MeasuredText:
    width: float
    ascent: float
    descent: float
    baseline_offset: float
    line_height: float


@dataclass(frozen=True)
class LayoutBox:
    width: float
    ascent: float
    descent: float
    atom_class: AtomClass
    objects: list[RenderObject]


def _font_candidates() -> list[tuple[str, int]]:
    candidates: list[tuple[str, int]] = []
    configured = os.getenv("LATEX_FONT_PATH")
    if configured:
        candidates.append((configured, int(os.getenv("LATEX_FONT_INDEX", "0"))))
    windows_directory = os.getenv("WINDIR")
    if windows_directory:
        candidates.append(
            (str(Path(windows_directory) / "Fonts" / "cambria.ttc"), 1)
        )
    candidates.extend(
        [("Cambria Math", 0), ("STIX Two Math", 0), ("DejaVuSerif.ttf", 0)]
    )
    return candidates


@lru_cache(maxsize=64)
def _load_font(measurement_size: int) -> ImageFont.FreeTypeFont | None:
    for candidate, index in _font_candidates():
        try:
            return ImageFont.truetype(candidate, measurement_size, index=index)
        except OSError:
            continue
    return None


def _measure_text(text: str, font_size: float) -> MeasuredText:
    measurement_scale = 4
    measurement_size = max(1, round(font_size * measurement_scale))
    font = _load_font(measurement_size)
    if font is None:
        return MeasuredText(
            width=max(font_size * 0.5, len(text) * font_size * 0.56),
            ascent=font_size * 0.78,
            descent=font_size * 0.22,
            baseline_offset=font_size * 0.78,
            line_height=font_size,
        )

    scale = measurement_size / font_size
    width = max(1.0, float(font.getlength(text)) / scale)
    font_ascent_raw, font_descent_raw = font.getmetrics()
    font_ascent = font_ascent_raw / scale
    font_descent = font_descent_raw / scale
    try:
        _, top, _, bottom = font.getbbox(text, anchor="ls")
        ascent = max(0.0, -top / scale) or font_size * 0.78
        descent = max(0.0, bottom / scale) or font_size * 0.22
    except (TypeError, ValueError):
        ascent = font_size * 0.78
        descent = font_size * 0.22
    return MeasuredText(
        width=width,
        ascent=ascent,
        descent=descent,
        baseline_offset=(font_ascent - font_descent) / 2 + font_size / 2,
        line_height=font_size,
    )


def _translate(
    objects: list[RenderObject], dx: float, dy: float
) -> list[RenderObject]:
    translated: list[RenderObject] = []
    for item in objects:
        current = dict(item)
        if current["kind"] == "text":
            current["x"] = float(current["x"]) + dx
            current["y"] = float(current["y"]) + dy
        else:
            current["x1"] = float(current["x1"]) + dx
            current["y1"] = float(current["y1"]) + dy
            current["x2"] = float(current["x2"]) + dx
            current["y2"] = float(current["y2"]) + dy
        translated.append(current)
    return translated


def _atom_class_for_role(role: LatexRole) -> AtomClass:
    if role in {"binary", "relation", "delimiter"}:
        return role
    if role == "function":
        return "operator"
    return "ordinary"


def _symbol_box(value: str, role: LatexRole, font_size: float) -> LayoutBox:
    metrics = _measure_text(value, font_size)
    font_family = (
        LARGE_OPERATOR_FONT_FAMILY if value in LARGE_OPERATORS else MATH_FONT_FAMILY
    )
    return LayoutBox(
        width=metrics.width,
        ascent=metrics.ascent,
        descent=metrics.descent,
        atom_class=_atom_class_for_role(role),
        objects=[
            {
                "kind": "text",
                "text": value,
                "role": role,
                "x": 0.0,
                "y": -metrics.baseline_offset,
                "width": metrics.width + 2,
                "height": metrics.line_height,
                "fontSize": font_size,
                "fontFamily": font_family,
            }
        ],
    )


def _spacing_between(
    previous: AtomClass | None, current: AtomClass, font_size: float
) -> float:
    if previous is None or previous == "space" or current == "space":
        return 0.0
    if previous == "relation" or current == "relation":
        return font_size * 0.24
    if previous == "binary" or current == "binary":
        return font_size * 0.18
    if previous == "operator" or current == "operator":
        return font_size * 0.08
    return 0.0


def _layout_row(children: list[Node], font_size: float) -> LayoutBox:
    x = 0.0
    ascent = 0.0
    descent = 0.0
    previous: AtomClass | None = None
    objects: list[RenderObject] = []
    for child in children:
        if child["type"] == "linebreak":
            continue
        box = _layout_node(child, font_size)
        x += _spacing_between(previous, box.atom_class, font_size)
        objects.extend(_translate(box.objects, x, 0))
        x += box.width
        ascent = max(ascent, box.ascent)
        descent = max(descent, box.descent)
        previous = box.atom_class
    return LayoutBox(
        width=max(1.0, x),
        ascent=max(1.0, ascent),
        descent=max(1.0, descent),
        atom_class="ordinary",
        objects=objects,
    )


def _layout_fraction(numerator_node: Node, denominator_node: Node, font_size: float) -> LayoutBox:
    numerator = _layout_node(numerator_node, font_size * 0.86)
    denominator = _layout_node(denominator_node, font_size * 0.86)
    padding = font_size * 0.16
    width = max(numerator.width, denominator.width) + padding * 2
    bar_y = -font_size * 0.08
    gap = font_size * 0.15
    numerator_baseline = bar_y - gap - numerator.descent
    denominator_baseline = bar_y + gap + denominator.ascent
    return LayoutBox(
        width=width,
        ascent=max(font_size * 0.2, -(numerator_baseline - numerator.ascent)),
        descent=max(font_size * 0.2, denominator_baseline + denominator.descent),
        atom_class="ordinary",
        objects=[
            *_translate(
                numerator.objects, (width - numerator.width) / 2, numerator_baseline
            ),
            {
                "kind": "line",
                "role": "fraction-bar",
                "x1": 0.0,
                "y1": bar_y,
                "x2": width,
                "y2": bar_y,
                "strokeWidth": max(1.5, font_size * 0.045),
            },
            *_translate(
                denominator.objects,
                (width - denominator.width) / 2,
                denominator_baseline,
            ),
        ],
    )


def _layout_root(radicand_node: Node, font_size: float) -> LayoutBox:
    radicand = _layout_node(radicand_node, font_size * 0.94)
    radical = _symbol_box("√", "ordinary", font_size * 1.18)
    overlap = font_size * 0.1
    content_x = max(font_size * 0.56, radical.width - overlap)
    roof_raise = font_size * 0.08
    bar_x_nudge = font_size * 0.045
    bar_y_nudge = font_size * 0.09
    line_y = -radicand.ascent - font_size * 0.08 - roof_raise - bar_y_nudge
    base_width = content_x + radicand.width + font_size * 0.08
    width = base_width + bar_x_nudge
    radical_objects = [
        {**item, "role": "radical"}
        for item in _translate(radical.objects, 0, -roof_raise)
    ]
    return LayoutBox(
        width=width,
        ascent=max(
            radical.ascent + roof_raise,
            radicand.ascent + font_size * 0.1 + roof_raise + bar_y_nudge,
        ),
        descent=max(radical.descent, radicand.descent),
        atom_class="ordinary",
        objects=[
            *radical_objects,
            *_translate(radicand.objects, content_x, 0),
            {
                "kind": "line",
                "role": "radical-bar",
                "x1": content_x - font_size * 0.04 + bar_x_nudge,
                "y1": line_y,
                "x2": base_width + bar_x_nudge,
                "y2": line_y,
                "strokeWidth": max(1.5, font_size * 0.04),
            },
        ],
    )


def _layout_scripts(
    base_node: Node,
    superscript_node: Node | None,
    subscript_node: Node | None,
    font_size: float,
) -> LayoutBox:
    base = _layout_node(base_node, font_size)
    superscript = (
        _layout_node(superscript_node, font_size * 0.6)
        if superscript_node is not None
        else None
    )
    subscript = (
        _layout_node(subscript_node, font_size * 0.6)
        if subscript_node is not None
        else None
    )
    uses_limits = (
        base_node["type"] == "operator" and base_node.get("value") in LARGE_OPERATORS
    )

    if uses_limits:
        width = max(
            base.width,
            superscript.width if superscript else 0,
            subscript.width if subscript else 0,
        )
        objects = _translate(base.objects, (width - base.width) / 2, 0)
        ascent = base.ascent
        descent = base.descent
        if superscript:
            baseline = -base.ascent - font_size * 0.08 - superscript.descent
            objects.extend(
                _translate(
                    superscript.objects,
                    (width - superscript.width) / 2,
                    baseline,
                )
            )
            ascent = max(ascent, -(baseline - superscript.ascent))
        if subscript:
            baseline = base.descent + font_size * 0.08 + subscript.ascent
            objects.extend(
                _translate(
                    subscript.objects, (width - subscript.width) / 2, baseline
                )
            )
            descent = max(descent, baseline + subscript.descent)
        return LayoutBox(width, ascent, descent, "operator", objects)

    script_x = base.width + font_size * 0.04
    width = script_x + max(
        superscript.width if superscript else 0,
        subscript.width if subscript else 0,
    )
    objects = list(base.objects)
    ascent = base.ascent
    descent = base.descent
    if superscript:
        baseline = -max(font_size * 0.52, base.ascent * 0.62)
        objects.extend(_translate(superscript.objects, script_x, baseline))
        ascent = max(ascent, -(baseline - superscript.ascent))
    if subscript:
        baseline = max(font_size * 0.32, base.descent + subscript.ascent * 0.45)
        objects.extend(_translate(subscript.objects, script_x, baseline))
        descent = max(descent, baseline + subscript.descent)
    return LayoutBox(width, ascent, descent, base.atom_class, objects)


def _layout_node(node: Node, font_size: float) -> LayoutBox:
    node_type = node["type"]
    if node_type == "row":
        return _layout_row(list(node["children"]), font_size)  # type: ignore[arg-type]
    if node_type == "symbol":
        return _symbol_box(
            str(node["value"]), str(node["role"]), font_size  # type: ignore[arg-type]
        )
    if node_type == "space":
        return LayoutBox(
            max(0.0, float(node["factor"]) * font_size),
            0.0,
            0.0,
            "space",
            [],
        )
    if node_type == "linebreak":
        return LayoutBox(0.0, 0.0, 0.0, "space", [])
    if node_type == "operator":
        value = str(node["value"])
        size = font_size * (1.7 if value in {"∫", "∮", "∬", "∭"} else 1.35)
        box = _symbol_box(value, "ordinary", size)
        objects = [{**item, "role": "large-operator"} for item in box.objects]
        return LayoutBox(box.width, box.ascent, box.descent, "operator", objects)
    if node_type == "fraction":
        return _layout_fraction(
            node["numerator"], node["denominator"], font_size  # type: ignore[arg-type]
        )
    if node_type == "root":
        return _layout_root(node["radicand"], font_size)  # type: ignore[arg-type]
    return _layout_scripts(
        node["base"],  # type: ignore[arg-type]
        node.get("superscript"),  # type: ignore[arg-type]
        node.get("subscript"),  # type: ignore[arg-type]
        font_size,
    )


def _split_lines(ast: Node) -> list[Node]:
    if ast["type"] != "row":
        return [ast]
    children: list[Node] = list(ast["children"])  # type: ignore[arg-type]
    if not any(child["type"] == "linebreak" for child in children):
        return [ast]
    lines: list[Node] = []
    current: list[Node] = []
    for child in children:
        if child["type"] == "linebreak":
            lines.append(
                current[0] if len(current) == 1 else {"type": "row", "children": current}
            )
            current = []
        else:
            current.append(child)
    lines.append(
        current[0] if len(current) == 1 else {"type": "row", "children": current}
    )
    return lines


def parse_latex(source: str) -> Node:
    if not source.strip():
        raise LatexParseError("Formula is empty")
    return LatexParser(source).parse()


def _layout_once(ast: Node, font_size: float) -> dict[str, object]:
    boxes = [_layout_node(line, font_size) for line in _split_lines(ast)]
    padding = max(8.0, font_size * 0.2)
    line_gap = font_size * 0.55
    width = max(max(box.width for box in boxes), 1.0) + padding * 2
    objects: list[RenderObject] = []
    baseline = padding + boxes[0].ascent
    for index, box in enumerate(boxes):
        if index > 0:
            baseline += boxes[index - 1].descent + line_gap + box.ascent
        objects.extend(_translate(box.objects, padding, baseline))
    height = baseline + boxes[-1].descent + padding
    return {"objects": objects, "width": width, "height": height}


def layout_latex(
    source: str,
    font_size: float = 44,
    *,
    max_width: float | None = None,
    max_height: float | None = None,
) -> dict[str, object]:
    ast = parse_latex(source)
    layout = _layout_once(ast, font_size)

    def fits(candidate: dict[str, object]) -> bool:
        return (
            (max_width is None or float(candidate["width"]) <= max_width)
            and (max_height is None or float(candidate["height"]) <= max_height)
        )

    if fits(layout):
        return layout

    lower_size = 0.01
    upper_size = font_size
    best = _layout_once(ast, lower_size)
    for _ in range(24):
        candidate_size = (lower_size + upper_size) / 2
        candidate = _layout_once(ast, candidate_size)
        if fits(candidate):
            lower_size = candidate_size
            best = candidate
        else:
            upper_size = candidate_size
    return best
