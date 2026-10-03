# DoctorFind — Final Specification
**Small AI for Development Hackathon 2026 · Sector: Health (Annex A) · Team deadline: Oct 4, 2026**

---

## 1. Goal

**Problem statement (one sentence, judging format):**
> Because of DoctorFind, a rural patient in Oromia will reach the *right* care facility (hospital with capacity for urgent cases, pharmacy for mild ones) within minutes of describing symptoms in Afaan Oromoo — over SMS only, with no internet — which they would otherwise do late, at the wrong overcrowded clinic, or not at all; we know because WHO/World Bank Service Delivery Indicators document clinician scarcity and healthsites.io documents facility distribution in the region.

**What we build (two components, one weekend):**

1. **Patient app** (Expo / React Native, Android): offline-first symptom capture — pictogram buttons for illiterate users + free-text/voice in **Afaan Oromoo** — with a **tiny on-device classifier (< 50 KB JSON weights)** that maps Oromo phrases to canonical symptom codes. Builds a hashed, PII-free, ≤160-char payload and sends it **via SMS** (real SMS composer, plus a gateway-simulator channel for the stage demo).
2. **Hospital gateway + dashboard** (FastAPI + SQLite): receives the SMS payload, resolves the hash via a precomputed lookup table, computes a **capacity/distance/specialty routing score**, replies with a ≤160-char routing SMS, and shows a live **dashboard with a human-review queue** (human-in-the-loop) and facility capacity management.

**What the AI is and why simpler tools can't do it:** plain SMS/spreadsheet cannot *understand* a free-form symptom description spoken/typed in a low-resource language on an offline device. The Small AI = on-device Oromo intent/symptom classification + urgency scoring. Everything downstream (routing, replies) is deliberately deterministic — a **fixed list of answers** — so it can be checked for safety.

**Explicit non-goals (hard limits from the brief):**
- ❌ **No diagnosis.** The system never names a disease. It acknowledges symptoms, assigns urgency, and routes. (Annex A: interpreting medical imaging/diagnosis is out of bounds.)
- ❌ No free-form LLM output in the patient-facing path. No hallucination surface.
- ❌ No PII in any SMS payload.

---

## 2. Constraints

| # | Constraint (source) | Design consequence |
|---|---|---|
| C1 | Runs on a device the user already has (Rules) | Android app (Expo); works on low-end devices; dashboard is plain web for clinic desktop |
| C2 | Core feature works **offline** (Rules) | Symptom capture → classification → hash → SMS compose: zero network. Demo: wifi+data off |
| C3 | Model small enough to side-load (Rules) | Naive-Bayes bag-of-words classifier exported as JSON ≤ 50 KB, bundled in app |
| C4 | ≥1 interaction in a named local language (Rules) | **Afaan Oromoo** (~37M speakers, low-resource). UI labels, symptom names, classifier input, reply line all Oromo. Honest gap: Android TTS rarely ships an `om` voice → pictograms + large text are the primary accessible channel, TTS used when available |
| C5 | Human-in-the-loop, fail-safe "not sure — ask a person" (Rules, pass/fail) | Confidence < threshold → payload flagged `T:A` (ambiguous) → dashboard human-review queue → reply "Hin mirkanoofne — nama gaafadhu / Not sure — ask a person" + nearest staffed facility. Nurse confirms/overrides every urgent case |
| C6 | Avoid hallucinations; fixed list of answers (Rules + Glossary) | Server replies templated from a finite action set: `GO_HOSPITAL`, `GO_CLINIC`, `GO_PHARMACY`, `ASK_PERSON`, `CALLBACK` |
| C7 | SMS only, ≤160 chars GSM-7 (Notes + rural reality) | Payload `H:{hash12};V:1;L:{loc};T:{tier}` ≈ 30 chars. Reply `R:{id};N:{name};P:{phone};A:{action};M:{oromo_text}` validated ≤160 |
| C8 | Privacy: no PII over the air (Notes + WHO guidance) | Only a **salted SHA-256 hash (12 hex)** of sorted symptom codes + coarse location-cell ID travels. Server resolves via precomputed table of all valid combos (24 symptoms, ≤4 selected ≈ 12,950 entries). Logs have TTL |
| C9 | Old devices / lightweight (Notes) | No heavy runtime: classifier is pure JS math over JSON weights; no TF/ONNX on device |
| C10 | 6-hour build budget (team) | Expo Go (no native build), SQLite (no DB server), server-rendered dashboard (no React build chain) |
| C11 | Data grounding incl. gaps (judging 15%) | Facilities: healthsites.io (CC-BY-SA) + Maina et al. 2019; problem evidence: WB Service Delivery Indicators; training phrases: **synthetic + curated Oromo, labeled as such**. Gap: ~300 synthetic phrases, not field speech; dialect coverage untested |
| C12 | Video 2–5 min required for shortlist | Demo script in README; every scenario reproducible in < 90 s |

---

## 3. Tasks

| # | Task | Deliverable | Est. |
|---|---|---|---|
| T1 | Repo scaffold | `app/` (Expo TS), `server/` (FastAPI), `ml/` (training) | 20 min |
| T2 | Canonical symptom set | `shared/symptoms.json`: 24 codes with Oromo + English names, pictogram emoji, WHO-IMCI-style danger-sign flags | 20 min |
| T3 | Hash spec + precompute | SHA-256(`APPv1\|{sorted codes}\|salt`)[:12] for all combos ≤4; collision check | 30 min |
| T4 | Routing engine | `score = 0.5·capacity + 0.3·(1−dist/max) + 0.2·specialty`; urgent→hospital, moderate→clinic, mild→pharmacy, ambiguous→human | 40 min |
| T5 | Gateway API | `POST /gateway/sms` (payload→reply, store-and-forward), `GET /dashboard`, capacity edit, review-queue actions | 60 min |
| T6 | Tiny classifier | `ml/train.py`: synthetic Oromo phrases → multinomial NB → `app/assets/model.json` (<50 KB) + eval report | 45 min |
| T7 | Patient app | Screens: language/consent → pictograms + free text → confirm (voice) → send (real SMS **and** simulator channel) → reply action card | 150 min |
| T8 | Validation | pytest suite + classifier eval ≥80% held-out + e2e walkthrough | 40 min |
| T9 | Docs | README: run instructions, video demo script, data citations, risk/gap statement | 25 min |

---

## 4. Validation

**Automated (pytest, run before demo):**
1. `test_hash_deterministic` — same symptoms any order → same hash.
2. `test_hash_no_collisions` — zero collisions across all precomputed combinations.
3. `test_sms_length` — every reply template with longest facility name ≤ 160 GSM-7 chars.
4. `test_no_pii` — payload contains only `H/V/L/T` keys; no names, phone, GPS (location = coarse cell id).
5. `test_danger_sign_overrides` — any danger sign (convulsion, unconscious, severe bleeding, chest pain, breathing difficulty) → tier 1 regardless of classifier output (rules beat ML — safety).
6. `test_ambiguous_failsafe` — unknown hash or low confidence → `ASK_PERSON` + review-queue entry, never a guessed route.
7. `test_routing_capacity` — a full hospital (0 beds) never wins urgent routing while an alternative with capacity exists in range.

**Model eval:** ≥80% top-1 symptom-set accuracy on held-out 20% of the synthetic corpus; confusion pairs reported; threshold tuned so <10% of clear phrases and >90% of gibberish trigger the fail-safe.

**Manual end-to-end (stage rehearsal):**
- Phone in airplane mode: capture→classify→hash→SMS-compose fully works.
- Simulator round-trip < 3 s on LAN; dashboard shows case live; nurse override changes the reply.
- All four user scenarios below reproduce exactly.

**Pass/fail self-check (Responsible AI):** no diagnosis anywhere; fail-safe demonstrable; consent screen at first launch; citations + gap statement in README.

---

## 5. Context

- **Hackathon:** Small AI for Development (World Bank Youth Summit × Hack-Nation), Health, Annex A. Judging: works-in-constraints 25%, relevance 20%, data grounding 15%, evidence 15%, clarity/inclusivity/AI-value 15%, scalability 10%, Responsible AI pass/fail.
- **Persona:** Noor, 38, rural Oromia highlands (Ethiopia). Low-end Android in household, no Wi-Fi, 2G/SMS coverage, speaks Afaan Oromoo, limited literacy. Nearest clinic overcrowded; district hospital 12 km.
- **Evidence problem is real:** WB Service Delivery Indicators (provider absence, stock-outs); Malaria Atlas travel-time surfaces; Mwana/mTrac precedent proves SMS health routing scales (10M+ users).
- **Data we build on (cited):** healthsites.io (CC-BY-SA, OSM) + Maina et al. 2019 — facility seed (8 demo facilities modeled on real Oromia facility types, flagged as demo data); synthetic Oromo phrase corpus (~300 phrases, **labeled synthetic** as the brief requires). Not covered: real field speech, dialect variation (Borana vs Wellega), Oromo/Amharic code-switching, caregiver phrasing.
- **Why hashes:** privacy (symptoms unreadable in transit), fixed payload size, tamper-evidence (unknown hash → fail-safe). Trade-off: bounded symptom vocabulary — acceptable for triage signposting.
- **Scalability (10%):** symptom set, language pack, facility table are three config files — another region swaps them. Gateway API is shaped like a Twilio/Africa's Talking webhook, so the simulator channel is production-shaped.

---

## 6. Examples (User Scenarios)

**S1 — Urgent, child danger signs (headline demo).**
Noor's daughter has fever and a convulsion at night. Noor opens DoctorFind (no internet), taps *fever* + *convulsion* pictograms (or types "ho'a guddaa fi gaggabdoo"). Danger-sign rule fires → tier 1. App shows payload `H:a3f9c2e1b7d4;V:1;L:OR-12;T:1`, reads confirmation aloud, opens SMS composer pre-filled. Gateway resolves hash; routing picks **Adama District Hospital (14 beds free, pediatric ward, 12 km)** over the 4-km clinic (0 beds). Reply renders as a big green card: hospital name, phone, "DHAQI AMMA — go now"; nurse dashboard shows the case for callback.

**S2 — Non-urgent → pharmacy.**
Mild headache + runny nose → two pictograms → tier 3 → routed to village drug store with fixed-template self-care signpost in Oromo and "see a health worker if it worsens". No hospital burdened.

**S3 — Ambiguous → human fail-safe (pass/fail proof).**
A phrase the classifier can't read confidently → app says **"Hin mirkanoofne — nama gaafadhu" (Not sure — ask a person)**, sends tier-A payload; dashboard puts case in **human review queue**; nurse replies manually. AI never guesses.

**S4 — Illiterate user path (inclusivity).**
Non-reading user: pictogram grid with Oromo audio prompt (TTS when available), single-tap ✓/✗ confirm, reply card uses icon + color + phone-dial button — zero reading required to act.

---

## 7. Architecture (reference)

```
┌─ Patient Android (offline) ─────────────┐     SMS (real or simulated)     ┌─ Hospital gateway ──────────────┐
│ Pictograms / Oromo text                 │  H:{hash};V:1;L:{loc};T:{tier}  │ FastAPI + SQLite                │
│ → danger-sign rules (deterministic)     │ ──────────────────────────────► │ hash table (~13k combos)        │
│ → NB classifier (model.json ≤50KB)      │                                 │ routing score (cap/dist/spec)   │
│ → confidence gate → fail-safe           │  R:{id};N;P;A:{action};M:{om}   │ fixed reply templates           │
│ → SHA-256(…)[:12] → SMS                 │ ◄────────────────────────────── │ dashboard + human review queue  │
└─────────────────────────────────────────┘                                 └─────────────────────────────────┘
```

*Stack:* Expo (React Native, TypeScript), `expo-sms`, `expo-speech`; FastAPI, SQLite, Jinja2; pure-Python training script (no sklearn needed for multinomial NB).
