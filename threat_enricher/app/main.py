import json
from io import BytesIO
from pathlib import Path
from urllib.parse import urlencode

from fastapi import FastAPI, Request, Form, UploadFile, File, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from sqlalchemy.orm import Session
from sqlalchemy import select, or_, delete

from .database import SessionLocal, engine, Base, ensure_schema
from .models import Threat
from .schemas import ThreatForm
from .config import STRIDE_CATEGORIES, ALLOWED_EXTENSIONS, MAX_UPLOAD_SIZE
from .excel import append_threats_to_workbook
from .prompt import build_copilot_prompt
from .validation import parse_import_json, validate_import_payload


Base.metadata.create_all(bind=engine)
ensure_schema()

app = FastAPI(title="mosquito: threat enricher")

BASE_DIR = Path(__file__).resolve().parent

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
DEFAULT_THREAT_LIBRARY_PATH = BASE_DIR.parent / "data" / "threat-library.json"


def seed_threats_from_json_if_empty(db: Session) -> None:
    if db.query(Threat).count() > 0 or not DEFAULT_THREAT_LIBRARY_PATH.exists():
        return

    payload = parse_import_json(DEFAULT_THREAT_LIBRARY_PATH.read_text(encoding="utf-8"))
    errors, items = validate_import_payload(payload, None)
    if errors:
        raise ValueError(f"Invalid default threat library: {errors[0]}")

    for item in items:
        db.add(Threat(**item))

    db.commit()


def get_db():
    db = SessionLocal()
    try:
        seed_threats_from_json_if_empty(db)
        yield db
    finally:
        db.close()


def normalize_technology(value: str | None):
    if not value:
        return None
    value = value.strip()
    if not value:
        return None
    return value


def normalize_category_filters(values: list[str] | None) -> list[str]:
    if not values:
        return []
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized_value = normalize_technology(value)
        if not normalized_value:
            continue
        if normalized_value in seen:
            continue
        seen.add(normalized_value)
        normalized.append(normalized_value)
    return normalized


def load_category_options(db: Session) -> list[str]:
    tech_values = db.execute(select(Threat.technology).distinct()).scalars().all()
    return sorted({t for t in tech_values if t and t.strip()})


def build_list_redirect(notice: str | None = None, error: str | None = None) -> str:
    params: dict[str, str] = {}
    if notice:
        params["notice"] = notice
    if error:
        params["error"] = error
    if not params:
        return "/"
    return f"/?{urlencode(params)}"


def build_export_groups(threats: list[Threat]) -> list[dict]:
    grouped: dict[str, dict] = {}

    for threat in threats:
        category_label = (threat.technology or "").strip() or "Generic"
        category_key = threat.technology if threat.technology and threat.technology.strip() else "__generic__"
        category_group = grouped.setdefault(
            category_key,
            {
                "key": category_key,
                "label": category_label,
                "subgroups": {},
                "ungrouped": [],
            },
        )

        subcategory = (threat.subcategory or "").strip()
        if subcategory:
            sub_group = category_group["subgroups"].setdefault(
                subcategory,
                {"key": f"{category_key}::{subcategory}", "label": subcategory, "threats": []},
            )
            sub_group["threats"].append(threat)
        else:
            category_group["ungrouped"].append(threat)

    return sorted(
        (
            {
                "key": category_group["key"],
                "label": category_group["label"],
                "subgroups": sorted(
                    category_group["subgroups"].values(),
                    key=lambda item: item["label"].lower(),
                ),
                "ungrouped": category_group["ungrouped"],
            }
            for category_group in grouped.values()
        ),
        key=lambda item: item["label"].lower(),
    )


def load_export_state(db: Session, categories: list[str] | None) -> dict:
    stmt = select(Threat).order_by(Threat.updated_at.desc())
    selected_categories = normalize_category_filters(categories)

    non_generic_categories = [category for category in selected_categories if category != "__generic__"]
    include_generic = "__generic__" in selected_categories

    if include_generic and non_generic_categories:
        stmt = stmt.where(
            or_(
                Threat.technology.in_(non_generic_categories),
                Threat.technology.is_(None),
                Threat.technology == "",
            )
        )
    elif include_generic:
        stmt = stmt.where(or_(Threat.technology.is_(None), Threat.technology == ""))
    elif non_generic_categories:
        stmt = stmt.where(Threat.technology.in_(non_generic_categories))

    threats = db.execute(stmt).scalars().all()
    tech_values = db.execute(select(Threat.technology).distinct()).scalars().all()
    categories = sorted({t for t in tech_values if t and t.strip()})

    return {
        "threats": threats,
        "export_groups": build_export_groups(threats),
        "categories": categories,
        "selected_categories": selected_categories,
        "stride_categories": STRIDE_CATEGORIES,
    }


@app.get("/", response_class=HTMLResponse)
def list_threats(
    request: Request,
    category: str | None = None,
    q: str | None = None,
    notice: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    stmt = select(Threat)

    tech = normalize_technology(category)

    if tech == "__generic__":
        stmt = stmt.where(or_(Threat.technology.is_(None), Threat.technology == ""))
    elif tech:
        stmt = stmt.where(Threat.technology == tech)

    if q and q.strip():
        keyword = q.strip()
        stmt = stmt.where(
            or_(
                Threat.question.ilike(f"%{keyword}%"),
                Threat.typical_threat.ilike(f"%{keyword}%"),
            )
        )

    stmt = stmt.order_by(Threat.updated_at.desc())

    threats = db.execute(stmt).scalars().all()

    tech_values = db.execute(select(Threat.technology).distinct()).scalars().all()
    categories = sorted({t for t in tech_values if t and t.strip()})

    return templates.TemplateResponse(
        "list.html",
        {
            "request": request,
            "threats": threats,
            "categories": categories,
            "selected_category": tech,
            "q": q or "",
            "notice": notice,
            "error": error,
            "stride_categories": STRIDE_CATEGORIES,
        },
    )


@app.get("/threats/new", response_class=HTMLResponse)
def new_threat(request: Request, db: Session = Depends(get_db)):
    return templates.TemplateResponse(
        "edit.html",
        {
            "request": request,
            "page_title": "Create Threat",
            "action": "/threats/new",
            "form": {"category": ""},
            "errors": [],
            "categories": load_category_options(db),
            "stride_categories": STRIDE_CATEGORIES,
        },
    )


@app.post("/threats/new")
def create_threat(
    request: Request,
    category: str | None = Form(None),
    subcategory: str | None = Form(None),
    threat_category: str = Form(...),
    question: str = Form(...),
    typical_threat: str = Form(...),
    impact: str = Form(...),
    easiness_of_attack: str = Form(...),
    export_new_component: bool = Form(False),
    db: Session = Depends(get_db),
):
    data = {
        "technology": category,
        "category": category,
        "subcategory": subcategory,
        "threat_category": threat_category,
        "question": question,
        "typical_threat": typical_threat,
        "impact": impact,
        "easiness_of_attack": easiness_of_attack,
        "export_new_component": export_new_component,
    }

    try:
        validated = ThreatForm(**data)
    except Exception as exc:
        return templates.TemplateResponse(
            "edit.html",
            {
                "request": request,
                "page_title": "Create Threat",
                "action": "/threats/new",
                "form": data,
                "errors": [str(exc)],
                "categories": load_category_options(db),
                "stride_categories": STRIDE_CATEGORIES,
            },
            status_code=400,
        )

    threat = Threat(**validated.model_dump())
    db.add(threat)
    db.commit()

    return RedirectResponse("/", status_code=303)


@app.get("/threats/{threat_id}/edit", response_class=HTMLResponse)
def edit_threat_form(threat_id: int, request: Request, db: Session = Depends(get_db)):
    threat = db.get(Threat, threat_id)

    if not threat:
        raise HTTPException(status_code=404, detail="Threat not found")

    return templates.TemplateResponse(
        "edit.html",
        {
            "request": request,
            "page_title": "Edit Threat",
            "action": f"/threats/{threat_id}/edit",
            "form": {
                "technology": threat.technology or "",
                "category": threat.technology or "",
                "subcategory": threat.subcategory or "",
                "threat_category": threat.threat_category,
                "question": threat.question,
                "typical_threat": threat.typical_threat,
                "impact": threat.impact,
                "easiness_of_attack": threat.easiness_of_attack,
                "export_new_component": threat.export_new_component,
            },
            "errors": [],
            "categories": load_category_options(db),
            "stride_categories": STRIDE_CATEGORIES,
        },
    )


@app.post("/threats/{threat_id}/edit")
def edit_threat(
    threat_id: int,
    request: Request,
    category: str | None = Form(None),
    subcategory: str | None = Form(None),
    threat_category: str = Form(...),
    question: str = Form(...),
    typical_threat: str = Form(...),
    impact: str = Form(...),
    easiness_of_attack: str = Form(...),
    export_new_component: bool = Form(False),
    db: Session = Depends(get_db),
):
    threat = db.get(Threat, threat_id)

    if not threat:
        raise HTTPException(status_code=404, detail="Threat not found")

    data = {
        "technology": category,
        "category": category,
        "subcategory": subcategory,
        "threat_category": threat_category,
        "question": question,
        "typical_threat": typical_threat,
        "impact": impact,
        "easiness_of_attack": easiness_of_attack,
        "export_new_component": export_new_component,
    }

    try:
        validated = ThreatForm(**data)
    except Exception as exc:
        return templates.TemplateResponse(
            "edit.html",
            {
                "request": request,
                "page_title": "Edit Threat",
                "action": f"/threats/{threat_id}/edit",
                "form": data,
                "errors": [str(exc)],
                "categories": load_category_options(db),
                "stride_categories": STRIDE_CATEGORIES,
            },
            status_code=400,
        )

    for key, value in validated.model_dump().items():
        setattr(threat, key, value)

    db.commit()

    return RedirectResponse("/", status_code=303)


@app.post("/threats/{threat_id}/delete")
def delete_threat(threat_id: int, db: Session = Depends(get_db)):
    threat = db.get(Threat, threat_id)

    if threat:
        db.delete(threat)
        db.commit()

    return RedirectResponse("/", status_code=303)


@app.post("/threats/delete")
def delete_selected_threats(
    selected_ids: list[int] = Form([]),
    category: str | None = Form(None),
    q: str | None = Form(None),
    db: Session = Depends(get_db),
):
    if selected_ids:
        db.execute(delete(Threat).where(Threat.id.in_(selected_ids)))
        db.commit()

    redirect_to = "/"
    params: dict[str, str] = {}

    normalized_category = normalize_technology(category)
    if normalized_category:
        params["category"] = normalized_category
    if q and q.strip():
        params["q"] = q.strip()

    if params:
        redirect_to = f"/?{urlencode(params)}"

    return RedirectResponse(redirect_to, status_code=303)


@app.get("/threats/export/json")
def export_threats_json(db: Session = Depends(get_db)):
    threats = db.execute(select(Threat).order_by(Threat.updated_at.desc())).scalars().all()
    payload = {
        "threats": [
            {
                "category": threat.technology,
                "subcategory": threat.subcategory,
                "threat_category": threat.threat_category,
                "question": threat.question,
                "typical_threat": threat.typical_threat,
                "impact": threat.impact,
                "easiness_of_attack": threat.easiness_of_attack,
                "export_new_component": threat.export_new_component,
            }
            for threat in threats
        ]
    }

    content = json.dumps(payload, indent=2)
    return StreamingResponse(
        BytesIO(content.encode("utf-8")),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="threat-library.json"'},
    )


@app.post("/threats/import/json")
async def import_threats_json(
    library_json: UploadFile = File(...),
    replace_existing: bool = Form(False),
    db: Session = Depends(get_db),
):
    filename = library_json.filename or ""
    if Path(filename).suffix.lower() != ".json":
        return RedirectResponse(build_list_redirect(error="Only .json files are allowed"), status_code=303)

    raw_bytes = await library_json.read()
    if len(raw_bytes) > MAX_UPLOAD_SIZE:
        return RedirectResponse(
            build_list_redirect(error="Uploaded file exceeds the configured size limit"),
            status_code=303,
        )

    try:
        payload = parse_import_json(raw_bytes.decode("utf-8"))
    except Exception:
        return RedirectResponse(build_list_redirect(error="Invalid JSON file"), status_code=303)

    errors, items = validate_import_payload(payload, None)
    if errors:
        return RedirectResponse(build_list_redirect(error=errors[0]), status_code=303)

    if replace_existing:
        db.execute(delete(Threat))

    for item in items:
        db.add(Threat(**item))

    db.commit()

    action = "Replaced" if replace_existing else "Imported"
    return RedirectResponse(
        build_list_redirect(notice=f"{action} {len(items)} threats from JSON"),
        status_code=303,
    )


@app.get("/export", response_class=HTMLResponse)
def export_page(
    request: Request,
    categories: list[str] | None = Query(None),
    db: Session = Depends(get_db),
):
    context = load_export_state(db, categories)
    context.update({"request": request, "error": None})
    return templates.TemplateResponse("export.html", context)


@app.post("/export")
async def export_to_excel(
    request: Request,
    categories: list[str] = Form([]),
    threat_ids: list[int] = Form([]),
    replace_component_with_new_component: bool = Form(False),
    workbook: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    filename = workbook.filename or ""
    extension = Path(filename).suffix.lower()
    selected_categories = normalize_category_filters(categories)
    context = load_export_state(db, selected_categories)

    if extension not in ALLOWED_EXTENSIONS:
        context.update({"request": request, "error": "Only .xlsx files are allowed"})
        return templates.TemplateResponse("export.html", context, status_code=400)

    file_bytes = await workbook.read()

    if len(file_bytes) > MAX_UPLOAD_SIZE:
        context.update(
            {
                "request": request,
                "error": "Uploaded file exceeds the configured size limit",
            }
        )
        return templates.TemplateResponse("export.html", context, status_code=400)

    stmt = select(Threat)

    non_generic_categories = [
        category for category in selected_categories if category != "__generic__"
    ]
    include_generic = "__generic__" in selected_categories

    if include_generic and non_generic_categories:
        stmt = stmt.where(
            or_(
                Threat.technology.in_(non_generic_categories),
                Threat.technology.is_(None),
                Threat.technology == "",
            )
        )
    elif include_generic:
        stmt = stmt.where(or_(Threat.technology.is_(None), Threat.technology == ""))
    elif non_generic_categories:
        stmt = stmt.where(Threat.technology.in_(non_generic_categories))

    if threat_ids:
        stmt = stmt.where(Threat.id.in_(threat_ids))

    stmt = stmt.order_by(Threat.updated_at.desc())

    threats = db.execute(stmt).scalars().all()

    try:
        updated_bytes = append_threats_to_workbook(
            file_bytes,
            threats,
            replace_component_with_new_component=replace_component_with_new_component,
        )
    except ValueError as exc:
        context.update({"request": request, "error": str(exc)})
        return templates.TemplateResponse("export.html", context, status_code=400)

    output_name = f"mosquito-threats-{filename}"

    return StreamingResponse(
        BytesIO(updated_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{output_name}"'
        },
    )


@app.get("/copilot", response_class=HTMLResponse)
def copilot_page(request: Request):
    return templates.TemplateResponse(
        "copilot.html",
        {
            "request": request,
            "prompt": "",
            "errors": [],
            "success": None,
            "form": {
                "category": "",
                "component": "",
                "same_category_as_component": False,
                "product_details": "",
                "import_json": "",
            },
        },
    )


@app.post("/copilot/generate", response_class=HTMLResponse)
def generate_prompt(
    request: Request,
    category: str = Form(...),
    component: str = Form(...),
    same_category_as_component: bool = Form(False),
    product_details: str | None = Form(None),
):
    errors = []

    effective_category = component.strip() if same_category_as_component else category.strip()

    if not effective_category:
        errors.append("Category is required")
    if not component.strip():
        errors.append("Component is required")

    prompt = ""
    if not errors:
        prompt = build_copilot_prompt(
            effective_category,
            component.strip(),
            product_details,
        )

    return templates.TemplateResponse(
        "copilot.html",
        {
            "request": request,
            "prompt": prompt,
            "errors": errors,
            "success": None,
            "form": {
                "category": category,
                "component": component,
                "same_category_as_component": same_category_as_component,
                "product_details": product_details or "",
                "import_json": "",
            },
        },
        status_code=400 if errors else 200,
    )


@app.post("/copilot/import", response_class=HTMLResponse)
def import_copilot_json(
    request: Request,
    category: str | None = Form(None),
    component: str | None = Form(None),
    same_category_as_component: bool = Form(False),
    product_details: str | None = Form(None),
    import_json: str = Form(...),
    db: Session = Depends(get_db),
):
    effective_category = (
        component.strip()
        if same_category_as_component and component and component.strip()
        else (category.strip() if category and category.strip() else None)
    )

    form = {
        "category": category or "",
        "component": component or "",
        "same_category_as_component": same_category_as_component,
        "product_details": product_details or "",
        "import_json": import_json,
    }

    try:
        payload = parse_import_json(import_json)
    except Exception:
        return templates.TemplateResponse(
            "copilot.html",
            {
                "request": request,
                "prompt": "",
                "errors": ["Invalid JSON"],
                "success": None,
                "form": form,
            },
            status_code=400,
        )

    errors, items = validate_import_payload(payload, effective_category)

    if errors:
        return templates.TemplateResponse(
            "copilot.html",
            {
                "request": request,
                "prompt": "",
                "errors": errors,
                "success": None,
                "form": form,
            },
            status_code=400,
        )

    for item in items:
        db.add(Threat(**item))

    db.commit()

    return templates.TemplateResponse(
        "copilot.html",
        {
            "request": request,
            "prompt": "",
            "errors": [],
            "success": f"Imported {len(items)} threats successfully.",
            "form": {
                "category": category or "",
                "component": component or "",
                "same_category_as_component": same_category_as_component,
                "product_details": product_details or "",
                "import_json": "",
            },
        },
    )
