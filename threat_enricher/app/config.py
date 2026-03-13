MAX_UPLOAD_SIZE = 10 * 1024 * 1024

ALLOWED_EXTENSIONS = {".xlsx"}

STRIDE_CATEGORIES = {
    "spoofing": "Spoofing",
    "tampering": "Tampering",
    "repudiation": "Repudiation",
    "information_disclosure": "Information Disclosure",
    "denial_of_service": "Denial of Service",
    "elevation_of_privilege": "Elevation of Privilege",
    "stride": "STRIDE (overlapping)",
}

IMPACT_OPTIONS = {
    "minor": "Minor",
    "moderate": "Moderate",
    "severe": "Severe",
    "significant": "Significant",
}

EASINESS_OF_ATTACK_OPTIONS = {
    "easy": "Easy",
    "advanced": "Advanced",
    "complex": "Complex",
    "very complex": "Very Complex",
}
