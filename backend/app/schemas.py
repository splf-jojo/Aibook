from datetime import datetime
from typing import Annotated, Literal
from uuid import uuid4
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    username: str


class AiSidebarResponse(BaseModel):
    text: str


class AiBar(BaseModel):
    label: str = Field(min_length=1, max_length=40)
    value: float = Field(ge=0, le=1_000_000, allow_inf_nan=False)


class AiBarChart(BaseModel):
    bars: list[AiBar] = Field(min_length=1, max_length=20)
    x_label: str = Field(default="", max_length=80)
    y_label: str = Field(default="", max_length=80)


class AiSolutionStep(BaseModel):
    latex: str = Field(default="", max_length=4_000)
    explanation: str = Field(min_length=1, max_length=320,
                             description="One or two brief prose sentences. No equations, equals signs, Markdown or LaTeX; calculations belong in latex.")
    chart: AiBarChart | None = None

    @field_validator("explanation")
    @classmethod
    def prose_only(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("An explanation must not be blank")
        if re.search(r"[=$]|\\[a-zA-Z(\[]", value):
            raise ValueError("Use plain prose for explanations; move all equations and LaTeX to the canvas steps")
        return value.strip()

    @model_validator(mode="after")
    def check_canvas_content(self) -> "AiSolutionStep":
        if not self.latex.strip() and self.chart is None:
            raise ValueError("A step requires a formula or a chart")
        if any(ord(char) < 32 and char not in "\n\r\t" for char in self.latex):
            raise ValueError("LaTeX backslashes must be escaped in JSON")
        return self


class AiCanvasResponse(BaseModel):
    status: Literal["solution", "clarification"]
    explanation: str = Field(min_length=1, max_length=600,
                             description="Brief plain-text introduction or clarification. No equations, equals signs, Markdown or LaTeX.")
    steps: list[AiSolutionStep] = Field(default_factory=list, max_length=24)
    _prose_only = field_validator("explanation")(AiSolutionStep.prose_only.__func__)

    @model_validator(mode="after")
    def check_steps(self) -> "AiCanvasResponse":
        if (self.status == "solution") != bool(self.steps):
            raise ValueError("Solutions require steps; clarifications must not contain steps")
        return self


class LatexLayoutRequest(CamelModel):
    latex: str = Field(min_length=1, max_length=20_000)
    font_size: float = Field(default=44, gt=0, le=256)
    max_width: float | None = Field(default=None, gt=0, le=10_000)
    max_height: float | None = Field(default=None, gt=0, le=10_000)


class LatexTextObject(CamelModel):
    kind: Literal["text"]
    text: str
    role: str
    x: float
    y: float
    width: float
    height: float
    font_size: float
    font_family: str


class LatexLineObject(CamelModel):
    kind: Literal["line"]
    role: str
    x1: float
    y1: float
    x2: float
    y2: float
    stroke_width: float


class LatexLayoutResponse(CamelModel):
    objects: list[LatexTextObject | LatexLineObject]
    width: float
    height: float


class AiChatCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class AiChatMessageCreate(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=100_000)
    image_data_url: str | None = Field(default=None, max_length=30_000_000)


class AiChatMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    role: Literal["user", "assistant"]
    content: str
    image_data_url: str | None
    created_at: datetime


class AiChatResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    created_at: datetime
    messages: list[AiChatMessageResponse]


class CanvasSize(CamelModel):
    width: float = Field(gt=0, le=10_000)
    height: float = Field(gt=0, le=10_000)


class CanvasRect(CamelModel):
    x: float
    y: float
    width: float = Field(ge=0, le=100_000)
    height: float = Field(ge=0, le=100_000)


class CanvasAffineTransform(CamelModel):
    a: float
    b: float
    c: float
    d: float
    tx: float
    ty: float


class CanvasStrokeSample(CamelModel):
    x: float
    y: float
    time_offset: float | None = Field(default=None, ge=0)
    size: CanvasSize | None = None
    opacity: float | None = Field(default=None, ge=0, le=1)
    force: float | None = Field(default=None, ge=0)
    azimuth: float | None = None
    altitude: float | None = None
    secondary_scale: float | None = None
    threshold: float | None = None


class CanvasStrokeElement(CamelModel):
    id: str = Field(min_length=1, max_length=100)
    kind: Literal["stroke"]
    mode: Literal["draw"]
    points: list[float] = Field(default_factory=list, max_length=200_000)
    samples: list[CanvasStrokeSample] | None = Field(default=None, max_length=100_000)
    stroke_width: float = Field(gt=0, le=256)
    stroke: str | None = Field(default=None, max_length=64)
    tool: str | None = Field(default=None, max_length=64)
    transform: CanvasAffineTransform | None = None
    mask_data: str | None = Field(default=None, max_length=5_000_000)
    render_bounds: CanvasRect | None = None
    random_seed: int | None = Field(default=None, ge=0, le=4_294_967_295)
    source: Literal["latex"] | None = None
    formula_instance_id: str | None = Field(default=None, max_length=100)
    latex_template_id: str | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def normalize_points(self) -> "CanvasStrokeElement":
        if not self.points and self.samples:
            self.points = [coordinate for point in self.samples for coordinate in (point.x, point.y)]
        if len(self.points) < 4:
            raise ValueError("Stroke requires at least two points")
        if len(self.points) % 2:
            raise ValueError("Stroke points must contain x/y pairs")
        return self


class CanvasStarElement(CamelModel):
    id: str = Field(min_length=1, max_length=100)
    kind: Literal["star"]
    x: float
    y: float
    inner_radius: float = Field(gt=0, le=10_000)
    outer_radius: float = Field(gt=0, le=10_000)


class CanvasTextElement(CamelModel):
    id: str = Field(min_length=1, max_length=100)
    kind: Literal["text"]
    x: float
    y: float
    width: float = Field(gt=0, le=100_000)
    text: str = Field(max_length=1_000_000)
    font_size: float = Field(gt=0, le=1_000)
    height: float | None = Field(default=None, gt=0, le=100_000)
    fill: str | None = Field(default=None, max_length=64)
    font_family: str | None = Field(default=None, max_length=500)
    line_height: float | None = Field(default=None, gt=0, le=20)
    rotation: float | None = Field(default=None, ge=-360_000, le=360_000)
    source: Literal["latex"] | None = None
    formula_instance_id: str | None = Field(default=None, max_length=100)
    latex_template_id: str | None = Field(default=None, max_length=100)


class CanvasImageElement(CamelModel):
    id: str = Field(min_length=1, max_length=100)
    kind: Literal["image"]
    x: float
    y: float
    width: float = Field(gt=0, le=100_000)
    height: float = Field(gt=0, le=100_000)
    data_url: str = Field(max_length=30_000_000)
    source: Literal["latex", "ai-chart"] | None = None
    latex: str | None = Field(default=None, max_length=20_000)
    formula_instance_id: str | None = Field(default=None, max_length=100)
    solution_id: str | None = Field(default=None, max_length=100)
    latex_template_id: str | None = Field(default=None, max_length=100)


class CanvasSavedCardElement(CamelModel):
    id: str = Field(min_length=1, max_length=100)
    kind: Literal["saved-card"]
    card: Literal["solution-2-3-11", "summary-2-3"]
    x: float
    y: float
    width: float = Field(gt=0, le=100_000)
    height: float = Field(gt=0, le=100_000)


CanvasElement = Annotated[
    CanvasStrokeElement
    | CanvasStarElement
    | CanvasTextElement
    | CanvasImageElement
    | CanvasSavedCardElement,
    Field(discriminator="kind"),
]


class CanvasPage(CamelModel):
    id: str = Field(default_factory=lambda: str(uuid4()), min_length=1, max_length=100)
    width: float = Field(default=794, gt=0, le=10_000)
    height: float = Field(default=1123, gt=0, le=10_000)
    page_template: Literal["ruled", "dotted", "grid", "plain"] = "plain"
    elements: list[CanvasElement] = Field(default_factory=list, max_length=20_000)
    apple_drawing_data: str | None = Field(default=None, max_length=30_000_000)


def new_canvas_pages() -> list[CanvasPage]:
    return [CanvasPage()]


class CanvasContent(CamelModel):
    schema_version: Literal[2] = 2
    pages: list[CanvasPage] = Field(
        default_factory=new_canvas_pages,
        min_length=1,
        max_length=1_000,
    )

    @model_validator(mode="before")
    @classmethod
    def upgrade_legacy_content(cls, value: object) -> object:
        if not isinstance(value, dict) or "pages" in value:
            return value
        schema_version = value.get("schemaVersion", value.get("schema_version", 1))
        if schema_version != 1:
            return value
        return {
            "schemaVersion": 2,
            "pages": [
                {
                    "id": "page-1",
                    "width": value.get("pageWidth", value.get("page_width", 794)),
                    "height": value.get("pageHeight", value.get("page_height", 1123)),
                    "pageTemplate": "plain",
                    "elements": value.get("elements", []),
                }
            ],
        }


class CanvasCreate(CamelModel):
    title: str = Field(min_length=1, max_length=120)
    content: CanvasContent = Field(default_factory=CanvasContent)


class CanvasUpdate(CamelModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    content: CanvasContent | None = None

    @model_validator(mode="after")
    def has_changes(self) -> "CanvasUpdate":
        if self.title is None and self.content is None:
            raise ValueError("At least one field must be provided")
        return self


class CanvasSummaryResponse(CamelModel):
    id: str
    title: str
    element_count: int
    created_at: datetime
    updated_at: datetime


class CanvasResponse(CamelModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )

    id: str
    title: str
    content: CanvasContent
    created_at: datetime
    updated_at: datetime


class ImageMetadata(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    mime_type: str
    width: int
    height: int
    size_bytes: int
    created_at: datetime
