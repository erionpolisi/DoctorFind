"""Hash payload spec + precomputed lookup table.

Only a salted, truncated SHA-256 of the sorted symptom codes travels over SMS —
no symptom text, no PII. The server resolves hashes via a precomputed table of
every valid combination (24 symptoms, 1..4 selected = 12,950 entries).
An unknown hash is NOT guessed: it goes to the human review queue (fail-safe).
"""
from __future__ import annotations

import hashlib
import json
import re
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP_VERSION = "APPv1"
SALT = "DF2026"
HASH_LEN = 12
MAX_SELECTED = 4

PAYLOAD_RE = re.compile(
    r"^H:(?P<hash>[0-9a-f]{12});V:(?P<ver>\d+);L:(?P<loc>[A-Z]{2}-\d{2});T:(?P<tier>[123A])$"
)


def load_symptoms() -> list[dict]:
    data = json.loads((ROOT / "shared" / "symptoms.json").read_text(encoding="utf-8"))
    return data["symptoms"]


def hash_symptoms(codes: list[str] | tuple[str, ...]) -> str:
    canonical = "|".join(sorted(codes))
    payload = f"{APP_VERSION}|{canonical}|salt={SALT}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:HASH_LEN]


def build_table() -> dict[str, tuple[str, ...]]:
    codes = sorted(s["code"] for s in load_symptoms())
    table: dict[str, tuple[str, ...]] = {}
    for k in range(1, MAX_SELECTED + 1):
        for combo in combinations(codes, k):
            h = hash_symptoms(combo)
            if h in table and table[h] != combo:  # collision => abort loudly
                raise RuntimeError(f"hash collision: {combo} vs {table[h]}")
            table[h] = combo
    return table


def parse_payload(sms_body: str) -> dict | None:
    m = PAYLOAD_RE.match(sms_body.strip())
    if not m:
        return None
    return {"hash": m["hash"], "version": int(m["ver"]), "loc": m["loc"], "tier": m["tier"]}


def build_payload(codes: list[str], loc: str, tier: str) -> str:
    return f"H:{hash_symptoms(codes)};V:1;L:{loc};T:{tier}"
