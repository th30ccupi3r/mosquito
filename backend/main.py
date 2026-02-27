from __future__ import annotations

import base64
import hashlib
import math
import os
from pathlib import Path
from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional, Tuple

import yaml
from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse
from starlette.routing import Route


ROOT = Path(__file__).resolve().parent
ICONS_DIR = ROOT / "tam_diagram"


def _b64_data_uri(svg_bytes: bytes) -> str:
    """Return a data URI safe for mxGraph style strings.

    NOTE: mxGraph style strings use ';' as a delimiter. A base64 SVG data URI
    includes a ';' (e.g. 'data:image/svg+xml;base64,...') which can get parsed
    as a style delimiter in some mxGraph code paths. We avoid that by using the
    URL-encoded SVG form: 'data:image/svg+xml,<urlencoded svg>'.
    """
    from urllib.parse import quote
    svg_text = svg_bytes.decode("utf-8")
    return "data:image/svg+xml," + quote(svg_text)


REQUIRED_ICONS = {
    "human": "human.svg",
    "storage": "storage.svg",
    "common_feature_areas": "common_feature_areas.svg",
    "read_write_modify_both": "read_write_modify_both.svg",
    "read_write_modify_single_right": "read_write_modify_single_right.svg",
    "read_write_modify_single_left": "read_write_modify_single_left.svg",
    # SAP PowerDesigner TAM modify-access marker (double-arc / two-way curly arrows)
    "modify_access_double_arc": "modify_access_double_arc.svg",
    # SAP PowerDesigner-like TAM communication marker.
    # We keep a bidirectional (two-arrow) marker and a unidirectional (single-arrow)
    # marker so TAM unidirectional channels don't accidentally render as bidirectional.
    "tam_comm_marker_bi": "tam_comm_marker.svg",
    "tam_comm_marker_uni": "tam_comm_marker_uni.svg",
    # Storage access direction markers (placed just above storage)
    "tam_access_arrow_down": "tam_access_arrow_down.svg",
    "tam_access_arrow_up": "tam_access_arrow_up.svg",
}


def load_icons() -> Dict[str, str]:
    out: Dict[str, str] = {}
    missing: List[str] = []
    for key, fn in REQUIRED_ICONS.items():
        p = ICONS_DIR / fn
        if not p.exists():
            missing.append(str(p))
            continue
        out[key] = _b64_data_uri(p.read_bytes())
    if missing:
        raise RuntimeError(
            "Missing required SVG icons:\n" + "\n".join(missing)
        )
    return out


ICONS = load_icons()


IssueLevel = Literal["error", "warn"]

@dataclass
class Issue:
    level: IssueLevel
    message: str
    path: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {"level": self.level, "message": self.message, "path": self.path}



def _issue(level: IssueLevel, message: str, path: Optional[str] = None) -> Issue:
    return Issue(level=level, message=message, path=path)


def _issues_to_dicts(items):
    out=[]
    for it in items or []:
        if isinstance(it, Issue):
            out.append(it.to_dict())
        elif isinstance(it, dict):
            out.append(it)
        else:
            out.append({"level":"error","message":str(it),"path":None})
    return out


app = Starlette(debug=True)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -----------------------------
# YAML DSL
# -----------------------------

AccessType = Literal[
    "read_write_modify_both",
    "read_write_modify_single_left",
    "read_write_modify_single_right",
]

# We accept both symbolic ("->") and wordy ("one_way") forms.
Direction = Literal["->", "<-", "<->", "reqres", "one_way", "two_way", "request_response"]


def normalize_direction(raw: Any) -> str:
    """Normalize direction strings into the symbolic set used by the renderer."""
    if raw is None:
        return "->"
    s = str(raw).strip()
    mapping = {
        "one_way": "->",
        "two_way": "<->",
        "request_response": "reqres",
        "req/res": "reqres",
        "reqres": "reqres",
        "unidirectional": "->",
        "bidirectional": "<->",
    }
    return mapping.get(s, s)


def normalize_tam_direction(raw: Any) -> str:
    """Normalize direction into TAM persisted direction fields."""
    if raw is None:
        return "sourceToTarget"
    s = str(raw).strip()
    mapping = {
        # legacy symbolic
        "->": "sourceToTarget",
        "<-": "targetToSource",
        # already normalized
        "sourceToTarget": "sourceToTarget",
        "targetToSource": "targetToSource",
    }
    return mapping.get(s, s)


def normalize_tam_comm_type(raw: Any, legacy_direction: Any = None) -> str:
    """Normalize communication type."""
    if raw is None:
        # Infer from legacy direction
        d = normalize_direction(legacy_direction)
        return {"<->": "bidirectional", "reqres": "requestResponse"}.get(d, "unidirectional")
    s = str(raw).strip()
    mapping = {
        "unidirectional": "unidirectional",
        "bidirectional": "bidirectional",
        "requestResponse": "requestResponse",
        # legacy/alt spellings
        "request_response": "requestResponse",
        "reqres": "requestResponse",
        "one_way": "unidirectional",
        "two_way": "bidirectional",
    }
    return mapping.get(s, s)


def normalize_tam_access_type(raw: Any, legacy_access: Any = None) -> str:
    """Normalize access type."""
    if raw is None:
        # Best-effort mapping from legacy icons
        s = str(legacy_access or "").strip()
        if s == "read_write_modify_both":
            return "modifyAccess"
        if s in ("read_write_modify_single_right", "read_write_modify_single_left"):
            return "writeAccess"
        return "readAccess"
    s = str(raw).strip()
    mapping = {
        "readAccess": "readAccess",
        "writeAccess": "writeAccess",
        "modifyAccess": "modifyAccess",
        # tolerate lower/legacy
        "read": "readAccess",
        "write": "writeAccess",
        "modify": "modifyAccess",
    }
    return mapping.get(s, s)


def stable_id(prefix: str, key: str) -> str:
    h = hashlib.sha1(key.encode("utf-8")).hexdigest()[:10]
    return f"{prefix}-{h}"


def esc(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


class Model:
    def __init__(self, raw: Dict[str, Any]):
        self.trust_boundaries: List[Dict[str, Any]] = raw.get("trust_boundaries") or []
        self.boundaries: Dict[str, Any] = raw.get("boundaries") or {}
        self.human_agents: List[Any] = raw.get("human_agents") or []
        self.agents: List[Any] = raw.get("agents") or []
        self.components: List[Any] = raw.get("components") or []
        self.storages: List[Any] = raw.get("storages") or []
        self.areas: List[Any] = raw.get("areas") or []
        self.channels: List[Dict[str, Any]] = raw.get("channels") or []
        self.accesses: List[Dict[str, Any]] = raw.get("accesses") or []
        self.external_providers: List[str] = raw.get("external_providers") or []


def parse_yaml(text: str) -> Tuple[Optional[Model], List[Issue]]:
    issues: List[Issue] = []
    try:
        data = yaml.safe_load(text) or {}
    except Exception as e:
        return None, [Issue(level="error", message=f"YAML parse error: {e}")]

    if not isinstance(data, dict):
        return None, [Issue(level="error", message="Top-level YAML must be a mapping/object")]

    return Model(data), issues


def validate_model(m: Model) -> List[Issue]:
    issues: List[Issue] = []

    # collect names
    def add_name(n: str, path: str, seen: Dict[str, str]):
        if n in seen:
            issues.append(
                Issue(
                    level="error",
                    message=f"Duplicate name '{n}' also defined at {seen[n]}",
                    path=path,
                )
            )
        else:
            seen[n] = path

    seen: Dict[str, str] = {}

    for i, n in enumerate(m.human_agents):
        if isinstance(n, str):
            add_name(n, f"human_agents[{i}]", seen)
        elif isinstance(n, dict):
            nm = n.get("name")
            if isinstance(nm, str):
                add_name(nm, f"human_agents[{i}].name", seen)
            b = n.get("boundary")
            if b is not None and str(b).strip().lower() not in ("left", "right"):
                issues.append(Issue(level="error", message="boundary must be 'left' or 'right'", path=f"human_agents[{i}].boundary"))

    def walk_items(items: Any, path: str):
        if not items:
            return
        if isinstance(items, list):
            for idx, it in enumerate(items):
                p = f"{path}[{idx}]"
                if isinstance(it, str):
                    add_name(it, p, seen)
                elif isinstance(it, dict):
                    name = it.get("name")
                    if isinstance(name, str):
                        add_name(name, p + ".name", seen)
                        # Components can contain subcomponents (nested nodes). Treat each subcomponent
                        # as a first-class node using a qualified name: '<Component>/<Subcomponent>'.
                        if path == "components" and name.strip():
                            parent = name.strip()
                            raw_subs = it.get("subcomponents") or []
                            if isinstance(raw_subs, list):
                                for sc_i, sc in enumerate(raw_subs):
                                    sn = None
                                    if isinstance(sc, str):
                                        sn = sc
                                    elif isinstance(sc, dict):
                                        sn = sc.get("name")
                                    if isinstance(sn, str) and sn.strip():
                                        add_name(f"{parent}/{sn.strip()}", f"{p}.subcomponents[{sc_i}]", seen)
                    # validate human-agent nesting rule later
                    kids = it.get("children")
                    if kids is not None:
                        walk_items(kids, p + ".children")

    walk_items(m.agents, "agents")
    walk_items(m.components, "components")
    for i, n in enumerate(m.storages):
        if isinstance(n, str):
            add_name(n, f"storages[{i}]", seen)
        elif isinstance(n, dict):
            nm = n.get("name")
            if isinstance(nm, str):
                add_name(nm, f"storages[{i}].name", seen)
            b = n.get("boundary")
            if b is not None and str(b).strip().lower() not in ("left", "right"):
                issues.append(Issue(level="error", message="boundary must be 'left' or 'right'", path=f"storages[{i}].boundary"))

    # areas
    walk_items(m.areas, "areas")

    # external providers
    for i, n in enumerate(m.external_providers):
        if isinstance(n, str):
            add_name(n, f"external_providers[{i}]", seen)

    # trust boundaries
    for i, b in enumerate(m.trust_boundaries):
        if not isinstance(b, dict):
            issues.append(Issue(level="error", message="trust_boundaries items must be objects", path=f"trust_boundaries[{i}]"))
            continue
        if not b.get("name"):
            issues.append(Issue(level="error", message="trust_boundaries.name is required", path=f"trust_boundaries[{i}].name"))

    # references
    all_names = set(seen.keys())

    def ref_check(lst: List[Dict[str, Any]], kind: str):
        for i, c in enumerate(lst):
            if not isinstance(c, dict):
                issues.append(Issue(level="error", message=f"{kind}[{i}] must be an object"))
                continue
            a, b = c.get("from"), c.get("to")
            if a not in all_names:
                issues.append(Issue(level="error", message=f"Undefined reference in {kind}: from='{a}'", path=f"{kind}[{i}].from"))
            if b not in all_names:
                issues.append(Issue(level="error", message=f"Undefined reference in {kind}: to='{b}'", path=f"{kind}[{i}].to"))

    ref_check(m.channels, "channels")
    ref_check(m.accesses, "accesses")

    # validate channel fields
    for i, c in enumerate(m.channels):
        if not isinstance(c, dict):
            continue
        # Support both legacy symbolic directions and TAM persisted directions.
        legacy_dir = normalize_direction(c.get("direction", "->"))
        tam_dir = normalize_tam_direction(c.get("direction", "sourceToTarget"))
        tam_type = normalize_tam_comm_type(c.get("tamEdgeType"), legacy_dir)

        if legacy_dir not in {"->", "<-", "<->", "reqres"} and tam_dir not in {"sourceToTarget", "targetToSource"}:
            issues.append(
                Issue(
                    level="error",
                    message="Invalid direction (use one_way, two_way, request_response, or ->, <-, <->, reqres)",
                    path=f"channels[{i}].direction",
                )
            )
        if tam_type not in {"unidirectional", "bidirectional", "requestResponse"}:
            issues.append(Issue(level="error", message="Invalid tamEdgeType for channel", path=f"channels[{i}].tamEdgeType"))

        if not c.get("protocol"):
            issues.append(Issue(level="error", message="channels.protocol is required", path=f"channels[{i}].protocol"))

    # validate access fields
    for i, a in enumerate(m.accesses):
        if not isinstance(a, dict):
            continue
        # New TAM access types live under tamEdgeType, legacy icons live under access.
        tam_type = normalize_tam_access_type(a.get("tamEdgeType"), a.get("access"))
        if tam_type not in {"readAccess", "writeAccess", "modifyAccess"}:
            issues.append(
                Issue(
                    level="error",
                    message="Invalid access type",
                    path=f"accesses[{i}].tamEdgeType",
                )
            )

        d = normalize_tam_direction(a.get("direction", "sourceToTarget"))
        if d not in {"sourceToTarget", "targetToSource"}:
            issues.append(Issue(level="error", message="Invalid direction for access (sourceToTarget|targetToSource)", path=f"accesses[{i}].direction"))

    # circular nesting + human agent nesting
    # We support nesting for agents/components/areas via children[] objects.
    def check_cycles(items: Any, stack: List[str], path: str):
        if not isinstance(items, list):
            return
        for idx, it in enumerate(items):
            if not isinstance(it, dict):
                continue
            name = it.get("name")
            if not isinstance(name, str):
                continue
            if name in stack:
                issues.append(Issue(level="error", message=f"Circular nesting detected: {' -> '.join(stack+[name])}", path=f"{path}[{idx}]"))
                continue
            kids = it.get("children")
            if kids is not None:
                check_cycles(kids, stack + [name], f"{path}[{idx}].children")

    check_cycles(m.agents, [], "agents")
    check_cycles(m.components, [], "components")
    check_cycles(m.areas, [], "areas")

    # human agents cannot contain children (DSL: if user mistakenly puts objects)
    for i, it in enumerate(m.human_agents):
        if isinstance(it, dict) and it.get("children"):
            issues.append(Issue(level="error", message="Human agents cannot contain nested elements", path=f"human_agents[{i}]"))

    return issues


# -----------------------------
# mxGraph XML generation
# -----------------------------


def xml_cell(
    *,
    id: str,
    value: str | None = None,
    style: str | None = None,
    vertex: bool = False,
    edge: bool = False,
    parent: str | None = None,
    source: str | None = None,
    target: str | None = None,
    x: float | None = None,
    y: float | None = None,
    w: float | None = None,
    h: float | None = None,
    relative: bool = False,
    points: List[Tuple[float,float]] | None = None,
    offset: Tuple[float,float] | None = None,
) -> str:
    attrs = [f'id="{esc(id)}"']
    if value is not None:
        attrs.append(f'value="{esc(value)}"')
    if style:
        attrs.append(f'style="{esc(style)}"')
    if vertex:
        attrs.append('vertex="1"')
    if edge:
        attrs.append('edge="1"')
    if parent:
        attrs.append(f'parent="{esc(parent)}"')
    if source:
        attrs.append(f'source="{esc(source)}"')
    if target:
        attrs.append(f'target="{esc(target)}"')

    geo = ""
    if any(v is not None for v in (x, y, w, h)) or relative or points or offset:
        ga: List[str] = []
        if x is not None:
            ga.append(f'x="{x}"')
        if y is not None:
            ga.append(f'y="{y}"')
        if w is not None:
            ga.append(f'width="{w}"')
        if h is not None:
            ga.append(f'height="{h}"')
        if relative:
            ga.append('relative="1"')

        inner: List[str] = []
        if points:
            pts = ''.join([f'<mxPoint x="{px}" y="{py}"/>' for (px, py) in points])
            inner.append(f'<Array as="points">{pts}</Array>')
        if offset:
            ox, oy = offset
            inner.append(f'<mxPoint as="offset" x="{ox}" y="{oy}"/>')

        if inner:
            geo = f'<mxGeometry {" ".join(ga)} as="geometry">{"".join(inner)}</mxGeometry>'
        else:
            geo = f'<mxGeometry {" ".join(ga)} as="geometry"/>'

    return f'<mxCell {" ".join(attrs)}>{geo}</mxCell>'


def style_container(fill="#d9d9d9") -> str:
    return (
        "rounded=0;whiteSpace=wrap;html=1;container=1;collapsible=0;"
        f"fillColor={fill};strokeColor=#000000;strokeWidth=1;"
    )


def style_container_rounded(fill="#d9d9d9") -> str:
    return (
        "rounded=1;arcSize=20;whiteSpace=wrap;html=1;container=1;collapsible=0;"
        f"fillColor={fill};strokeColor=#000000;strokeWidth=1;"
    )


def style_box() -> str:
    return "rounded=0;whiteSpace=wrap;html=1;align=center;verticalAlign=middle;fillColor=#ffffff;strokeColor=#000000;strokeWidth=1;fontSize=12;"


def style_pill() -> str:
    return "rounded=1;arcSize=50;whiteSpace=wrap;html=1;align=center;verticalAlign=middle;fillColor=#ffffff;strokeColor=#000000;strokeWidth=1;fontSize=12;"


def style_text() -> str:
    return "text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;fontSize=12;fontColor=#000000;"


def style_image(image_uri: str) -> str:
    return f"shape=image;image={image_uri};imageAspect=0;perimeter=none;resizable=0;movable=0;"


def style_edge(end=True, start=False) -> str:
    s = [
        "edgeStyle=orthogonalEdgeStyle",
        "rounded=0",
        "html=1",
        "strokeColor=#000000",
        "strokeWidth=1",
        "jettySize=auto",
        "orthogonal=1",
        "avoidNodes=1",
        "labelBackgroundColor=#ffffff",
        "labelBorderColor=none",
        "labelPosition=left",
        "labelDistance=24",
        "align=left",
        "verticalAlign=middle",
        "spacingLeft=6",
        "spacingTop=-8",
    ]
    if start:
        s += ["startArrow=block", "startFill=1"]
    else:
        s.append("startArrow=none")
    if end:
        s += ["endArrow=block", "endFill=1"]
    else:
        s.append("endArrow=none")
    return ";".join(s) + ";"


def style_junction() -> str:
    return "shape=ellipse;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#000000;strokeWidth=1;"


def style_boundary_line() -> str:
    # Render a dashed vertical divider line.
    return "shape=rectangle;fillColor=none;strokeColor=#000000;strokeWidth=1;dashed=1;dashPattern=4 4;"


def render(model: Model) -> Tuple[str, List[Issue]]:
    issues = validate_model(model)
    if any(i.level == "error" for i in issues):
        return "", issues

    # -----------------------------
    # Minimal "starter" renderer
    # -----------------------------
    # The full renderer uses a large reference-template style layout (canvas + sidebar + frames).
    # That looks confusing when the user is just starting a fresh model (e.g., they add a single
    # human/agent/component/storage). In that early state, render a simple minimal diagram with
    # only the entities that exist.
    #
    # We keep the minimal renderer conservative: it triggers when there are no
    # areas or trust boundaries (i.e., nothing that requires the complex layout).
    # Channels/accesses are supported in the minimal renderer so users can connect
    # nodes without being forced into the template diagram.
    is_starter_model = not any([
        getattr(model, "areas", []),
        getattr(model, "trust_boundaries", []),
    ])



    if is_starter_model:
        # -----------------------------
        # Minimal renderer (supports subcomponents + channels)
        # -----------------------------
        # Node keying:
        # - Regular nodes use their display name (e.g. "User DB")
        # - Subcomponents use a qualified name: "<Component>/<Subcomponent>"
        #
        # This keeps channel endpoints unambiguous and allows connections to/from
        # subcomponents, components, humans, agents, storages, etc.
        nodes: List[Tuple[str, str]] = []  # (kind, name-or-qualified)
        component_subs: Dict[str, List[str]] = {}  # component name -> subcomponent names
        component_boundary: Dict[str, str] = {}  # component name -> "left"|"right"
        human_boundary: Dict[str, str] = {}  # human name -> "left"|"right"
        agent_boundary: Dict[str, str] = {}  # agent name -> "left"|"right"
        storage_boundary: Dict[str, str] = {}  # storage name -> "left"|"right"

        def _add(kind: str, name: str):
            if isinstance(name, str) and name.strip():
                nodes.append((kind, name.strip()))

        for it in list(getattr(model, "human_agents", []) or []):
            if isinstance(it, str):
                _add("human", it)
            elif isinstance(it, dict):
                nm = it.get("name")
                if isinstance(nm, str):
                    nm = nm.strip()
                    _add("human", nm)
                    b = it.get("boundary")
                    if isinstance(b, str) and b.strip().lower() in ("left", "right"):
                        human_boundary[nm] = b.strip().lower()

        for it in list(getattr(model, "agents", []) or []):
            if isinstance(it, str):
                _add("agent", it)
            elif isinstance(it, dict):
                nm = it.get("name")
                if isinstance(nm, str):
                    nm = nm.strip()
                    _add("agent", nm)
                    b = it.get("boundary")
                    if isinstance(b, str) and b.strip().lower() in ("left", "right"):
                        agent_boundary[nm] = b.strip().lower()

        for it in list(getattr(model, "components", []) or []):
            if isinstance(it, str) and it.strip():
                nm = it.strip()
                _add("component", nm)
                component_subs.setdefault(nm, [])
            elif isinstance(it, dict):
                nm = it.get("name")
                if isinstance(nm, str) and nm.strip():
                    nm = nm.strip()
                    _add("component", nm)
                    subs: List[str] = []
                    raw_subs = it.get("subcomponents") or []
                    if isinstance(raw_subs, list):
                        for sc in raw_subs:
                            if isinstance(sc, str) and sc.strip():
                                subs.append(sc.strip())
                            elif isinstance(sc, dict):
                                sn = sc.get("name")
                                if isinstance(sn, str) and sn.strip():
                                    subs.append(sn.strip())
                    component_subs[nm] = subs
                    b = it.get("boundary")
                    if isinstance(b, str) and b.strip().lower() in ("left","right"):
                        component_boundary[nm] = b.strip().lower()

        for it in list(getattr(model, "storages", []) or []):
            if isinstance(it, str):
                _add("storage", it)
            elif isinstance(it, dict):
                nm = it.get("name")
                if isinstance(nm, str):
                    nm = nm.strip()
                    _add("storage", nm)
                    b = it.get("boundary")
                    if isinstance(b, str) and b.strip().lower() in ("left", "right"):
                        storage_boundary[nm] = b.strip().lower()

        # If there are no nodes, don't render anything.
        if not nodes:
            return "", issues

        # Build mxGraph cells.
        cells: List[str] = []
        cells.append('<mxCell id="0"/>')
        cells.append('<mxCell id="1" parent="0"/>')

        # Quick lookup for storage endpoints (used for TAM access marker placement).
        storage_nodes = {n for (k, n) in nodes if k == "storage"}

        # Layout constants
        tile_w = 190
        tile_h = 110
        icon = 38
        margin_x, margin_y = 40, 60
        gap_x, gap_y = 18, 26
        
        def card_style(kind: str) -> str:
            # Light-theme diagram styling
            # - Components: light grey fill, black border, square corners
            # - Actors/Subcomponents: white fill, black border
            # - Storages: keep rounded edges
            if kind == "component":
                fill = "#e5e7eb"
                rounded = "rounded=0;"
            elif kind == "storage":
                fill = "#f3f4f6"
                rounded = "rounded=1;arcSize=50;"
            else:
                fill = "#ffffff"
                rounded = "rounded=0;"
            return (
                f"{rounded}whiteSpace=wrap;html=1;"
                f"fillColor={fill};strokeColor=#000000;fontColor=#000000;"
                "align=center;verticalAlign=bottom;spacingBottom=10;"
            )
        
        def icon_uri_for(kind: str) -> Optional[str]:
            if kind == "human":
                return ICONS.get("human")
            if kind == "storage":
                return ICONS.get("storage")
            if kind == "agent":
                p = ICONS_DIR / "agent.svg"
                if p.exists():
                    return _b64_data_uri(p.read_bytes())
            return None
        
        def sub_box_w(label: str) -> int:
            # Size boxes so labels fit; still cap to avoid absurd widths.
            n = len(label.strip())
            return int(max(92, min(180, 10 * n + 26)))
        
        def component_width(comp_name: str) -> int:
            subs = component_subs.get(comp_name) or []
            if not subs:
                return tile_w
            pad_x = 12
            h_gap = 10
            widths = [sub_box_w(s) for s in subs]
            needed = pad_x * 2 + sum(widths) + h_gap * max(0, len(widths) - 1)
            return int(max(tile_w, needed))
        
        def component_height(comp_name: str) -> int:
            subs = component_subs.get(comp_name) or []
            if not subs:
                return tile_h
            header_h = 72  # title + icon area
            sub_h = 30
            pad_bottom = 14
            return int(max(tile_h, header_h + sub_h + pad_bottom))
        
        # Group nodes by kind for banded layout:
        # humans (top), agents+components (middle), storages (bottom)
        humans = [n for (k, n) in nodes if k == "human"]
        storages = [n for (k, n) in nodes if k == "storage"]
        agents = [n for (k, n) in nodes if k == "agent"]
        components = [n for (k, n) in nodes if k == "component"]

        # Boundary config (optional):
        # boundaries:
        #   left:  { enabled: true,  label: "On-Premise" }
        #   right: { enabled: true,  label: "Cloud" }
        bcfg = getattr(model, "boundaries", {}) or {}
        left_cfg = bcfg.get("left") or {}
        right_cfg = bcfg.get("right") or {}
        left_enabled = bool(left_cfg.get("enabled")) if isinstance(left_cfg, dict) else False
        right_enabled = bool(right_cfg.get("enabled")) if isinstance(right_cfg, dict) else False

        # Auto-enable a boundary if any components are assigned to it (defensive against missing boundaries block).
        if not left_enabled and any(v == 'left' for v in list(component_boundary.values()) + list(human_boundary.values()) + list(agent_boundary.values()) + list(storage_boundary.values())):
            left_enabled = True
        if not right_enabled and any(v == 'right' for v in list(component_boundary.values()) + list(human_boundary.values()) + list(agent_boundary.values()) + list(storage_boundary.values())):
            right_enabled = True
        left_label = (left_cfg.get("label") if isinstance(left_cfg, dict) else None) or ""
        right_label = (right_cfg.get("label") if isinstance(right_cfg, dict) else None) or ""

        # Treat boundary assignments as effective only when that boundary is enabled.
        def _eff(b: Any) -> str | None:
            if b == "left" and left_enabled:
                return "left"
            if b == "right" and right_enabled:
                return "right"
            return None

        left_components = [c for c in components if _eff(component_boundary.get(c)) == "left"]
        right_components = [c for c in components if _eff(component_boundary.get(c)) == "right"]
        main_components = [c for c in components if _eff(component_boundary.get(c)) is None]

        left_humans = [h for h in humans if _eff(human_boundary.get(h)) == 'left']
        right_humans = [h for h in humans if _eff(human_boundary.get(h)) == 'right']
        main_humans = [h for h in humans if _eff(human_boundary.get(h)) is None]

        left_agents = [a for a in agents if _eff(agent_boundary.get(a)) == 'left']
        right_agents = [a for a in agents if _eff(agent_boundary.get(a)) == 'right']
        main_agents = [a for a in agents if _eff(agent_boundary.get(a)) is None]

        left_storages = [s for s in storages if _eff(storage_boundary.get(s)) == 'left']
        right_storages = [s for s in storages if _eff(storage_boundary.get(s)) == 'right']
        main_storages = [s for s in storages if _eff(storage_boundary.get(s)) is None]

        
        node_id: Dict[str, str] = {}
        node_geom: Dict[str, Tuple[float,float,float,float]] = {}
        max_x = 0.0
        
        # Compute an overall row wrap width based on the classic 6-column layout.
        max_wrap_w = margin_x * 2 + 6 * tile_w + 5 * gap_x
        
        def pack_items(items: List[Tuple[str, str]], y0: float, start_x: float, wrap_right: float) -> float:
            """Place variable-size items left-to-right, wrapping within [start_x, wrap_right]."""
            nonlocal max_x
            if not items:
                return y0
            x = start_x
            y = y0
            row_h = 0
            for kind, name in items:
                w = tile_w
                h = tile_h
                if kind == "component":
                    w = component_width(name)
                    h = component_height(name)
                # wrap if needed
                if x != start_x and (x + w) > wrap_right:
                    x = start_x
                    y += row_h + gap_y
                    row_h = 0
                cid = stable_id(kind, name)
                cell_value = esc(name) if kind != "component" else ""
                cells.append(xml_cell(id=cid, value=cell_value, style=card_style(kind), vertex=True, parent="1", x=x, y=y, w=w, h=h))
                node_id[name] = cid
                node_geom[name] = (float(x), float(y), float(w), float(h))
                max_x = max(max_x, x + w)
                if kind == "component":
                    # Title header so subs never cover it
                    cells.append(xml_cell(id=stable_id("component-title", name), value=esc(name), style=style_text() + "fontStyle=1;align=center;verticalAlign=middle;", vertex=True, parent=cid, x=10, y=6, w=w-20, h=20))
                uri = icon_uri_for(kind)
                if uri:
                    icon_y = 28 if kind == "component" else 12
                    cells.append(xml_cell(id=stable_id(f"{kind}-icon", name), value="", style=style_image(uri), vertex=True, parent=cid, x=(w - icon)/2, y=icon_y, w=icon, h=icon))
                if kind == "component":
                    subs = component_subs.get(name) or []
                    if subs:
                        pad_x = 12
                        h_gap = 10
                        sub_h = 30
                        y_sc0 = 72
                        sx = pad_x
                        for sn in subs:
                            qname = f"{name}/{sn}"
                            sid = stable_id("subcomponent", qname)
                            sw = sub_box_w(sn)
                            cells.append(xml_cell(id=sid, value=esc(sn), style=("rounded=0;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#000000;fontColor=#000000;align=center;verticalAlign=middle;fontSize=11;"), vertex=True, parent=cid, x=sx, y=y_sc0, w=sw, h=sub_h))
                            node_id[qname] = sid
                            node_geom[qname] = (float(x+sx), float(y+y_sc0), float(sw), float(sub_h))
                            sx += sw + h_gap
                row_h = max(row_h, h)
                x += w + gap_x
            # return next y cursor
            return y + row_h
        y_cursor = margin_y
        # Lane calculations for boundaries (all node types).
        def _w(kind: str, name: str) -> float:
            if kind == "component":
                return float(component_width(name))
            return float(tile_w)

        def lane_row_width(items: List[Tuple[str, str]]) -> float:
            if not items:
                return 0.0
            return sum(_w(k, n) for (k, n) in items) + gap_x * max(0, len(items) - 1)

        left_top = [("human", n) for n in left_humans]
        left_mid = [("agent", n) for n in left_agents] + [("component", n) for n in left_components]
        left_bot = [("storage", n) for n in left_storages]
        left_lane_w = max(lane_row_width(left_top), lane_row_width(left_mid), lane_row_width(left_bot))

        right_top = [("human", n) for n in right_humans]
        right_mid = [("agent", n) for n in right_agents] + [("component", n) for n in right_components]
        right_bot = [("storage", n) for n in right_storages]
        right_lane_w = max(lane_row_width(right_top), lane_row_width(right_mid), lane_row_width(right_bot))

        # Estimate main lane width using the classic 6-column layout.
        main_wrap_left = margin_x
        # Start main lane after left boundary line if enabled
        if left_enabled:
            main_wrap_left = margin_x + left_lane_w + gap_x * 2
        main_wrap_right = main_wrap_left + max_wrap_w
        if right_enabled:
            main_wrap_right = main_wrap_left + max_wrap_w
        y_top = y_cursor
        y_left_top = y_top
        y_main_top = y_top
        y_right_top = y_top
        if left_enabled and left_humans:
            left_wrap_left = margin_x
            left_wrap_right = margin_x + left_lane_w + gap_x
            y_left_top = pack_items([("human", n) for n in left_humans], y_top, left_wrap_left, left_wrap_right)
        if main_humans:
            y_main_top = pack_items([("human", n) for n in main_humans], y_top, main_wrap_left, main_wrap_right)
        if right_enabled and right_humans:
            right_wrap_left = main_wrap_right + gap_x
            right_wrap_right = right_wrap_left + right_lane_w + gap_x
            y_right_top = pack_items([("human", n) for n in right_humans], y_top, right_wrap_left, right_wrap_right)
        y_cursor = max(y_left_top, y_main_top, y_right_top)
        if humans and (agents or components):
            y_cursor += gap_y * 2
        
        middle_items: List[Tuple[str, str]] = [("agent", n) for n in main_agents] + [("component", n) for n in main_components]
        # Render the middle row even if the "main" lane is empty, as long as any lane has content.
        if middle_items or (left_enabled and (left_components or left_agents)) or (right_enabled and (right_components or right_agents)):
            y_mid = y_cursor + gap_y  # small spacer

            # left lane components
            y_left_end = y_mid
            if left_enabled and left_components:
                left_wrap_left = margin_x
                left_wrap_right = margin_x + left_lane_w + gap_x
                y_left_end = pack_items([("agent", n) for n in left_agents] + [("component", n) for n in left_components], y_mid, left_wrap_left, left_wrap_right)

            # main lane items (agents + unassigned components)
            y_main_end = y_mid
            if middle_items:
                y_main_end = pack_items(middle_items, y_mid, main_wrap_left, main_wrap_right)

            # right lane components
            y_right_end = y_mid
            if right_enabled and right_components:
                right_wrap_left = main_wrap_right + gap_x
                right_wrap_right = right_wrap_left + right_lane_w + gap_x
                y_right_end = pack_items([("agent", n) for n in right_agents] + [("component", n) for n in right_components], y_mid, right_wrap_left, right_wrap_right)

            y_cursor = max(y_left_end, y_main_end, y_right_end)


        # Storages (databases) render in the bottom band, split across lanes.
        if storages:
            if humans or agents or components or left_components or right_components or left_agents or right_agents:
                y_cursor += gap_y * 2
            y_bot = y_cursor
            y_left_bot = y_bot
            y_main_bot = y_bot
            y_right_bot = y_bot
            if left_enabled and left_storages:
                left_wrap_left = margin_x
                left_wrap_right = margin_x + left_lane_w + gap_x
                y_left_bot = pack_items([("storage", n) for n in left_storages], y_bot, left_wrap_left, left_wrap_right)
            if main_storages:
                y_main_bot = pack_items([("storage", n) for n in main_storages], y_bot, main_wrap_left, main_wrap_right)
            if right_enabled and right_storages:
                right_wrap_left = main_wrap_right + gap_x
                right_wrap_right = right_wrap_left + right_lane_w + gap_x
                y_right_bot = pack_items([("storage", n) for n in right_storages], y_bot, right_wrap_left, right_wrap_right)
            y_cursor = max(y_left_bot, y_main_bot, y_right_bot)

        
        def lane_of(endpoint: str) -> str:
            # Normalize endpoints
            e = endpoint.replace(" / ", "/")
            if e in left_humans or e in left_agents or e in left_components or e in left_storages:
                return "left"
            if e in right_humans or e in right_agents or e in right_components or e in right_storages:
                return "right"
            # Subcomponents inherit via their parent component boundary
            if "/" in e:
                parent = e.split("/", 1)[0]
                if parent in left_components:
                    return "left"
                if parent in right_components:
                    return "right"
            return "main"

        def gutter_x_between(lane_a: str, lane_b: str) -> float:
            # Returns an x coordinate in the whitespace between lanes for safer vertical routing.
            lanes = {lane_a, lane_b}
            if lanes == {"left", "main"}:
                return main_wrap_left - gap_x / 2.0
            if lanes == {"main", "right"}:
                return main_wrap_right + gap_x / 2.0
            if lanes == {"left", "right"}:
                return (main_wrap_left + main_wrap_right) / 2.0
            return (main_wrap_left + main_wrap_right) / 2.0
# Render edges for channels/accesses (works with subcomponents too)
        def norm_endpoint(s: Any) -> str:
            if s is None:
                return ""
            t = str(s).strip()
            # Allow display-friendly "A / B" to resolve to "A/B"
            t = t.replace(" / ", "/")
            return t

        def add_edge(
            from_name: str,
            to_name: str,
            *,
            tam_category: str,
            tam_edge_type: str,
            tam_direction: str,
            protocol: str | None = None,
            display_as_double_arc: bool | None = None,
            source_arrow_pos: float | None = None,
            target_arrow_pos: float | None = None,
            r_marker_pos: float | None = None,
            modify_symbol_pos: float | None = None,
        ):
            a = norm_endpoint(from_name)
            b = norm_endpoint(to_name)
            if a not in node_id or b not in node_id:
                return

            # Backward compatibility: if missing, render as communication/unidirectional.
            if not tam_category:
                tam_category = "communication"
            if not tam_edge_type:
                tam_edge_type = "unidirectional" if tam_category == "communication" else "readAccess"
            if tam_direction not in ("sourceToTarget", "targetToSource"):
                tam_direction = "sourceToTarget"

            # Marker defaults (0..1 along edge). We render arrows / markers as
            # child vertices so their position is draggable and persists into draw.io.
            def clamp01(v: float) -> float:
                try:
                    v = float(v)
                except Exception:
                    return 0.5
                return max(0.0, min(1.0, v))

            # Default marker placement:
            # - For general links: near the ends (0.1/0.9)
            # - For storage accesses: keep the arrow/symbol close to the storage endpoint
            #   (PowerDesigner TAM look: markers sit just above the storage).
            a_is_storage = a in storage_nodes
            b_is_storage = b in storage_nodes

            if source_arrow_pos is None:
                source_arrow_pos = 0.08 if a_is_storage else 0.1
            if target_arrow_pos is None:
                target_arrow_pos = 0.92 if b_is_storage else 0.9
            if r_marker_pos is None:
                r_marker_pos = 0.5
            if modify_symbol_pos is None:
                # Place modify symbol close to the storage endpoint.
                if b_is_storage:
                    modify_symbol_pos = 0.92
                elif a_is_storage:
                    modify_symbol_pos = 0.08
                else:
                    modify_symbol_pos = 0.5

            source_arrow_pos = clamp01(source_arrow_pos)
            target_arrow_pos = clamp01(target_arrow_pos)
            r_marker_pos = clamp01(r_marker_pos)
            modify_symbol_pos = clamp01(modify_symbol_pos)

            # B-by-default: for storage modify-access, snap the symbol near the storage endpoint
            # unless the user explicitly moved it away from the midpoint.
            # (Heuristic: if the provided value is exactly 0.5, treat it as "not customized".)
            if tam_category == "access" and tam_edge_type == "modifyAccess" and (a_is_storage or b_is_storage):
                if abs(float(modify_symbol_pos) - 0.5) < 1e-9:
                    modify_symbol_pos = 0.92 if b_is_storage else 0.08

            # Which movable markers should be present?
            show_source_arrow = False
            show_target_arrow = False
            if tam_category == "communication":
                if tam_edge_type in ("bidirectional", "requestResponse"):
                    show_source_arrow, show_target_arrow = True, True
                else:
                    if tam_direction == "sourceToTarget":
                        show_target_arrow = True
                    else:
                        show_source_arrow = True
            else:
                # access
                if tam_edge_type == "modifyAccess":
                    # PowerDesigner TAM uses the double-arc symbol to indicate
                    # modify (read+write). Do not add arrowheads for this case.
                    show_source_arrow, show_target_arrow = False, False
                else:
                    if tam_direction == "sourceToTarget":
                        show_target_arrow = True
                    else:
                        show_source_arrow = True

            def style_arrow_marker(rotation_deg: float) -> str:
                # Triangle base direction is east; we rotate it to align to the edge.
                return (
                    "shape=triangle;perimeter=none;resizable=0;rotatable=0;"
                    "direction=east;fillColor=#000000;strokeColor=#000000;strokeWidth=1;"
                    f"rotation={rotation_deg};"
                )

            # Compute an orthogonal route that avoids overlapping nodes where possible.
            def center(n: str) -> Tuple[float, float, float, float, float, float]:
                x, y, w, h = node_geom.get(n, (0.0, 0.0, 0.0, 0.0))
                return x, y, w, h, x + w / 2.0, y + h / 2.0

            ax, ay, aw, ah, acx, acy = center(a)
            bx, by, bw, bh, bcx, bcy = center(b)

            
            pad = 18.0
            lane_a = lane_of(a)
            lane_b = lane_of(b)

            # Inflate obstacles slightly so edges keep a clean margin.
            margin = 14.0

            def inflated_rect(n: str) -> Tuple[float, float, float, float]:
                x, y, w, h = node_geom.get(n, (0.0, 0.0, 0.0, 0.0))
                return (x - margin, y - margin, w + 2 * margin, h + 2 * margin)

            obstacles: List[Tuple[float, float, float, float]] = []
            for k in node_geom.keys():
                if k in (a, b):
                    continue
                ox, oy, ow, oh = inflated_rect(k)
                if ow > 0 and oh > 0:
                    obstacles.append((ox, oy, ow, oh))

            def seg_hits_rect_h(x1: float, x2: float, y: float, r: Tuple[float, float, float, float]) -> bool:
                rx, ry, rw, rh = r
                xmin, xmax = (x1, x2) if x1 <= x2 else (x2, x1)
                return (y >= ry and y <= ry + rh) and not (xmax < rx or xmin > rx + rw)

            def seg_hits_rect_v(x: float, y1: float, y2: float, r: Tuple[float, float, float, float]) -> bool:
                rx, ry, rw, rh = r
                ymin, ymax = (y1, y2) if y1 <= y2 else (y2, y1)
                return (x >= rx and x <= rx + rw) and not (ymax < ry or ymin > ry + rh)

            def seg_clear_h(x1: float, x2: float, y: float) -> bool:
                return not any(seg_hits_rect_h(x1, x2, y, r) for r in obstacles)

            def seg_clear_v(x: float, y1: float, y2: float) -> bool:
                return not any(seg_hits_rect_v(x, y1, y2, r) for r in obstacles)

            def side_x(toward_right: bool, x: float, w: float) -> float:
                return (x + w + pad) if toward_right else (x - pad)

            # Global extreme corridors (outside everything) – very reliable escape routes.
            all_x = [ax, ax + aw, bx, bx + bw] + [ox for (ox, _, ow, _) in obstacles] + [ox + ow for (ox, _, ow, _) in obstacles]
            min_x = min(all_x) if all_x else 0.0
            max_x = max(all_x) if all_x else 800.0
            far_left = min_x - 80.0
            far_right = max_x + 80.0

            # Candidate spine X values (corridors). Try gutters first, then far corridors as a last resort.
            candidates: List[float] = []
            if lane_a != lane_b:
                gx = gutter_x_between(lane_a, lane_b)
                candidates.extend([gx, gx - 120.0, gx + 120.0, far_left, far_right])
            else:
                base = side_x(bcx >= acx, ax, aw)
                candidates.extend([base, base - 120.0, base + 120.0, far_left, far_right])

            points: List[Tuple[float, float]] = []

            def route_via(spine_x: float, detour_y: float | None = None) -> Optional[List[Tuple[float, float]]]:
                # Build waypoints outside source/target perimeters.
                src_out_x = side_x(spine_x >= acx, ax, aw)
                tgt_out_x = side_x(spine_x <= bcx, bx, bw)

                if detour_y is None:
                    # src_out -> spine -> tgt_out (single dogleg)
                    if not seg_clear_h(acx, src_out_x, acy):
                        return None
                    if not seg_clear_h(src_out_x, spine_x, acy):
                        return None
                    if not seg_clear_v(spine_x, acy, bcy):
                        return None
                    if not seg_clear_h(spine_x, tgt_out_x, bcy):
                        return None
                    if not seg_clear_h(tgt_out_x, bcx, bcy):
                        return None
                    return [(src_out_x, acy), (spine_x, acy), (spine_x, bcy), (tgt_out_x, bcy)]
                else:
                    # src_out -> spine -> detour_y -> tgt_out -> target
                    if not seg_clear_h(acx, src_out_x, acy):
                        return None
                    if not seg_clear_h(src_out_x, spine_x, acy):
                        return None
                    if not seg_clear_v(spine_x, acy, detour_y):
                        return None
                    if not seg_clear_h(spine_x, tgt_out_x, detour_y):
                        return None
                    if not seg_clear_v(tgt_out_x, detour_y, bcy):
                        return None
                    if not seg_clear_h(tgt_out_x, bcx, bcy):
                        return None
                    return [(src_out_x, acy), (spine_x, acy), (spine_x, detour_y), (tgt_out_x, detour_y), (tgt_out_x, bcy)]

            chosen: Optional[List[Tuple[float, float]]] = None

            # First try direct doglegs.
            for cx in candidates:
                chosen = route_via(cx)
                if chosen:
                    break

            # Then try detours above/below the overall obstacle field.
            if not chosen:
                obs_top = min([oy for (_, oy, _, _) in obstacles] + [ay, by]) if (obstacles or True) else min(ay, by)
                obs_bot = max([oy + oh for (_, oy, _, oh) in obstacles] + [ay + ah, by + bh]) if (obstacles or True) else max(ay + ah, by + bh)
                detours = [obs_top - 70.0, obs_bot + 70.0]
                for cx in candidates:
                    for dy in detours:
                        chosen = route_via(cx, dy)
                        if chosen:
                            break
                    if chosen:
                        break

            if chosen:
                # mxGraph expects intermediate points; including perimeter-adjacent points improves obstacle avoidance.
                points = chosen
            else:
                # Fallback: provide a simple spine so at least the edge is orthogonal-ish.
                spine_x = candidates[0]
                points = [(spine_x, acy), (spine_x, bcy)]

            # Choose consistent connection sides (ports). If endpoints are vertically aligned,
            # prefer left-to-left routing to keep the edge outside boxes.
            dx = bcx - acx
            dy = bcy - acy

            # Choose ports + a corridor that avoids obstacles.
            # We try multiple port combinations and pick the lowest-cost route.
            def port_x(side: str, x: float, w: float) -> float:
                return (x - pad) if side == "L" else (x + w + pad)

            def exit_entry_style(src_side: str, tgt_side: str) -> str:
                exitX = 0 if src_side == "L" else 1
                entryX = 0 if tgt_side == "L" else 1
                return f"exitX={exitX};exitY=0.5;entryX={entryX};entryY=0.5;"

            def route_points(src_side: str, tgt_side: str, spine_x: float) -> List[Tuple[float, float]]:
                sx = port_x(src_side, ax, aw)
                tx = port_x(tgt_side, bx, bw)
                # Two-turn orthogonal dogleg via spine_x.
                return [(sx, acy), (spine_x, acy), (spine_x, bcy), (tx, bcy)]

            def route_cost(pts: List[Tuple[float, float]]) -> Tuple[float, int]:
                # Cost = manhattan length + overlap count penalty.
                length = 0.0
                hits = 0
                for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
                    length += abs(x2 - x1) + abs(y2 - y1)
                    # Count overlaps with inflated obstacles.
                    for r in obstacles:
                        if x1 == x2:
                            if seg_hits_rect_v(x1, y1, y2, r):
                                hits += 1
                        elif y1 == y2:
                            if seg_hits_rect_h(x1, x2, y1, r):
                                hits += 1
                return (length, hits)

            # Candidate spines: between nodes + far left/right escapes.
            between_x = (acx + bcx) / 2.0
            far_left = min(ax, bx) - (pad + 60.0)
            far_right = max(ax + aw, bx + bw) + (pad + 60.0)
            spines = [between_x, far_left, far_right]

            # Candidate port pairs. Prefer "facing" ports, but allow same-side.
            # If mostly vertical alignment, bias toward left-left first (cleaner and consistent).
            mostly_vertical = abs(dx) < 0.35 * max(aw, bw) and abs(dy) > 0.5 * max(ah, bh)
            port_pairs = [("L", "L"), ("R", "R"), ("R", "L"), ("L", "R")] if mostly_vertical else [("R", "L"), ("L", "R"), ("L", "L"), ("R", "R")]

            best = None  # (hits, length, src_side, tgt_side, spine_x, pts)
            for src_side, tgt_side in port_pairs:
                for spine_x in spines:
                    pts = route_points(src_side, tgt_side, spine_x)
                    length, hits = route_cost(pts)
                    cand = (hits, length, src_side, tgt_side, spine_x, pts)
                    if best is None or cand < best:
                        best = cand
                    if hits == 0:
                        # Early exit on a perfect route.
                        break
                if best and best[0] == 0:
                    break

            assert best is not None
            _, _, src_side, tgt_side, spine_x, pts = best

            exit_entry = exit_entry_style(src_side, tgt_side)
            # mxGeometry points: omit the first/last "port" points so mxGraph can attach neatly.
            points = [(x, y) for (x, y) in pts[1:-1]]

            # Helper: angle (deg) of the polyline segment at a relative position t in [0..1].
            def angle_at(t: float) -> float:
                t = max(0.0, min(1.0, float(t)))
                poly = pts[:]  # includes endpoints
                if len(poly) < 2:
                    return 0.0
                seg_lens: List[float] = []
                total = 0.0
                for (x1, y1), (x2, y2) in zip(poly, poly[1:]):
                    l = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
                    seg_lens.append(l)
                    total += l
                if total <= 1e-6:
                    x1, y1 = poly[0]
                    x2, y2 = poly[-1]
                    return math.degrees(math.atan2(y2 - y1, x2 - x1))
                target = t * total
                acc = 0.0
                for i, l in enumerate(seg_lens):
                    if acc + l >= target and l > 1e-6:
                        (x1, y1) = poly[i]
                        (x2, y2) = poly[i + 1]
                        return math.degrees(math.atan2(y2 - y1, x2 - x1))
                    acc += l
                (x1, y1) = poly[-2]
                (x2, y2) = poly[-1]
                return math.degrees(math.atan2(y2 - y1, x2 - x1))

            # Center labels for TAM channels. (Access links generally don't use text labels.)
            label_offset = None

            style_meta = f"tamCategory={tam_category};tamEdgeType={tam_edge_type};direction={tam_direction};"
            if protocol:
                # Persist protocol for communication links.
                style_meta += f"protocol={protocol};"
            if tam_edge_type == "modifyAccess" and display_as_double_arc is not None:
                style_meta += f"displayAsDoubleArc={'1' if display_as_double_arc else '0'};"

            # Persist marker positions so draw.io exports are stable.
            style_meta += f"sourceArrowPos={source_arrow_pos};targetArrowPos={target_arrow_pos};"
            if tam_edge_type == "requestResponse":
                style_meta += f"rMarkerPos={r_marker_pos};"
            if tam_edge_type == "modifyAccess":
                style_meta += f"modifySymbolPos={modify_symbol_pos};"

            # Access links are visually distinct (dashed) in TAM diagrams.
            # Exception: modifyAccess is shown with the double-arc symbol (solid line).
            extra_style = ""
            if tam_category == "access" and tam_edge_type != "modifyAccess":
                extra_style = "dashed=1;dashPattern=4 4;"

            eid = stable_id("edge", f"{a}|{b}:{tam_category}:{tam_edge_type}:{tam_direction}:{protocol or ''}")
            cells.append(
                xml_cell(
                    id=eid,
                    # Protocol is rendered as an inline label near the TAM circle (not centered).
                    value="",
                    # Arrowheads are rendered as child marker vertices (movable).
                    style=style_edge(end=False, start=False)
                    + extra_style
                    + style_meta
                    + ("exitPerimeter=1;entryPerimeter=1;" + exit_entry)
                    + "labelPosition=center;verticalLabelPosition=middle;labelBackgroundColor=#ffffff;",
                    edge=True,
                    parent="1",
                    source=node_id[a],
                    target=node_id[b],
                    relative=True,
                    points=points,
                    offset=label_offset,
                )
            )

            # --- SAP PowerDesigner TAM inline notation (as in the reference image) ---
            # IMPORTANT (export stability): draw.io is much more reliable when the TAM marker
            # is a *single* edge-attached image/label rather than multiple tiny child shapes.
            # We therefore render the circle+arrows as one SVG image, plus optional "R" text.
            if tam_category == "communication":
                marker_pos = r_marker_pos if tam_edge_type == "requestResponse" else (
                    (float(source_arrow_pos) + float(target_arrow_pos)) / 2.0
                    if (source_arrow_pos is not None and target_arrow_pos is not None)
                    else 0.5
                )
                marker_pos = max(0.05, min(0.95, float(marker_pos)))

                # PowerDesigner-like marker placed on the edge.
                # IMPORTANT: Unidirectional must show a single arrow only.
                is_uni = tam_edge_type == "unidirectional"
                icon_key = "tam_comm_marker_uni" if is_uni else "tam_comm_marker_bi"
                # For unidirectional, rotate the arrow to match the edge direction ("C" behavior).
                # For bidirectional / requestResponse, PowerDesigner-style marker is orientation-agnostic.
                rot = 0.0
                if is_uni:
                    ang = angle_at(marker_pos)
                    rot = ang + (180.0 if tam_direction == "targetToSource" else 0.0)
                cells.append(
                    xml_cell(
                        id=stable_id("tam", eid + ":marker"),
                        value="",
                        style=style_image(ICONS[icon_key]) + (f"perimeter=none;rotation={rot:.2f};" if is_uni else "perimeter=none;"),
                        vertex=True,
                        parent=eid,
                        x=marker_pos,
                        y=0,
                        w=20,
                        h=20,
                        relative=True,
                        offset=(-10, -10),
                    )
                )

                # Protocol label slightly to the right (like JDBC in the screenshot).
                if protocol:
                    cells.append(
                        xml_cell(
                            id=stable_id("tam", eid + ":proto"),
                            value=esc(protocol),
                            style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;fontSize=11;fontColor=#000000;",
                            vertex=True,
                            parent=eid,
                            x=marker_pos,
                            y=0,
                            w=120,
                            h=16,
                            relative=True,
                            # Use geometry offset (not x-jitter) so draw.io stays consistent.
                            offset=(18, -7),
                        )
                    )

                # "R" marker (request/response) above the circle.
                if tam_edge_type == "requestResponse":
                    cells.append(
                        xml_cell(
                            id=stable_id("tam", eid + ":R"),
                            value="R",
                            style="text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;fontSize=11;fontColor=#000000;fontStyle=1;",
                            vertex=True,
                            parent=eid,
                            x=marker_pos,
                            y=0,
                            w=14,
                            h=14,
                            relative=True,
                            offset=(2, -26),
                        )
                    )

            else:
                # Movable arrow markers (as child vertices on the edge) for non-communication (eg. access).
                if show_source_arrow:
                    # Storage access: place the marker just above the storage endpoint.
                    # Use a fixed up-arrow icon when storage is the source.
                    if a_is_storage:
                        cells.append(
                            xml_cell(
                                id=stable_id("arr", eid + ":src"),
                                value="",
                                style=style_image(ICONS["tam_access_arrow_up"]) + "perimeter=none;",
                                vertex=True,
                                parent=eid,
                                x=source_arrow_pos,
                                y=0,
                                w=12,
                                h=12,
                                relative=True,
                                # Lift it slightly so it sits above the storage boundary.
                                offset=(-6, -18),
                            )
                        )
                    else:
                        # Fallback: align triangle to edge direction.
                        ang = angle_at(source_arrow_pos)
                        rot = ang + (180.0 if tam_direction == "targetToSource" else 0.0)
                        cells.append(
                            xml_cell(
                                id=stable_id("arr", eid + ":src"),
                                value="",
                                style=style_arrow_marker(rot),
                                vertex=True,
                                parent=eid,
                                x=source_arrow_pos,
                                y=0,
                                w=8,
                                h=8,
                                relative=True,
                                offset=(-4, -4),
                            )
                        )
                if show_target_arrow:
                    # Storage access: use down-arrow icon when storage is the target.
                    if b_is_storage:
                        cells.append(
                            xml_cell(
                                id=stable_id("arr", eid + ":tgt"),
                                value="",
                                style=style_image(ICONS["tam_access_arrow_down"]) + "perimeter=none;",
                                vertex=True,
                                parent=eid,
                                x=target_arrow_pos,
                                y=0,
                                w=12,
                                h=12,
                                relative=True,
                                offset=(-6, -18),
                            )
                        )
                    else:
                        ang = angle_at(target_arrow_pos)
                        rot = ang + (180.0 if tam_direction == "targetToSource" else 0.0)
                        cells.append(
                            xml_cell(
                                id=stable_id("arr", eid + ":tgt"),
                                value="",
                                style=style_arrow_marker(rot),
                                vertex=True,
                                parent=eid,
                                x=target_arrow_pos,
                                y=0,
                                w=8,
                                h=8,
                                relative=True,
                                offset=(-4, -4),
                            )
                        )

            # Modify-access marker: double-arc icon anchored to edge geometry.
            if tam_category == "access" and tam_edge_type == "modifyAccess" and (display_as_double_arc is None or display_as_double_arc):
                cells.append(
                    xml_cell(
                        id=stable_id("mod", eid + ":m"),
                        value="",
                        style=style_image(ICONS["modify_access_double_arc"]) + "perimeter=none;",
                        vertex=True,
                        parent=eid,
                        x=modify_symbol_pos,
                        y=0,
                        w=64,
                        h=20,
                        relative=True,
                        # Place the symbol centered on the edge.
                        offset=(-32, -10),
                    )
                )


        for c in list(getattr(model, "channels", []) or []):
            if not isinstance(c, dict):
                continue
            proto = str(c.get("protocol") or "").strip()
            if not proto:
                issues.append({"level":"error","message":"Channel protocol is required","path":"channels"})
                continue

            legacy_dir = normalize_direction(c.get("direction", "->"))
            tam_type = normalize_tam_comm_type(c.get("tamEdgeType"), legacy_dir)
            tam_dir = normalize_tam_direction(c.get("direction", "sourceToTarget"))
            # If legacy symbol was used, it overrides tam_dir.
            if legacy_dir in ("->", "<-"):
                tam_dir = "sourceToTarget" if legacy_dir == "->" else "targetToSource"
            if legacy_dir == "<->":
                tam_type = "bidirectional"
            if legacy_dir == "reqres":
                tam_type = "requestResponse"

            add_edge(
                c.get("from", ""),
                c.get("to", ""),
                tam_category="communication",
                tam_edge_type=tam_type,
                tam_direction=tam_dir,
                protocol=proto,
                source_arrow_pos=c.get("sourceArrowPos"),
                target_arrow_pos=c.get("targetArrowPos"),
                r_marker_pos=c.get("rMarkerPos"),
            )

        for a in list(getattr(model, "accesses", []) or []):
            if not isinstance(a, dict):
                continue
            tam_type = normalize_tam_access_type(a.get("tamEdgeType"), a.get("access"))
            tam_dir = normalize_tam_direction(a.get("direction", "sourceToTarget"))
            display_double = a.get("displayAsDoubleArc")
            if isinstance(display_double, str):
                display_double = display_double.strip().lower() not in ("0", "false", "no")
            if display_double is None:
                display_double = True

            # Best-effort legacy mapping for direction when only old access icon hints exist.
            legacy_access = str(a.get("access") or "").strip()
            if legacy_access == "read_write_modify_single_left":
                tam_dir = "targetToSource"

            add_edge(
                a.get("from", ""),
                a.get("to", ""),
                tam_category="access",
                tam_edge_type=tam_type,
                tam_direction=tam_dir,
                protocol=None,
                display_as_double_arc=bool(display_double) if tam_type == "modifyAccess" else None,
                source_arrow_pos=a.get("sourceArrowPos"),
                target_arrow_pos=a.get("targetArrowPos"),
                modify_symbol_pos=a.get("modifySymbolPos"),
            )

                # Boundary lines (optional) - dashed vertical lines outside main content
        # Left boundary line is drawn between left-lane and main lane.
        if left_enabled:
            x_line = main_wrap_left - gap_x  # line sits just before main lane
            cells.append(xml_cell(id=stable_id("boundary","left-line"), value="", style=style_boundary_line(), vertex=True, parent="1", x=x_line, y=0, w=1, h=2000))
            if left_label:
                cells.append(xml_cell(id=stable_id("boundary","left-label"), value=esc(left_label), style=style_text()+"fontStyle=1;align=right;", vertex=True, parent="1", x=x_line-252, y=6, w=240, h=20))
        if right_enabled:
            x_line = main_wrap_right + gap_x  # line after main lane
            cells.append(xml_cell(id=stable_id("boundary","right-line"), value="", style=style_boundary_line(), vertex=True, parent="1", x=x_line, y=0, w=1, h=2000))
            if right_label:
                cells.append(xml_cell(id=stable_id("boundary","right-label"), value=esc(right_label), style=style_text()+"fontStyle=1;align=left;", vertex=True, parent="1", x=x_line+12, y=6, w=240, h=20))
# Canvas size (best-effort)
        max_y = y_cursor + margin_y
        canvas_w = max(900, int(max_x + margin_x))
        canvas_h = max(520, int(max_y))

        # White canvas background
        cells.insert(
            2,
            xml_cell(
                id="bg",
                value="",
                style="shape=rectangle;rounded=0;fillColor=#ffffff;strokeColor=none;",
                vertex=True,
                parent="1",
                x=0,
                y=0,
                w=canvas_w,
                h=canvas_h,
            ),
        )

        graph_model = "\n".join(cells)
        xml = (
            "<mxfile host=\"app\" modified=\"2026-01-01T00:00:00.000Z\" agent=\"tam-yaml\" version=\"22.1.0\">"
            f"<diagram id=\"{esc(stable_id('diagram','page'))}\" name=\"Page-1\">"
            f"<mxGraphModel dx=\"1200\" dy=\"800\" grid=\"1\" gridSize=\"10\" guides=\"1\" tooltips=\"1\" connect=\"1\" arrows=\"1\" fold=\"1\" page=\"0\" pageScale=\"1\" pageWidth=\"{canvas_w}\" pageHeight=\"{canvas_h}\" math=\"0\" background=\"#ffffff\" shadow=\"0\">"
            "<root>"
            f"{graph_model}"
            "</root>"
            "</mxGraphModel>"
            "</diagram>"
            "</mxfile>"
        )
        return xml, issues


    # -----------------------------
    # Full renderer (legacy template layout)
    # -----------------------------
    # Template metrics (matching tam.png proportions, but at a larger canvas)
    canvas_w, canvas_h = 1600, 900
    margin = 40
    sidebar_w = 260
    gap_to_sidebar = 50

    main_w = canvas_w - margin * 2 - sidebar_w - gap_to_sidebar
    main_x = margin
    sidebar_x = main_x + main_w + gap_to_sidebar

    customers_h = 140
    server_h = 360
    erp_h = 220

    band_gap = 30
    customers_y = 30
    server_y = customers_y + customers_h + band_gap
    erp_y = server_y + server_h + band_gap

    # Trust boundaries are vertical regions across entire canvas (including sidebar)
    boundaries = [b for b in model.trust_boundaries if isinstance(b, dict) and b.get("name")]
    if boundaries:
        # If user provides explicit order, keep it; allocate equal widths across full canvas
        cols = len(boundaries)
        col_w = (canvas_w - 2 * margin) / cols
        boundary_regions: Dict[str, Tuple[float, float]] = {}
        for i, b in enumerate(boundaries):
            x0 = margin + i * col_w
            x1 = x0 + col_w
            boundary_regions[str(b["name"])] = (x0, x1)
    else:
        boundary_regions = {}

    # Node boundary assignment: YAML can set boundary per node using objects {name, boundary}
    def normalize_names(items: Any) -> List[Tuple[str, Optional[str]]]:
        out: List[Tuple[str, Optional[str]]] = []
        if not items:
            return out
        for it in items:
            if isinstance(it, str):
                out.append((it, None))
            elif isinstance(it, dict) and isinstance(it.get("name"), str):
                out.append((it["name"], it.get("boundary")))
        return out

    humans = normalize_names(model.human_agents)
    storages = normalize_names(model.storages)
    providers = normalize_names(model.external_providers)

    # components/agents: flatten top-level list of strings/objects with name
    system_nodes: List[Tuple[str, Optional[str]]] = []
    system_nodes += normalize_names(model.agents)
    system_nodes += normalize_names(model.components)

    # If areas exist, treat their children as components inside server. We keep visual primitive as boxes.
    def walk_area_children(nodes: Any):
        if not isinstance(nodes, list):
            return
        for n in nodes:
            if not isinstance(n, dict):
                continue
            nm = n.get("name")
            if isinstance(nm, str):
                # areas are containers, but template focuses on 3 core boxes; we still add extra boxes below if many.
                pass
            for ch in n.get("children") or []:
                if isinstance(ch, dict) and isinstance(ch.get("name"), str):
                    system_nodes.append((ch["name"], ch.get("boundary")))
                elif isinstance(ch, str):
                    system_nodes.append((ch, None))
            walk_area_children(n.get("children"))

    walk_area_children(model.areas)

    # Deduplicate while preserving order
    def dedup(items: List[Tuple[str, Optional[str]]]) -> List[Tuple[str, Optional[str]]]:
        seen = set()
        out = []
        for n, b in items:
            if n in seen:
                continue
            seen.add(n)
            out.append((n, b))
        return out

    humans = dedup(humans)
    storages = dedup(storages)
    providers = dedup(providers)
    system_nodes = dedup(system_nodes)

    # ---------------- cells ----------------
    cells: List[str] = []
    cells.append('<mxCell id="0"/>')
    cells.append('<mxCell id="1" parent="0"/>')

    # Background (white canvas like the example)
    cells.append(
        xml_cell(
            id="bg",
            value="",
            style="shape=rectangle;rounded=0;fillColor=#ffffff;strokeColor=none;",
            vertex=True,
            parent="1",
            x=0,
            y=0,
            w=canvas_w,
            h=canvas_h,
        )
    )

    # Trust boundary lines
    if boundary_regions:
        # draw dashed lines at region boundaries (between columns)
        # labels at top
        names = list(boundary_regions.keys())
        # sort by x
        names.sort(key=lambda n: boundary_regions[n][0])
        for i, name in enumerate(names):
            x0, x1 = boundary_regions[name]
            if i > 0:
                # line at x0
                lid = stable_id("boundary", f"line:{name}")
                cells.append(
                    xml_cell(
                        id=lid,
                        value="",
                        style=style_boundary_line(),
                        vertex=True,
                        parent="1",
                        x=x0,
                        y=0,
                        w=1,
                        h=canvas_h,
                    )
                )
            # label centered in region
            lab_id = stable_id("boundary", f"label:{name}")
            cx = (x0 + x1) / 2
            cells.append(
                xml_cell(
                    id=lab_id,
                    value=name,
                    style=style_text() + "fontStyle=1;",
                    vertex=True,
                    parent="1",
                    x=cx - 80,
                    y=6,
                    w=160,
                    h=20,
                )
            )

    # Customers container
    customers_id = stable_id("container", "Customers")
    cells.append(
        xml_cell(
            id=customers_id,
            value="",
            style=style_container(),
            vertex=True,
            parent="1",
            x=main_x,
            y=customers_y,
            w=main_w,
            h=customers_h,
        )
    )
    # Title label on border line
    cells.append(
        xml_cell(
            id=stable_id("label", "Customers"),
            value="Customers",
            style=style_text() + "fontStyle=1;",
            vertex=True,
            parent=customers_id,
            x=main_w / 2 - 80,
            y=-10,
            w=160,
            h=20,
        )
    )

    # Human tiles row
    tile_w, tile_h = 100, 70
    inner_pad = 18
    tile_y = inner_pad
    if humans:
        count = max(1, len(humans))
    else:
        count = 3
    # mimic example: show 3 tiles with ellipsis if more/less
    # We'll place up to 3 explicit tiles (first, second, last) with dots between like the example.
    show_tiles: List[Optional[str]] = []
    if len(humans) <= 3:
        show_tiles = [n for n, _ in humans] + [None] * (3 - len(humans))
    else:
        show_tiles = [humans[0][0], humans[1][0], humans[-1][0]]

    # spacing: left aligned two tiles, dots center, last tile right
    left_x = inner_pad
    right_x = main_w - inner_pad - tile_w
    mid_left_x = left_x + tile_w + 30
    # first tile
    for idx, name in enumerate(show_tiles):
        if idx == 0:
            x = left_x
        elif idx == 1:
            x = mid_left_x
        else:
            x = right_x
        tid = stable_id("human_tile", name or f"empty{idx}")
        cells.append(
            xml_cell(
                id=tid,
                value="" if name else "",
                style=style_box(),
                vertex=True,
                parent=customers_id,
                x=x,
                y=tile_y,
                w=tile_w,
                h=tile_h,
            )
        )
        # icon
        iid = stable_id("human_icon", tid)
        cells.append(
            xml_cell(
                id=iid,
                value="",
                style=style_image(ICONS["human"]),
                vertex=True,
                parent=tid,
                x=(tile_w - 36) / 2,
                y=10,
                w=36,
                h=36,
            )
        )

    # ellipsis in customers
    cells.append(
        xml_cell(
            id=stable_id("dots", "customers"),
            value="…",
            style=style_text() + "fontSize=18;",
            vertex=True,
            parent=customers_id,
            x=main_w / 2 - 20,
            y=tile_y + 18,
            w=40,
            h=30,
        )
    )

    # Online Shop Server container
    server_id = stable_id("container", "Online Shop Server")
    cells.append(
        xml_cell(
            id=server_id,
            value="",
            style=style_container(),
            vertex=True,
            parent="1",
            x=main_x,
            y=server_y,
            w=main_w,
            h=server_h,
        )
    )
    cells.append(
        xml_cell(
            id=stable_id("label", "Online Shop Server"),
            value="Online Shop Server",
            style=style_text() + "fontStyle=1;",
            vertex=True,
            parent=server_id,
            x=10,
            y=10,
            w=220,
            h=20,
        )
    )

    # 3 core component slots (keep structure even if model smaller)
    core_names = [
        "customer\naccount\nmaintenance",
        "product\npresentation +\nselection",
        "order\nprocessing",
    ]

    # if YAML defines at least 1-3 system nodes, use first three names
    used = [n for n, _ in system_nodes[:3]]
    for i in range(min(3, len(used))):
        core_names[i] = used[i].replace(" ", "\n")

    comp_w, comp_h = 240, 80
    comp_gap = 35
    comp_y = 55
    total_w = 3 * comp_w + 2 * comp_gap
    comp_x0 = (main_w - total_w) / 2

    comp_ids: List[str] = []
    for i, label in enumerate(core_names):
        cid = stable_id("component", f"core:{i}:{label}")
        comp_ids.append(cid)
        cells.append(
            xml_cell(
                id=cid,
                value=label,
                style=style_box(),
                vertex=True,
                parent=server_id,
                x=comp_x0 + i * (comp_w + comp_gap),
                y=comp_y,
                w=comp_w,
                h=comp_h,
            )
        )

    # shopping carts capsule area (always present)
    capsule_w, capsule_h = 520, 90
    capsule_x = (main_w - capsule_w) / 2
    capsule_y = 180
    capsule_id = stable_id("capsule", "shopping_carts")
    cells.append(
        xml_cell(
            id=capsule_id,
            value="",
            style="rounded=1;arcSize=50;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#000000;strokeWidth=1;",
            vertex=True,
            parent=server_id,
            x=capsule_x,
            y=capsule_y,
            w=capsule_w,
            h=capsule_h,
        )
    )
    # label "shopping carts" on top of capsule
    cells.append(
        xml_cell(
            id=stable_id("label", "shopping carts"),
            value="shopping carts",
            style=style_text() + "fontSize=12;",
            vertex=True,
            parent=server_id,
            x=capsule_x + 0,
            y=capsule_y - 16,
            w=capsule_w,
            h=20,
        )
    )
    # circles inside
    circ_r = 44
    circ_y = capsule_y + (capsule_h - circ_r) / 2
    left_cx = capsule_x + 55
    mid_cx = left_cx + 90
    right_cx = capsule_x + capsule_w - 55 - circ_r
    for j, cx in enumerate([left_cx, mid_cx, right_cx]):
        circles_id = stable_id("cart", f"{j}")
        cells.append(
            xml_cell(
                id=circles_id,
                value="",
                style=style_junction(),
                vertex=True,
                parent=server_id,
                x=cx,
                y=circ_y,
                w=circ_r,
                h=circ_r,
            )
        )
    cells.append(
        xml_cell(
            id=stable_id("dots", "carts"),
            value="…",
            style=style_text() + "fontSize=18;",
            vertex=True,
            parent=server_id,
            x=capsule_x + capsule_w / 2 - 20,
            y=circ_y + 4,
            w=40,
            h=30,
        )
    )

    # ERP data container (rounded)
    erp_id = stable_id("container", "ERP data")
    cells.append(
        xml_cell(
            id=erp_id,
            value="",
            style=style_container_rounded(),
            vertex=True,
            parent="1",
            x=main_x,
            y=erp_y,
            w=main_w,
            h=erp_h,
        )
    )
    cells.append(
        xml_cell(
            id=stable_id("label", "ERP data"),
            value="ERP data",
            style=style_text() + "fontStyle=1;",
            vertex=True,
            parent=erp_id,
            x=main_w / 2 - 60,
            y=-10,
            w=120,
            h=20,
        )
    )

    # storage pills row (keep 4 like example)
    storage_labels = ["customer\ndata", "product\ninformation", "product\navailability", "orders"]
    if storages:
        for i in range(min(4, len(storages))):
            storage_labels[i] = storages[i][0].replace(" ", "\n")

    pill_w, pill_h = 190, 80
    pill_gap = 30
    total_pw = 4 * pill_w + 3 * pill_gap
    pill_x0 = (main_w - total_pw) / 2
    pill_y = 70
    storage_ids: List[str] = []
    for i, label in enumerate(storage_labels):
        sid = stable_id("storage", f"{i}:{label}")
        storage_ids.append(sid)
        cells.append(
            xml_cell(
                id=sid,
                value=label,
                style=style_pill(),
                vertex=True,
                parent=erp_id,
                x=pill_x0 + i * (pill_w + pill_gap),
                y=pill_y,
                w=pill_w,
                h=pill_h,
            )
        )

    # Right sidebar container
    sidebar_id = stable_id("container", "service provider")
    cells.append(
        xml_cell(
            id=sidebar_id,
            value="",
            style=style_container(),
            vertex=True,
            parent="1",
            x=sidebar_x,
            y=server_y - 10,
            w=sidebar_w,
            h=server_h + erp_h + band_gap + 10,
        )
    )
    cells.append(
        xml_cell(
            id=stable_id("label", "service provider"),
            value="service\nprovider",
            style=style_text() + "fontStyle=1;",
            vertex=True,
            parent=sidebar_id,
            x=sidebar_w / 2 - 60,
            y=-10,
            w=120,
            h=34,
        )
    )

    provider_labels = ["credit card\ninstitutions", "shipping", "suppliers"]
    if providers:
        for i in range(min(3, len(providers))):
            provider_labels[i] = providers[i][0].replace(" ", "\n")

    pb_w, pb_h = sidebar_w - 30, 88
    pb_x, pb_y0, pb_gap = 15, 70, 18
    provider_ids: List[str] = []
    for i, label in enumerate(provider_labels):
        pid = stable_id("provider", f"{i}:{label}")
        provider_ids.append(pid)
        cells.append(
            xml_cell(
                id=pid,
                value=label,
                style=style_box(),
                vertex=True,
                parent=sidebar_id,
                x=pb_x,
                y=pb_y0 + i * (pb_h + pb_gap),
                w=pb_w,
                h=pb_h,
            )
        )

    # sidebar dots
    cells.append(
        xml_cell(
            id=stable_id("dots", "providers"),
            value="⋮",
            style=style_text() + "fontSize=18;",
            vertex=True,
            parent=sidebar_id,
            x=sidebar_w / 2 - 10,
            y=pb_y0 + 3 * (pb_h + pb_gap) + 10,
            w=20,
            h=30,
        )
    )

    # ---------------- Connections ----------------
    # Place junction circles where example shows: at vertical lines under customers interactions & at sidebar boundary.
    # We'll add 3 top junctions aligned with the 3 server components.
    juncs: List[Tuple[str, float, float]] = []

    # Junction positions inside main canvas (absolute)
    top_j_y = customers_y + customers_h + 6
    for i in range(3):
        cx = main_x + comp_x0 + i * (comp_w + comp_gap) + comp_w / 2
        jid = stable_id("junction", f"top{i}")
        juncs.append((jid, cx - 6, top_j_y - 6))
        cells.append(
            xml_cell(
                id=jid,
                value="",
                style=style_junction(),
                vertex=True,
                parent="1",
                x=cx - 6,
                y=top_j_y - 6,
                w=12,
                h=12,
            )
        )

    # Sidebar junction where server connects to service provider
    side_jid = stable_id("junction", "sidebar")
    side_jx = sidebar_x
    side_jy = server_y + 120
    cells.append(
        xml_cell(
            id=side_jid,
            value="",
            style=style_junction(),
            vertex=True,
            parent="1",
            x=side_jx - 6,
            y=side_jy - 6,
            w=12,
            h=12,
        )
    )

    # Add edges from junctions down to server components (vertical)
    for i, (jid, _, _) in enumerate(juncs):
        eid = stable_id("edge", f"j2c{i}")
        cells.append(
            xml_cell(
                id=eid,
                value="",
                style=style_edge(end=True, start=False),
                edge=True,
                parent="1",
                source=jid,
                target=comp_ids[i],
                x=0,
                y=0,
                relative=True,
            )
        )

    # Edge labels under Customers (match example phrasing if provided via channels between humans and components)
    default_labels = [
        "register\nedit profile\nbrowse orders",
        "search\nget prod. info\nselect items",
        "place order\ncancel order",
    ]
    # Map channel definitions from any human -> component to these slots in order
    ch_labels: List[str] = []
    ch_reqres: List[bool] = []
    for ch in model.channels:
        if not isinstance(ch, dict):
            continue
        if ch.get("protocol"):
            proto = str(ch.get("protocol") or "").strip()
            lab = str(ch.get("label") or "").strip()
            # If the user didn't specify interaction text, show the protocol as the label.
            text = lab or proto
            if text:
                ch_labels.append(text.replace("/", "\n").replace(",", "\n"))
                legacy_dir = normalize_direction(ch.get("direction", "->"))
                tam_type = normalize_tam_comm_type(ch.get("tamEdgeType"), legacy_dir)
                ch_reqres.append(tam_type == "requestResponse" or legacy_dir == "reqres")

    for i in range(3):
        lbl = default_labels[i]
        if i < len(ch_labels):
            lbl = ch_labels[i]
        lid = stable_id("edge_label", f"cust{i}")
        # label position near top lines
        lx = main_x + comp_x0 + i * (comp_w + comp_gap) + comp_w / 2 - 70
        ly = customers_y + customers_h - 5
        cells.append(
            xml_cell(
                id=lid,
                value=lbl,
                style=style_text(),
                vertex=True,
                parent="1",
                x=lx,
                y=ly,
                w=140,
                h=48,
            )
        )
        # R marker near junction (request/response only)
        if i < len(ch_reqres) and ch_reqres[i]:
            rid = stable_id("req", f"R{i}")
            cells.append(
                xml_cell(
                    id=rid,
                    value="R",
                    style=style_text() + "fontStyle=1;fontSize=11;",
                    vertex=True,
                    parent="1",
                    x=lx + 120,
                    y=ly + 30,
                    w=16,
                    h=16,
                )
            )

    # Access edges: connect server to ERP storages with orthogonal edges (matching example)
    # We'll always create two main flows: left comp to first storage, right comp to last storage
    acc1 = stable_id("edge", "acc-left")
    cells.append(
        xml_cell(
            id=acc1,
            value="",
            style=style_edge(end=True, start=True),
            edge=True,
            parent="1",
            source=comp_ids[0],
            target=storage_ids[0],
            relative=True,
        )
    )
    acc2 = stable_id("edge", "acc-right")
    cells.append(
        xml_cell(
            id=acc2,
            value="",
            style=style_edge(end=True, start=True),
            edge=True,
            parent="1",
            source=comp_ids[2],
            target=storage_ids[3],
            relative=True,
        )
    )

    # Access badges (SVG) placed near middle of edges
    def add_access_badge(edge_id: str, kind: str, x: float, y: float):
        bid = stable_id("access", f"{edge_id}:{kind}")
        cells.append(
            xml_cell(
                id=bid,
                value="",
                style=style_image(ICONS[kind]),
                vertex=True,
                parent="1",
                x=x,
                y=y,
                w=18,
                h=18,
            )
        )

    add_access_badge(acc1, "read_write_modify_both", main_x + 70, server_y + server_h - 40)
    add_access_badge(acc2, "read_write_modify_both", main_x + main_w - 120, server_y + server_h - 40)

    # Server -> provider connection with R marker
    sp_edge = stable_id("edge", "server-to-provider")
    cells.append(
        xml_cell(
            id=sp_edge,
            value="",
            style=style_edge(end=True, start=False),
            edge=True,
            parent="1",
            source=comp_ids[2],
            target=side_jid,
            relative=True,
        )
    )
    r3 = stable_id("req", "R-sp")
    cells.append(
        xml_cell(
            id=r3,
            value="R",
            style=style_text() + "fontStyle=1;fontSize=11;",
            vertex=True,
            parent="1",
            x=sidebar_x - 40,
            y=side_jy - 22,
            w=16,
            h=16,
        )
    )

    # ---------------- wrap ----------------
    graph_model = "\n".join(cells)
    xml = (
        "<mxfile host=\"app\" modified=\"2026-01-01T00:00:00.000Z\" agent=\"tam-yaml\" version=\"22.1.0\">"
        f"<diagram id=\"{esc(stable_id('diagram','page'))}\" name=\"Page-1\">"
        "<mxGraphModel dx=\"1200\" dy=\"800\" grid=\"1\" gridSize=\"10\" guides=\"1\" tooltips=\"1\" connect=\"1\" arrows=\"1\" fold=\"1\" page=\"0\" pageScale=\"1\" pageWidth=\"1600\" pageHeight=\"900\" math=\"0\" shadow=\"0\">"
        "<root>"
        f"{graph_model}"
        "</root>"
        "</mxGraphModel>"
        "</diagram>"
        "</mxfile>"
    )

    return xml, issues


async def render_endpoint(request: Request) -> JSONResponse:
    """POST /render

    Body: {"yaml": "..."}
    Returns: {"xml": "...", "issues": [{level,message,path?}, ...]}
    """
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse({"xml": "", "issues": _issues_to_dicts([_issue("error", "Body must be JSON")])} , status_code=400)

    yaml_text = (payload or {}).get("yaml")
    if not isinstance(yaml_text, str):
        return JSONResponse({"xml": "", "issues": [_issue("error", "Missing field: yaml")]}, status_code=400)

    model, parse_issues = parse_yaml(yaml_text)
    if not model:
        return JSONResponse({"xml": "", "issues": _issues_to_dicts(parse_issues)})

    xml, issues = render(model)
    return JSONResponse({"xml": xml, "issues": _issues_to_dicts([*parse_issues, *issues])})


async def health(_: Request) -> PlainTextResponse:
    return PlainTextResponse("ok")


app.routes.extend(
    [
        Route("/render", render_endpoint, methods=["POST"]),
        Route("/health", health, methods=["GET"]),
    ]
)
