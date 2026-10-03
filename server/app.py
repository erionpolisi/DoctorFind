"""DoctorFind hospital gateway + nurse dashboard.

POST /gateway/sms is shaped like a commercial SMS-gateway webhook (Twilio /
Africa's Talking), so the demo simulator channel and a real SMS hook share the
same code path. Replies come from a fixed template set — never generated text.
"""
from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

import hashing
import routing

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "cases.db"
CASE_TTL_SECONDS = 24 * 3600  # privacy: cases are purged after 24 h

app = FastAPI(title="DoctorFind Gateway")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

HASH_TABLE = hashing.build_table()
SYMPTOMS = {s["code"]: s for s in hashing.load_symptoms()}
CONFIG = routing.load_config()
FACILITIES = [dict(f) for f in CONFIG["facilities"]]


def compute_tier(codes: tuple[str, ...]) -> str:
    sevs = [SYMPTOMS[c]["severity"] for c in codes]
    if 1 in sevs:
        return "1"
    if 2 in sevs or len([s for s in sevs if s == 3]) >= 3:
        return "2"
    return "3"


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS cases(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts REAL, sender TEXT, loc TEXT, tier TEXT, codes TEXT,
            action TEXT, facility_id TEXT, reply TEXT,
            needs_review INTEGER DEFAULT 0, handled INTEGER DEFAULT 0)""")


def purge_expired() -> None:
    with db() as conn:
        conn.execute("DELETE FROM cases WHERE ts < ?", (time.time() - CASE_TTL_SECONDS,))


init_db()
purge_expired()


class InboundSms(BaseModel):
    sender: str
    body: str


class Resolve(BaseModel):
    facility_id: str
    action: str


@app.post("/gateway/sms")
def gateway_sms(msg: InboundSms) -> dict:
    purge_expired()
    payload = hashing.parse_payload(msg.body)

    if payload is None:  # malformed => fail-safe, never guess
        result = routing.route("A", "OR-12", (), FACILITIES, CONFIG, SYMPTOMS)
        case_id = _store(msg.sender, "?", "A", (), result)
        reply = routing.build_reply(case_id, result["action"], result["facility"])
        _save_reply(case_id, reply)
        return {"reply_sms": reply, "case_id": case_id, "resolved": False}

    codes = HASH_TABLE.get(payload["hash"])
    if codes is None:  # unknown hash => fail-safe + human review
        result = routing.route("A", payload["loc"], (), FACILITIES, CONFIG, SYMPTOMS)
        case_id = _store(msg.sender, payload["loc"], "A", (), result)
        reply = routing.build_reply(case_id, result["action"], result["facility"])
        _save_reply(case_id, reply)
        return {"reply_sms": reply, "case_id": case_id, "resolved": False}

    # device said ambiguous => human review even though the hash resolved
    tier = "A" if payload["tier"] == "A" else compute_tier(codes)  # server-side recompute: safety
    result = routing.route(tier, payload["loc"], codes, FACILITIES, CONFIG, SYMPTOMS)

    if tier == "1" and result["facility"] and result["facility"]["total_beds"]:
        result["facility"]["available_beds"] = max(0, result["facility"]["available_beds"] - 1)

    case_id = _store(msg.sender, payload["loc"], tier, codes, result)
    reply = routing.build_reply(case_id, result["action"], result["facility"])
    _save_reply(case_id, reply)
    return {"reply_sms": reply, "case_id": case_id, "resolved": True, "tier": tier}


@app.get("/api/state")
def state() -> dict:
    with db() as conn:
        rows = conn.execute("SELECT * FROM cases ORDER BY id DESC LIMIT 50").fetchall()
    cases = []
    for r in rows:
        codes = json.loads(r["codes"])
        cases.append({
            "id": r["id"], "ts": r["ts"], "sender": r["sender"], "loc": r["loc"],
            "tier": r["tier"], "codes": codes,
            "symptoms": [f'{SYMPTOMS[c]["emoji"]} {SYMPTOMS[c]["en"]} / {SYMPTOMS[c]["om"]}' for c in codes],
            "action": r["action"], "facility_id": r["facility_id"], "reply": r["reply"],
            "needs_review": bool(r["needs_review"]), "handled": bool(r["handled"]),
        })
    return {"cases": cases, "facilities": FACILITIES, "actions": list(routing.ACTIONS)}


@app.post("/api/facilities/{fac_id}/beds")
def adjust_beds(fac_id: str, delta: int) -> dict:
    for f in FACILITIES:
        if f["id"] == fac_id:
            f["available_beds"] = max(0, min(f["total_beds"], f["available_beds"] + delta))
            return {"ok": True, "available_beds": f["available_beds"]}
    raise HTTPException(404, "unknown facility")


@app.post("/api/cases/{case_id}/resolve")
def resolve_case(case_id: int, body: Resolve) -> dict:
    fac = next((f for f in FACILITIES if f["id"] == body.facility_id), None)
    if fac is None or body.action not in routing.ACTIONS:
        raise HTTPException(400, "bad facility or action")
    reply = routing.build_reply(case_id, body.action, fac)
    with db() as conn:
        conn.execute("UPDATE cases SET action=?, facility_id=?, reply=?, handled=1 WHERE id=?",
                     (body.action, fac["id"], reply, case_id))
    return {"ok": True, "reply_sms": reply}


@app.post("/api/cases/{case_id}/handled")
def mark_handled(case_id: int) -> dict:
    with db() as conn:
        conn.execute("UPDATE cases SET handled=1 WHERE id=?", (case_id,))
    return {"ok": True}


@app.post("/api/reset")
def reset() -> dict:
    global FACILITIES
    FACILITIES = [dict(f) for f in routing.load_config()["facilities"]]
    with db() as conn:
        conn.execute("DELETE FROM cases")
    return {"ok": True}


@app.get("/", response_class=HTMLResponse)
def dashboard() -> str:
    return (ROOT / "dashboard.html").read_text(encoding="utf-8")


def _store(sender: str, loc: str, tier: str, codes: tuple[str, ...], result: dict) -> int:
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO cases(ts,sender,loc,tier,codes,action,facility_id,needs_review) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (time.time(), sender, loc, tier, json.dumps(list(codes)), result["action"],
             result["facility"]["id"] if result["facility"] else None,
             1 if result["review_needed"] else 0))
        return cur.lastrowid


def _save_reply(case_id: int, reply: str) -> None:
    with db() as conn:
        conn.execute("UPDATE cases SET reply=? WHERE id=?", (reply, case_id))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
