"""Deterministic routing engine: capacity + distance + specialty.

No ML here on purpose — every reply comes from a FIXED list of actions so the
system can be checked for safety (hackathon rule: "fixed list of answers").
The engine signposts; it never diagnoses.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent

W_CAPACITY, W_DISTANCE, W_SPECIALTY = 0.5, 0.3, 0.2
HOSPITAL_BONUS_T1 = 0.1  # tier-1 cases prefer hospitals over clinics at equal score

ACTIONS = ("GO_HOSPITAL", "GO_CLINIC", "GO_PHARMACY", "ASK_PERSON", "CALLBACK")

# Fixed Afaan Oromoo + English micro-texts per action (GSM-7-safe Latin script).
ACTION_MSG = {
    "GO_HOSPITAL": "HATATTAMA! Amma dhaqi (URGENT go now)",
    "GO_CLINIC": "Har'a dhaqi (go today)",
    "GO_PHARMACY": "Yoo hammaate buufata fayyaa dhaqi (if worse see health worker)",
    "ASK_PERSON": "Hin mirkanoofne - nama gaafadhu (not sure - ask a person)",
    "CALLBACK": "Ogeessi fayyaa si bilbila (health worker will call you)",
}


def load_config() -> dict:
    return json.loads((ROOT / "facilities.json").read_text(encoding="utf-8"))


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def specialty_need(symptom_codes: tuple[str, ...], symptoms_by_code: dict) -> set[str]:
    need = {symptoms_by_code[c]["specialty"] for c in symptom_codes}
    need.discard("general")
    return need


def score_facility(fac: dict, dist_km: float, need: set[str], max_km: float, tier: str) -> float:
    capacity = (fac["available_beds"] / fac["total_beds"]) if fac["total_beds"] else 1.0
    distance = max(0.0, 1.0 - dist_km / max_km)
    covered = len(need & set(fac["specialties"]))
    specialty = (covered / len(need)) if need else 1.0
    score = W_CAPACITY * capacity + W_DISTANCE * distance + W_SPECIALTY * specialty
    if tier == "1" and fac["type"] == "hospital":
        score += HOSPITAL_BONUS_T1
    return score


def route(tier: str, loc_id: str, symptom_codes: tuple[str, ...],
          facilities: list[dict], config: dict, symptoms_by_code: dict) -> dict:
    """Returns {action, facility (or None), score, distance_km, review_needed}."""
    cells = config["location_cells"]
    max_km = config["max_km"]
    cell = cells.get(loc_id)
    if cell is None:
        return {"action": "ASK_PERSON", "facility": _nearest_staffed(facilities, cells["OR-12"], max_km),
                "review_needed": True, "distance_km": None, "score": 0.0}

    need = specialty_need(symptom_codes, symptoms_by_code) if symptom_codes else set()

    if tier == "A":
        return {"action": "ASK_PERSON", "facility": _nearest_staffed(facilities, cell, max_km),
                "review_needed": True, "distance_km": None, "score": 0.0}

    if tier == "1":
        candidates = [f for f in facilities if f["type"] in ("hospital", "clinic") and f["available_beds"] > 0]
        action = "GO_HOSPITAL"
    elif tier == "2":
        candidates = [f for f in facilities if f["type"] in ("clinic", "hospital") and f["available_beds"] > 0]
        action = "GO_CLINIC"
    else:
        candidates = [f for f in facilities if f["type"] in ("pharmacy", "clinic")]
        action = "GO_PHARMACY"

    if not candidates:  # everything full: nearest hospital + human callback, never silence
        fallback = _nearest_of_type(facilities, cell, ("hospital",)) or _nearest_staffed(facilities, cell, max_km)
        return {"action": "CALLBACK", "facility": fallback, "review_needed": True,
                "distance_km": _dist(fallback, cell), "score": 0.0}

    best, best_score, best_dist = None, -1.0, None
    for fac in candidates:
        d = _dist(fac, cell)
        if d > max_km:
            continue
        s = score_facility(fac, d, need, max_km, tier)
        if s > best_score or (s == best_score and best_dist is not None and d < best_dist):
            best, best_score, best_dist = fac, s, d

    if best is None:  # nothing in range
        fallback = _nearest_staffed(facilities, cell, 10_000)
        return {"action": "CALLBACK", "facility": fallback, "review_needed": True,
                "distance_km": _dist(fallback, cell), "score": 0.0}

    if tier == "1" and best["type"] == "clinic":
        action = "GO_CLINIC"
    return {"action": action, "facility": best, "review_needed": tier == "1",
            "distance_km": round(best_dist, 1), "score": round(best_score, 3)}


def build_reply(case_id: int, action: str, facility: dict | None) -> str:
    name = facility["name"] if facility else "-"
    phone = facility["phone"] if facility else "-"
    return f"R:{case_id};N:{name};P:{phone};A:{action};M:{ACTION_MSG[action]}"


def _dist(fac: dict, cell: dict) -> float:
    return haversine_km(cell["lat"], cell["lon"], fac["lat"], fac["lon"])


def _nearest_of_type(facilities: list[dict], cell: dict, types: tuple[str, ...]) -> dict | None:
    cands = [f for f in facilities if f["type"] in types]
    return min(cands, key=lambda f: _dist(f, cell)) if cands else None


def _nearest_staffed(facilities: list[dict], cell: dict, max_km: float) -> dict | None:
    return _nearest_of_type(facilities, cell, ("clinic", "hospital"))
