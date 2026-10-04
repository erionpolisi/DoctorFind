"""DoctorFind — train the tiny on-device Afaan Oromoo symptom classifier.

IDF-weighted nearest-phrase classifier (cosine k-NN over bag-of-words),
exported as a small JSON file (< 50 KB) that the React Native app scores in
pure JS. Retrieval-based by design: if the input does not resemble any known
symptom phrase, confidence is low and the app says "not sure — ask a person"
instead of guessing (hackathon fail-safe rule).

Corpus: ml/corpus.json — synthetic, team-curated Afaan Oromoo phrases (labeled
synthetic, as the hackathon brief requires). Append new phrases there; codes
must exist in shared/symptoms.json. Pair-phrases are generated with "fi" (= "and").

Usage:  python ml/train.py      (from repo root)
Writes: app/assets/model.json, app/assets/symptoms.json, ml/eval_report.txt
"""
from __future__ import annotations

import json
import math
import random
import re
import shutil
import sys
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CORPUS_PATH = ROOT / "ml" / "corpus.json"
SEED = 7
SIM_SELECT = 0.40      # phrases at/above this cosine contribute their labels
AMBIGUITY_THRESHOLD = 0.50  # weakest segment cosine below this => "not sure - ask a person"


def load_corpus() -> tuple[dict[str, list[str]], list[str]]:
    """Load and validate ml/corpus.json against shared/symptoms.json."""
    data = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))
    corpus: dict[str, list[str]] = data["corpus"]
    gibberish: list[str] = data["gibberish"]

    symptoms = json.loads((ROOT / "shared" / "symptoms.json").read_text(encoding="utf-8"))
    valid_codes = {s["code"] for s in symptoms["symptoms"]}

    errors = []
    if unknown := set(corpus) - valid_codes:
        errors.append(f"corpus has codes not in shared/symptoms.json: {sorted(unknown)}")
    if missing := valid_codes - set(corpus):
        errors.append(f"symptoms without any training phrases: {sorted(missing)}")
    for code, phrases in corpus.items():
        if len(phrases) < 4:
            errors.append(f"{code}: only {len(phrases)} phrases (need >= 4 for a usable 80/20 split)")
        if len(set(phrases)) != len(phrases):
            errors.append(f"{code}: duplicate phrases")
    if errors:
        sys.exit("corpus.json validation failed:\n  - " + "\n  - ".join(errors))
    return corpus, gibberish

TOKEN_RE = re.compile(r"[a-z']+")


def tokenize(text: str) -> list[str]:
    """Words + char trigrams per word: trigrams absorb Oromo case morphology
    (mataa/mataan/garaachi share most trigrams)."""
    words = TOKEN_RE.findall(text.lower().replace("\u2019", "'"))
    feats: list[str] = []
    for w in words:
        feats.append(w)
        padded = f"<{w}>"
        feats.extend(padded[i:i + 3] for i in range(len(padded) - 2))
    return feats


def make_pairs(singles: list[tuple[str, frozenset[str]]], n: int, rng: random.Random):
    pairs = []
    for _ in range(n):
        (p1, l1), (p2, l2) = rng.sample(singles, 2)
        if l1 == l2:
            continue
        pairs.append((f"{p1} fi {p2}", l1 | l2))
    return pairs


def train(docs: list[tuple[str, frozenset[str]]]):
    """IDF-weighted phrase index. Returns (vocab, idf, entries)."""
    vocab: dict[str, int] = {}
    tokenized = [(tokenize(t), labels) for t, labels in docs]
    for toks, _ in tokenized:
        for t in toks:
            vocab.setdefault(t, len(vocab))
    df = [0] * len(vocab)
    for toks, _ in tokenized:
        for t in set(toks):
            df[vocab[t]] += 1
    n = len(tokenized)
    idf = [round(math.log((n + 1) / (d + 1)) + 1.0, 4) for d in df]

    entries = []
    for toks, labels in tokenized:
        vec: dict[int, float] = {}
        for t in toks:
            i = vocab[t]
            vec[i] = vec.get(i, 0.0) + idf[i]
        norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
        entries.append({
            "v": {str(i): round(v / norm, 4) for i, v in vec.items()},
            "labels": sorted(labels),
        })
    return vocab, idf, entries


def predict(text: str, vocab: dict[str, int], idf: list[float], entries: list[dict],
            max_selected: int = 4):
    """Split on Oromo conjunctions, nearest-phrase match each segment, union labels.
    Confidence = weakest segment: if ANY part is not understood -> fail-safe."""
    segments = [s for s in re.split(r"\bfi\b|\bakkasumas\b|,", text.lower()) if s.strip()]
    if not segments:
        return [], 0.0

    votes: dict[str, float] = {}
    worst = 1.0
    for seg in segments:
        toks = tokenize(seg)
        vec: dict[str, float] = {}
        for t in toks:
            if t in vocab:
                i = vocab[t]
                vec[str(i)] = vec.get(str(i), 0.0) + idf[i]
        norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
        vec = {i: v / norm for i, v in vec.items()}

        best_sim, best_labels = 0.0, []
        for e in entries:
            s = sum(w * e["v"].get(i, 0.0) for i, w in vec.items())
            if s > best_sim:
                best_sim, best_labels = s, e["labels"]
        worst = min(worst, best_sim)
        if best_sim >= SIM_SELECT:
            for c in best_labels:
                votes[c] = max(votes.get(c, 0.0), best_sim)

    picked = sorted(votes, key=lambda c: -votes[c])[:max_selected]
    return picked, worst


def main() -> None:
    rng = random.Random(SEED)
    corpus, gibberish = load_corpus()
    classes = sorted(corpus.keys())

    singles = [(p, frozenset([c])) for c, phrases in corpus.items() for p in phrases]
    rng.shuffle(singles)

    # per-class 80/20 split of single phrases
    train_s, test_s = [], []
    for c in classes:
        cs = [x for x in singles if c in x[1]]
        k = max(1, round(len(cs) * 0.2))
        test_s += cs[:k]
        train_s += cs[k:]

    train_docs = train_s                       # index: single-symptom phrases only
    test_docs = test_s + make_pairs(test_s, 40, rng)  # eval incl. unseen combinations

    vocab, idf, entries = train(train_docs)

    # ---- evaluation
    preds = [(predict(t, vocab, idf, entries), l) for t, l in test_docs]
    exact = sum(1 for (p, _), l in preds if frozenset(p) == l)
    overlap = sum(1 for (p, _), l in preds if p and (frozenset(p) <= l or l <= frozenset(p)))
    failsafe_clear = sum(1 for (_, conf), _ in preds if conf < AMBIGUITY_THRESHOLD)
    failsafe_gib = sum(1 for g in gibberish
                       if predict(g, vocab, idf, entries)[1] < AMBIGUITY_THRESHOLD)

    report = [
        "DoctorFind classifier eval (IDF nearest-phrase, conjunction-segmented cosine)",
        f"train docs: {len(train_docs)}  test docs: {len(test_docs)}  vocab: {len(vocab)}",
        f"exact-set accuracy:        {exact}/{len(test_docs)} = {exact/len(test_docs):.1%}",
        f"partial-overlap accuracy:  {overlap}/{len(test_docs)} = {overlap/len(test_docs):.1%}",
        f"fail-safe on clear phrases (want low):  {failsafe_clear}/{len(test_docs)} = {failsafe_clear/len(test_docs):.1%}",
        f"fail-safe on gibberish     (want high): {failsafe_gib}/{len(gibberish)} = {failsafe_gib/len(gibberish):.1%}",
        f"ambiguity threshold: {AMBIGUITY_THRESHOLD}  select threshold: {SIM_SELECT}",
        "corpus: ml/corpus.json — synthetic, team-curated Afaan Oromoo (needs native-speaker review).",
    ]
    print("\n".join(report))
    (ROOT / "ml" / "eval_report.txt").write_text("\n".join(report), encoding="utf-8")

    # ---- export (index built on ALL single phrases; compact array format)
    all_singles = train_s + test_s
    vocab_all, idf_all, entries_all = train(all_singles)
    inv = sorted(vocab_all, key=vocab_all.get)
    out = {
        "version": "APPv1", "lang": "om", "type": "idf-nearest-phrase",
        "ambiguity_threshold": AMBIGUITY_THRESHOLD, "select_threshold": SIM_SELECT,
        "max_selected": 4,
        "vocab": inv,
        "idf": [round(x, 2) for x in idf_all],
        "entries": [{"l": e["labels"],
                     "v": [[int(i), round(w, 2)] for i, w in e["v"].items()]}
                    for e in entries_all],
    }
    assets = ROOT / "app" / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    model_path = assets / "model.json"
    model_path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    shutil.copy(ROOT / "shared" / "symptoms.json", assets / "symptoms.json")
    print(f"\nwrote {model_path} ({model_path.stat().st_size/1024:.1f} KB)")

    # sanity: hash-table size for combos <= 4
    n = len(classes)
    total = sum(len(list(combinations(range(n), k))) for k in (1, 2, 3, 4))
    print(f"hash-table combinations (<=4 of {n} symptoms): {total}")


if __name__ == "__main__":
    main()
