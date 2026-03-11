def build_copilot_prompt(
    category: str,
    component: str,
    product_details: str | None,
) -> str:
    details_text = product_details.strip() if product_details else ""

    return f"""You are helping with threat modelling.

Return only the most important threats for this specific component.
Do not try to hit a target count.
Do not add generic filler threats that could apply to almost any system.
Prefer fewer, high-value threats over a long generic list.

Category: {category}
Component: {component}
Product details: {details_text}

Requirements:
- Allowed categories are exactly: spoofing, tampering, repudiation, information_disclosure, denial_of_service, elevation_of_privilege, stride.
- Allowed impact values are exactly: minor, moderate, significant, severe.
- Allowed easiness_of_attack values are exactly: easy, advanced, complex, very complex.
- You may use "stride" when a threat overlaps multiple STRIDE categories.
- Threats must be specific to this component and its common failure modes, attack patterns, and implementation risks.
- Prefer domain-specific weaknesses over broad security themes.
- Example: if the component is PHP, strongly prioritize relevant issues such as type juggling, file inclusion, unsafe deserialization, weak upload handling, dynamic code execution, and stream wrapper abuse before generic items like denial of service or sensitive data exposure.
- Only include broad generic questions if they are clearly one of the highest-risk issues for this exact component and context.
- Use "subcategory" only when a threat applies to a specific product area inside the component, for example "Cloud Connector".
- Each question must be concise and phrased as a yes/no or short-answer threat-modelling question.
- The wording of questions must refer to "component".
- When creating examples or wording patterns, use "component" and not any alternative wording.
- Each threat must include: threat_category, question, typical_threat, impact, easiness_of_attack. It may also include subcategory.
- Set impact using only one of: minor, moderate, significant, severe.
- Set easiness_of_attack using only one of: easy, advanced, complex, very complex.
- If you include "category" in an item, set it to "{category}".
- typical_threat must be a concrete attacker story.
- Output STRICT JSON ONLY.
- Do not output markdown.
- Do not output commentary.

Return JSON with this exact shape:
{{
  "threats": [
    {{
      "category": "{category}",
      "technology": "optional string for backward compatibility",
      "subcategory": "optional string",
      "threat_category": "spoofing|tampering|repudiation|information_disclosure|denial_of_service|elevation_of_privilege|stride",
      "question": "string",
      "typical_threat": "string",
      "impact": "minor|moderate|significant|severe",
      "easiness_of_attack": "easy|advanced|complex|very complex"
    }}
  ]
}}"""
