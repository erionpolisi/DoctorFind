# 🏥 DoctorFind

**SMS-only health routing for rural patients, in Afaan Oromoo — Small AI for Development Hackathon 2026 (Health, Annex A).**

> Because of DoctorFind, a rural patient in Oromia will reach the *right* care facility (hospital with capacity for urgent cases, pharmacy for mild ones) within minutes of describing symptoms in Afaan Oromoo — over SMS only, with no internet — which they would otherwise do late, at the wrong overcrowded clinic, or not at all; we know because World Bank Service Delivery Indicators document clinician scarcity and healthsites.io documents facility distribution.

```
┌─ Patient Android (offline) ─────────────┐     SMS (real or simulated)     ┌─ Hospital gateway ──────────────┐
│ Pictograms / Afaan Oromoo free text     │  H:{hash};V:1;L:{loc};T:{tier}  │ FastAPI + SQLite                │
│ → danger-sign rules (deterministic)     │ ──────────────────────────────► │ hash table (12,950 combos)      │
│ → Small AI classifier (60 KB JSON)      │                                 │ routing: capacity+dist+specialty│
│ → confidence gate → fail-safe           │  R:{id};N;P;A:{action};M:{om}   │ fixed reply templates (5)       │
│ → SHA-256(…)[:12] → SMS ≤160 chars      │ ◄────────────────────────────── │ dashboard + human review queue  │
└─────────────────────────────────────────┘                                 └─────────────────────────────────┘
```

## What the AI is — and why SMS alone can't do this

The Small AI is **on-device symptom understanding in Afaan Oromoo** (~37M speakers, low-resource): an IDF-weighted nearest-phrase classifier with character-trigram features (absorbs Oromo case morphology: *mataa / mataan / garaachi*), conjunction segmentation ("fi" = and), shipped as a **60 KB JSON file** scored in pure JS — no network, no native ML runtime, runs on low-end Android. Plain SMS, a spreadsheet, or a search cannot map "*mataan na dhukkuba fi qaamni na gubaa*" to structured symptom codes on an offline phone. Everything downstream is deliberately **deterministic** (fixed list of 5 reply actions) so it can be checked for safety.

**Hard limits respected:** no diagnosis anywhere (triage + signposting only), no free-form generated text in the patient path, no PII ever transmitted (salted truncated hash + village-level cell ID only), human-in-the-loop for every urgent or ambiguous case.

## Quick start

```powershell
# 1. Hospital gateway + dashboards  →  http://localhost:8000  (pick your facility)
pip install -r server/requirements.txt
python -m uvicorn app:app --host 0.0.0.0 --port 8000   # run from server/

# 2. Patient app — three ways to run it:
cd app
npm install
npx expo start                      # (a) Expo Go on a phone, same Wi-Fi
npx expo export --platform web --output-dir ..\server\patient-web
cd ..; python tools\make_pwa.py
#                                     (b) web simulator / offline PWA → http://localhost:8000/patient/
cd app; npx eas build -p android --profile preview
#                                     (c) real APK: offline + real SMS (needs free Expo account)
```

**Deploy to Vercel (one project serves everything):** `vercel deploy` from the repo root. The FastAPI
function serves the dashboard at `/`, the gateway webhook at `/gateway/sms`, and the patient web
simulator at `/patient/` (build it first with the export command above — it is committed into
`server/patient-web`). Note: on Vercel, demo state (cases, bed counts) lives in the warm function
instance — fine for a live demo, resets on cold start; the local/APK path is the offline-proof one.

Retrain the classifier: edit [ml/corpus.json](ml/corpus.json) → `python ml/train.py`
Run validation: `python -m pytest server/tests -q` (9 tests) and `python e2e_check.py` (live round-trip).

## Demo script (for the 2–5 min video)

| Scene | What to show | What it proves |
|---|---|---|
| 1. Offline proof | Phone: Wi-Fi + mobile data **off**. Open app, consent screen (Oromo, voice) | Core feature offline, consent, device user already has |
| 2. Urgent case | Type "*ho'a guddaa fi gaggabdoo*" (or tap 🌡️+⚡) → AI recognizes both, danger-sign rule fires red HATATTAMA tier → confirm screen reads the payload aloud → show the ≤160-char PII-free payload | Small AI in a local language + deterministic safety override + privacy |
| 3. The round trip | Send via demo channel (or real SMS on the APK). Dashboard (Adama view): case appears with hash-resolved symptoms, routed **past the full 4-km clinic (6/6 beds)**; staff press **Accept patient** (occupancy 16→17/20) and later **Patient released**. Phone shows big action card + 📞 tap-to-call | End-to-end within constraints; capacity-aware routing; staff stay in control of beds |
| 4. Mild case | Headache + cold pictograms → tier 3 → routed to village pharmacy | Hospital load reduction (the brief's core pain) |
| 5. Fail-safe (pass/fail criterion) | Type gibberish ("*kaleessa gabaa deeme*") → app itself says "**Hin mirkanoofne — nama gaafadhu**" → send anyway → lands in dashboard **human review queue** → nurse picks facility, sends corrected reply | "Not sure — ask a person" + human makes the final call |
| 6. Close | Dashboard: show symptom set / language pack / facility table are 3 swappable JSON files | Scalability & replicability |

## Data grounding (cited, with gaps)

| Data | Source / license | Role |
|---|---|---|
| Facility locations & types | [healthsites.io](https://healthsites.io) (OSM, CC-BY-SA); Maina et al. 2019, *Scientific Data* (98k sub-Saharan facilities) | Seed for the 8 **demo** facilities (representative Oromia facility types; coordinates illustrative, flagged as demo data) |
| Problem evidence | World Bank Service Delivery Indicators (provider absence, stock-outs); Malaria Atlas travel-time surfaces; Mwana/mTrac SMS precedents (10M+ users) | Shows the access gap is real and SMS routing scales |
| Training phrases | ~250 **synthetic, team-curated Afaan Oromoo phrases** ([ml/corpus.json](ml/corpus.json)) — labeled synthetic as the brief requires | The classifier's entire training corpus |

**What our data does NOT cover (scored honestly):** real field speech; dialect variation (Borana vs. Wellega Oromo); Oromo/Amharic code-switching; caregiver phrasing for child patients. Classifier eval on held-out unseen wordings: **80.6% exact-set accuracy, 75–83% of unrelated input correctly triggers the fail-safe** (`ml/eval_report.txt`) — and every low-confidence case goes to a human, never to a guess. Voice input uses the platform recognizer (Web Speech API / Android SpeechRecognizer): Afaan Oromoo ASR coverage is engine-dependent, so the mic falls back to English with an on-screen notice, and typing + pictograms remain the universal path. Android rarely ships an `om` TTS voice — audio prompts fall back to English while pictograms + color remain the primary non-reader channel.

## Responsible AI / safety design

- **No diagnosis** — the system never names a disease (Annex A hard limit). It routes.
- **Fixed list of answers** — 5 reply templates; no generative text toward patients; no hallucination surface.
- **Deterministic beats ML** — WHO-IMCI-style danger signs (convulsion, unconsciousness, severe bleeding, breathing difficulty, chest pain…) force tier 1 *regardless* of classifier output; the server recomputes the tier it was sent (defense in depth, tested).
- **Fail-safe** — below-threshold confidence, unknown hash, or malformed SMS → "Hin mirkanoofne — nama gaafadhu" + human review queue.
- **Privacy** — SMS carries a salted truncated SHA-256 of symptom codes + coarse village cell, never name/phone/GPS; server cases auto-purge after 24 h; consent screen at first use. Where the data sits: on the phone (nothing stored) and on the clinic's own gateway (TTL'd). A lost or shared phone exposes no health history.
- **Human-in-the-loop** — every urgent and every ambiguous case lands in the nurse review queue with override tools.

## Repo layout

| Path | What |
|---|---|
| `specification.md` | Full spec: goal, constraints, tasks, validation, context, user scenarios |
| `shared/symptoms.json` | Canonical 24-symptom set (Oromo + English + pictogram + severity + specialty) |
| `ml/corpus.json` | Training data: Oromo phrases per symptom code + fail-safe eval phrases — append here |
| `ml/train.py` | Training + eval → `app/assets/model.json` (60 KB) |
| `server/` | FastAPI gateway, hash table, routing engine, nurse dashboard, pytest suite |
| `app/` | Expo (React Native, TS) patient app — offline classifier, SMS, TTS |
| `e2e_check.py` | Live round-trip rehearsal check (run before the demo) |

*Stack: Expo SDK 57 / React Native / TypeScript · FastAPI / SQLite / Python 3.14 · pure-stdlib ML training. Gateway endpoint is shaped like a Twilio / Africa's Talking SMS webhook, so the demo channel and a production SMS hook share one code path.*