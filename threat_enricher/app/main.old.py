from io import BytesIO
from pathlib import Path

from fastapi import FastAPI, Request, Form, UploadFile, File, Depends, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from sqlalchemy.orm import Session
from sqlalchemy import select, or_

from .database import SessionLocal, engine, Base
from .models import Threat
from .schemas import ThreatForm
from .config import STRIDE_CATEGORIES, ALLOWED_EXTENSIONS, MAX_UPLOAD_SIZE
from .excel import append_threats_to_workbook
from .prompt import build_copilot_prompt
from .validation import parse_import_json, validate_import_payload


Base.metadata.create_all(bind=engine)

app = FastAPI(title="mosquito: threat enricher")

BASE_DIR = Path(__file__).resolve().parent

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


def get_db():
    db = SessionLocal()
    try:
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


@app.get("/", response_class=HTMLResponse)
def list_threats(
    request: Request,
    technology: str | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
):

    stmt = select(Threat)

    tech = normalize_technology(technology)

    if tech == "__generic__":
        stmt = stmt.where(or_(Threat.technology.is_(None), Threat.technology == ""))
    elif tech:
        stmt = stmt.where(Threat.technology == tech)

    if q:
        stmt = stmt.where(
            or_(
                Threat.question.ilike(f"%{q}%"),
                Threat.typical_threat.ilike(f"%{q}%"),
            )
        )

    stmt = stmt.order_by(Threat.updated_at.desc())

    threats = db.execute(stmt).scalars().all()

    tech_values = db.execute(select(Threat.technology).distinct()).scalars().all()

    technologies = sorted({t for t in tech_values if t})

    return templates.TemplateResponse(
        "list.html",
        {
            "request": request,
            "threats": threats,
            "technologies": technologies,
            "selected_technology": tech,
            "q": q or "",
            "stride_categories": STRIDE_CATEGORIES,
        },
    )


@app.get("/threats/new", response_class=HTMLResponse)
def new_threat(request: Request):

    return templates.TemplateResponse(
        "edit.html",
        {
            "request": request,
            "page_title": "Create Threat",
            "action": "/threats/new",
            "form": {},
            "errors": [],
            "stride_categories": STRIDE_CATEGORIES,
        },
    )


@app.post("/threats/new")
def create_threat(
    request: Request,
    technology: str | None = Form(None),
    threat_category: str = Form(...),
    question: str = Form(...),
    typical_threat: str = Form(...),
    impact: str = Form(...),
    easiness_of_attack: str = Form(...),
    db: Session = Depends(get_db),
):

    data = {
        "technology": technology,
        "threat_category": threat_category,
        "question": question,
        "typical_threat": typical_threat,
        "impact": impact,
        "easiness_of_attack": easiness_of_attack,
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
                "stride_categories": STRIDE_CATEGORIES,
            },
        )

    threat = Threat(**validated.model_dump())

    db.add(threat)

    db.commit()

    return RedirectResponse("/", status_code=303)


@app.get("/threats/{threat_id}/edit", response_class=HTMLResponse)
def edit_threat_form(threat_id: int, request: Request, db: Session = Depends(get_db)):

    threat = db.get(Threat, threat_id)

    if not threat:
        raise HTTPException(status_code=404)

    return templates.TemplateResponse(
        "edit.html",
        {
            "request": request,
            "page_title": "Edit Threat",
            "action": f"/threats/{threat_id}/edit",
            "form": threat.__dict__,
            "errors": [],
            "stride_categories": STRIDE_CATEGORIES,
        },
    )


@app.post("/threats/{threat_id}/edit")
def edit_threat(
    threat_id: int,
    technology: str | None = Form(None),
    threat_category: str = Form(...),
    question: str = Form(...),
    typical_threat: str = Form(...),
    impact: str = Form(...),
    easiness_of_attack: str = Form(...),
    db: Session = Depends(get_db),
):

    threat = db.get(Threat, threat_id)

    if not threat:
        raise HTTPException(status_code=404)

    data = {
        "technology": technology,
        "threat_category": threat_category,
        "question": question,
        "typical_threat": typical_threat,
        "impact": impact,
        "easiness_of_attack": easiness_of_attack,
    }

    validated = ThreatForm(**data)

    for k, v in validated.model_dump().items():
        setattr(threat, k, v)

    db.commit()

    return RedirectResponse("/", status_code=303)


@app.post("/threats/{threat_id}/delete")
def delete_threat(threat_id: int, db: Session = Depends(get_db)):

    threat = db.get(Threat, threat_id)

    if threat:
        db.delete(threat)
        db.commit()

    return RedirectResponse("/", status_code=303)


@app.get("/copilot", response_class=HTMLResponse)
def copilot_page(request: Request):

    return templates.TemplateResponse(
        "copilot.html",
        {
            "request": request,
            "prompt": "",
            "errors": [],
            "success": None,
            "form": {},
        },
    )


@app.post("/copilot/generate", response_class=HTMLResponse)
def generate_prompt(
    request: Request,
    technology: str = Form(...),
    component: str | None = Form(None),
    product_details: str | None = Form(None),
    new_component: bool = Form(False),
):

    prompt = build_copilot_prompt(
        technology,
        component,
        product_details,
        new_component,
    )

    return templates.TemplateResponse(
        "copilot.html",
        {
            "request": request,
            "prompt": prompt,
            "errors": [],
            "success": None,
            "form": {
                "technology": technology,
                "component": component,
                "product_details": product_details,
                "new_component": new_component,
            },
        },
    )
