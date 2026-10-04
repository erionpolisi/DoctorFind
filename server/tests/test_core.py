"""Validation suite — maps 1:1 to specification.md §4."""
import math
import sys
from itertools import combinations
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import hashing
import routing
from fastapi.testclient import TestClient

import app as server_app


@pytest.fixture()
def client():
    c = TestClient(server_app.app)
    c.post("/api/reset")
    return c


SY = {s["code"]: s for s in hashing.load_symptoms()}
TABLE = hashing.build_table()
CONFIG = routing.load_config()


def test_hash_deterministic():
    assert hashing.hash_symptoms(["S10", "S01"]) == hashing.hash_symptoms(["S01", "S10"])
    assert len(hashing.hash_symptoms(["S01"])) == hashing.HASH_LEN


def test_hash_no_collisions():
    n = len(SY)
    expected = sum(math.comb(n, k) for k in range(1, hashing.MAX_SELECTED + 1))
    assert len(TABLE) == expected  # build_table raises on collision


def test_sms_length_and_gsm7():
    longest = max(CONFIG["facilities"], key=lambda f: len(f["name"]))
    for action in routing.ACTIONS:
        reply = routing.build_reply(99999, action, longest)
        assert len(reply) <= 160, f"{action}: {len(reply)} chars"
        assert all(ord(ch) < 128 for ch in reply), f"non-GSM7-safe char in {action}"


def test_no_pii_in_payload():
    p = hashing.build_payload(["S10", "S18"], "OR-12", "3")
    assert hashing.parse_payload(p) is not None
    keys = {part.split(":")[0] for part in p.split(";")}
    assert keys == {"H", "V", "L", "T"}
    for s in SY.values():  # no symptom text leaks
        assert s["en"].lower() not in p.lower() and s["om"].lower() not in p.lower()


def test_danger_sign_overrides():
    # convulsion + mild cough => tier 1 no matter what the device claimed
    assert server_app.compute_tier(("S01", "S19")) == "1"
    assert server_app.compute_tier(("S18", "S20")) == "3"
    assert server_app.compute_tier(("S18", "S20", "S23")) == "2"  # 3 mild symptoms bump

    body = hashing.build_payload(["S01", "S19"], "OR-12", "3")  # device lies: T:3
    c = TestClient(server_app.app)
    c.post("/api/reset")
    r = c.post("/gateway/sms", json={"sender": "+251900000011", "body": body}).json()
    assert r["tier"] == "1"
    assert "A:GO_HOSPITAL" in r["reply_sms"] or "A:GO_CLINIC" in r["reply_sms"]


def test_ambiguous_failsafe(client):
    # unknown-but-wellformed hash => ASK_PERSON + review queue, never a guessed route
    r = client.post("/gateway/sms",
                    json={"sender": "+251900000012",
                          "body": "H:000000000000;V:1;L:OR-12;T:1"}).json()
    assert "A:ASK_PERSON" in r["reply_sms"]
    assert r["resolved"] is False
    state = client.get("/api/state").json()
    assert state["cases"][0]["needs_review"] is True

    # device-flagged ambiguous (T:A) with a VALID hash also goes to a person
    body = hashing.build_payload(["S13"], "OR-12", "A")
    r2 = client.post("/gateway/sms", json={"sender": "+251900000013", "body": body}).json()
    assert "A:ASK_PERSON" in r2["reply_sms"]

    # malformed garbage => fail-safe too
    r3 = client.post("/gateway/sms", json={"sender": "x", "body": "hello world"}).json()
    assert "A:ASK_PERSON" in r3["reply_sms"]


def test_routing_capacity():
    sy = SY
    facs = [dict(f) for f in CONFIG["facilities"]]
    # tier 1 from OR-12: Wonji HC (nearest, full 6/6) must lose to Adama Hospital (4 free)
    res = routing.route("1", "OR-12", ("S01", "S10"), facs, CONFIG, sy)
    assert res["facility"]["id"] == "F01"
    assert res["action"] == "GO_HOSPITAL"
    assert res["review_needed"] is True  # urgent always lands in human queue

    # fill ALL beds => urgent still goes to the hospital with the most capacity
    # (waiting list), never to a health center, never silence
    for f in facs:
        f["beds_occupied"] = f["total_beds"]
    res2 = routing.route("1", "OR-12", ("S01",), facs, CONFIG, sy)
    assert res2["action"] == "GO_HOSPITAL"
    assert res2["facility"]["type"] == "hospital"
    assert res2["facility"]["id"] == "F01"  # largest hospital (20 beds)
    assert res2.get("overloaded") is True
    assert res2["review_needed"] is True

    # tier 2 with everything full still falls back to CALLBACK
    res3 = routing.route("2", "OR-12", ("S13",), facs, CONFIG, sy)
    assert res3["action"] == "CALLBACK"


def test_overload_load_balancing():
    """MAX - patients over max: an overloaded big hospital loses to an
    exactly-full smaller one (user-specified formula)."""
    facs = [dict(f) for f in CONFIG["facilities"]]
    for f in facs:
        f["beds_occupied"] = f["total_beds"]
    adama = next(f for f in facs if f["id"] == "F01")
    adama["beds_occupied"] = adama["total_beds"] + 5   # score 20-5=15 < Bishoftu 16-0=16
    res = routing.route("1", "OR-12", ("S01",), facs, CONFIG, SY)
    assert res["facility"]["id"] == "F02"
    assert res["action"] == "GO_HOSPITAL"
    assert res.get("overloaded") is True


def test_nonurgent_routes_to_pharmacy(client):
    body = hashing.build_payload(["S18", "S20"], "OR-12", "3")  # headache + cold
    r = client.post("/gateway/sms", json={"sender": "+251900000014", "body": body}).json()
    assert r["tier"] == "3"
    assert "A:GO_PHARMACY" in r["reply_sms"]


def test_accept_and_release_flow(client):
    fac = next(f for f in server_app.FACILITIES if f["id"] == "F01")
    before = fac["beds_occupied"]

    body = hashing.build_payload(["S01"], "OR-12", "1")
    r = client.post("/gateway/sms", json={"sender": "+251900000015", "body": body}).json()
    assert fac["beds_occupied"] == before  # routing alone never occupies a bed

    case_id = r["case_id"]
    assert client.post(f"/api/cases/{case_id}/accept").json()["ok"] is True
    assert fac["beds_occupied"] == before + 1
    # double-accept is rejected
    assert client.post(f"/api/cases/{case_id}/accept").status_code == 409

    assert client.post("/api/facilities/F01/release").json()["ok"] is True
    assert fac["beds_occupied"] == before
