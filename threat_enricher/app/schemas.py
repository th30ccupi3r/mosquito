from pydantic import BaseModel, field_validator

from .config import STRIDE_CATEGORIES, IMPACT_OPTIONS, EASINESS_OF_ATTACK_OPTIONS


class ThreatForm(BaseModel):
    technology: str | None = None
    subcategory: str | None = None
    threat_category: str
    question: str
    typical_threat: str
    impact: str
    easiness_of_attack: str
    export_new_component: bool = False

    @field_validator("threat_category")
    @classmethod
    def valid_category(cls, value: str) -> str:
        if value not in STRIDE_CATEGORIES:
            raise ValueError("Invalid threat category")
        return value

    @field_validator("impact")
    @classmethod
    def valid_impact(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in IMPACT_OPTIONS:
            raise ValueError("Impact must be one of: Minor, Moderate, Severe, Significant")
        return normalized

    @field_validator("easiness_of_attack")
    @classmethod
    def valid_easiness_of_attack(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in EASINESS_OF_ATTACK_OPTIONS:
            raise ValueError("Easiness of attack must be one of: Easy, Advanced, Complex, Very Complex")
        return normalized

    @field_validator("question", "typical_threat", "impact", "easiness_of_attack")
    @classmethod
    def not_empty(cls, value: str) -> str:
        if not value or not value.strip():
            raise ValueError("Field is required")
        return value.strip()

    @field_validator("technology", "subcategory")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None
