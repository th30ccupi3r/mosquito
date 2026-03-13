import json

from .config import STRIDE_CATEGORIES, IMPACT_OPTIONS, EASINESS_OF_ATTACK_OPTIONS

REQUIRED_IMPORT_FIELDS = [
    "threat_category",
    "question",
    "typical_threat",
    "impact",
    "easiness_of_attack",
]


def parse_import_json(raw_text: str):
    return json.loads(raw_text)


def validate_import_payload(payload: dict, selected_category: str | None):
    errors: list[str] = []
    valid_items: list[dict] = []

    if not isinstance(payload, dict):
        return ["Payload must be a JSON object"], []

    threats = payload.get("threats")
    if not isinstance(threats, list):
        return ["JSON must contain a 'threats' array"], []

    for idx, item in enumerate(threats, start=1):
        item_errors: list[str] = []

        if not isinstance(item, dict):
            errors.append(f"Item {idx}: must be an object")
            continue

        for field in REQUIRED_IMPORT_FIELDS:
            value = item.get(field)
            if not isinstance(value, str) or not value.strip():
                item_errors.append(f"missing or empty '{field}'")

        category = item.get("threat_category")
        if category not in STRIDE_CATEGORIES:
            item_errors.append("invalid 'threat_category'")

        impact = item.get("impact")
        if isinstance(impact, str) and impact.strip().lower() not in IMPACT_OPTIONS:
            item_errors.append("invalid 'impact'")

        easiness_of_attack = item.get("easiness_of_attack")
        if (
            isinstance(easiness_of_attack, str)
            and easiness_of_attack.strip().lower() not in EASINESS_OF_ATTACK_OPTIONS
        ):
            item_errors.append("invalid 'easiness_of_attack'")

        if item_errors:
            errors.append(f"Item {idx}: " + "; ".join(item_errors))
            continue

        category = item.get("category")
        if category is None:
            category = item.get("technology")
        if category is None:
            category = selected_category
        if isinstance(category, str):
            category = category.strip() or None
        else:
            category = None

        valid_items.append(
            {
                "technology": category,
                "subcategory": (
                    item["subcategory"].strip()
                    if isinstance(item.get("subcategory"), str) and item["subcategory"].strip()
                    else None
                ),
                "threat_category": item["threat_category"].strip(),
                "question": item["question"].strip(),
                "typical_threat": item["typical_threat"].strip(),
                "impact": item["impact"].strip().lower(),
                "easiness_of_attack": item["easiness_of_attack"].strip().lower(),
                "export_new_component": bool(item.get("export_new_component", False)),
            }
        )

    return errors, valid_items
