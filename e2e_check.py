"""End-to-end smoke test against a running gateway (demo rehearsal)."""
import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "server"))
import hashing  # noqa: E402

BASE = "http://127.0.0.1:8000"


def send(body: str) -> dict:
    req = urllib.request.Request(f"{BASE}/gateway/sms",
                                 data=json.dumps({"sender": "e2e", "body": body}).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req).read())


urllib.request.urlopen(urllib.request.Request(f"{BASE}/api/reset", method="POST"))

scenarios = [
    ("S1 urgent (fever+convulsion)", hashing.build_payload(["S01", "S10"], "OR-12", "1"), "GO_HOSPITAL"),
    ("S2 mild (headache+cold)",      hashing.build_payload(["S18", "S20"], "OR-12", "3"), "GO_PHARMACY"),
    ("S3 unknown hash",              "H:deadbeef0000;V:1;L:OR-12;T:1",                    "ASK_PERSON"),
    ("S3b device-flagged ambiguous", hashing.build_payload(["S13"], "OR-12", "A"),        "ASK_PERSON"),
]

ok = True
for name, payload, want in scenarios:
    r = send(payload)
    reply = r["reply_sms"]
    good = f"A:{want}" in reply and len(reply) <= 160
    ok &= good
    print(f"{'PASS' if good else 'FAIL'}  {name}")
    print(f"      -> {payload}")
    print(f"      <- {reply}  (len={len(reply)})")

state = json.loads(urllib.request.urlopen(f"{BASE}/api/state").read())
queue = [c for c in state["cases"] if c["needs_review"] and not c["handled"]]
print(f"\nreview queue entries: {len(queue)} (urgent + 2 ambiguous expected = 3)")
f01 = next(f for f in state["facilities"] if f["id"] == "F01")
print(f"Adama Hospital occupancy after routing (unchanged until staff accept): "
      f"{f01['beds_occupied']}/{f01['total_beds']} (expected 16/20)")


def post(path: str) -> dict:
    req = urllib.request.Request(f"{BASE}{path}", data=b"", method="POST")
    return json.loads(urllib.request.urlopen(req).read())


# --- overload scenario: all hospitals full => biggest hospital + waiting list
for f in state["facilities"]:
    if f["type"] == "hospital":
        free = f["total_beds"] - f["beds_occupied"]
        if free > 0:
            post(f"/api/facilities/{f['id']}/beds?delta={free}")
r = send(hashing.build_payload(["S03"], "OR-12", "1"))
full_ok = "A:GO_HOSPITAL" in r["reply_sms"] and "Adama" in r["reply_sms"]
acc = post(f"/api/cases/{r['case_id']}/accept")
wait_ok = acc.get("waitlisted") is True
ok &= full_ok and wait_ok
print(f"{'PASS' if full_ok else 'FAIL'}  S4 all hospitals full -> biggest hospital, never a clinic")
print(f"      <- {r['reply_sms']}")
print(f"{'PASS' if wait_ok else 'FAIL'}  S4b accept while full -> waiting list (occupancy over total)")
post("/api/reset")
sys.exit(0 if ok else 1)
