import pytest

from app.latex import LatexParseError, layout_latex, parse_latex


SUPPORTED_LONG_EXPRESSIONS = [
    r"I=\int_0^1\frac{x^2+3x+2}{\sqrt{x^2+1}}\,dx+\int_1^2\frac{\ln x+\exp x}{x^2+1}\,dx",
    r"J=\int_0^1\int_0^{\sqrt{1-x^2}}\left(x^2+y^2\right)\exp^{x+y}\,dy\,dx",
    r"\sum_{k=1}^{n}\frac{k^2+3k+2}{k+1}=\frac{n(n+1)}{2}+2n",
    r"\prod_{k=1}^{n}\frac{k}{k+1}=\frac{1}{n+1}\quad\Rightarrow\quad\lim_{n\to\infty}\prod_{k=1}^{n}\frac{k}{k+1}=0",
    r"\lim_{x\to 0}\frac{\sin x-x\cos x}{x^3}=\frac{1}{3}\quad\Leftrightarrow\quad\sin x-x\cos x\approx\frac{x^3}{3}",
    r"\sin^2 x+\cos^2 x=1\quad\Rightarrow\quad\tan^2 x+1=\frac{1}{\cos^2 x}",
    r"\frac{\partial^2 u}{\partial x^2}+\frac{\partial^2 u}{\partial y^2}+\frac{\partial^2 u}{\partial z^2}=\frac{1}{c^2}\frac{\partial^2 u}{\partial t^2}",
    r"\forall x\in A\cap B\quad x\in A\Leftrightarrow x\in B\quad\Rightarrow\quad A\cup B=A",
    r"K=\iiint_0^1\frac{x^2+y^2+z^2}{\sqrt{1+x^2+y^2+z^2}}\,dx\,dy\,dz",
    r"\begin{aligned}x_{1,2}&=\frac{-b\pm\sqrt{b^2-4ac}}{2a}\\x_1+x_2&=\frac{-b}{a}\\x_1x_2&=\frac{c}{a}\end{aligned}",
]


def test_parser_builds_fraction_and_scripts() -> None:
    ast = parse_latex(r"\frac{x^2}{y_1}")

    assert ast["type"] == "fraction"
    assert ast["numerator"]["type"] == "scripts"
    assert ast["numerator"]["superscript"]["value"] == "2"
    assert ast["denominator"]["type"] == "scripts"
    assert ast["denominator"]["subscript"]["value"] == "1"


def test_layout_returns_positioned_text_and_lines() -> None:
    layout = layout_latex(
        r"x_{1,2}=\frac{-b\pm\sqrt{b^2-4ac}}{2a}",
        44,
        max_width=714,
        max_height=963,
    )

    assert layout["width"] <= 714
    assert layout["height"] <= 963
    assert any(item["kind"] == "text" for item in layout["objects"])
    roles = {item["role"] for item in layout["objects"] if item["kind"] == "line"}
    assert roles == {"fraction-bar", "radical-bar"}


def test_parser_rejects_unsupported_command() -> None:
    with pytest.raises(LatexParseError, match=r"Unsupported command \\matrix"):
        parse_latex(r"\matrix{1}")


def test_function_argument_has_visible_spacing() -> None:
    layout = layout_latex(r"\ln x+\exp x")
    text_objects = [item for item in layout["objects"] if item["kind"] == "text"]
    logarithm, first_x = text_objects[0], text_objects[1]

    assert logarithm["text"] == "ln"
    assert first_x["text"] == "x"
    assert first_x["x"] > logarithm["x"] + logarithm["width"] - 2


def test_math_font_metrics_do_not_clip_wide_operators() -> None:
    layout = layout_latex(r"x=\pm\int_0^1x\,dx")
    by_text = {
        item["text"]: item
        for item in layout["objects"]
        if item["kind"] == "text"
    }

    assert by_text["="]["width"] > by_text["="]["fontSize"] * 0.7
    assert by_text["±"]["width"] > by_text["±"]["fontSize"] * 0.7
    assert by_text["∫"]["width"] > by_text["∫"]["fontSize"] * 0.55
    assert "KaTeX_Size2" in by_text["∫"]["fontFamily"]


def test_radical_bar_stays_above_superscript() -> None:
    layout = layout_latex(r"\sqrt{b^2-4ac}")
    radical_bar = next(
        item
        for item in layout["objects"]
        if item["kind"] == "line" and item["role"] == "radical-bar"
    )
    superscript = next(
        item
        for item in layout["objects"]
        if item["kind"] == "text" and item["text"] == "2"
    )

    assert radical_bar["y1"] <= superscript["y"] - 4


@pytest.mark.parametrize("expression", SUPPORTED_LONG_EXPRESSIONS)
def test_long_supported_expressions_have_visible_layout(expression: str) -> None:
    layout = layout_latex(expression, 44, max_width=714, max_height=963)

    assert 0 < layout["width"] <= 714
    assert 0 < layout["height"] <= 963
    assert layout["objects"]
    for item in layout["objects"]:
        if item["kind"] == "text":
            assert item["text"]
            assert item["width"] > 2
            assert item["height"] > 0
        else:
            assert item["strokeWidth"] > 0
