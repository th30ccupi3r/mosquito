from app.database import SessionLocal
from app.models import Threat

seed_items = [
    Threat(
        technology="nodejs",
        threat_category="tampering",
        question="Does the component validate input safely before processing requests?",
        typical_threat="An attacker submits crafted payloads that manipulate server-side logic through insufficient input validation.",
        impact="high",
        easiness_of_attack="medium",
    ),
    Threat(
        technology="BTP cloud",
        threat_category="information_disclosure",
        question="Does the component expose sensitive configuration or tenant data to unauthorised users?",
        typical_threat="An attacker accesses logs or APIs that reveal secrets or customer information due to weak access controls.",
        impact="high",
        easiness_of_attack="medium",
    ),
    Threat(
        technology=None,
        threat_category="spoofing",
        question="Can the component be spoofed by an attacker pretending to be a trusted caller?",
        typical_threat="An attacker impersonates an internal service and submits requests that the system trusts without sufficient verification.",
        impact="medium",
        easiness_of_attack="medium",
    ),
]

with SessionLocal() as db:
    for item in seed_items:
        db.add(item)
    db.commit()
