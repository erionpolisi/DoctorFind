// On-device Small AI: IDF nearest-phrase classifier for Afaan Oromoo symptom
// descriptions. Mirrors ml/train.py predict(). Pure JS over a ~60 KB JSON
// index — no network, no native ML runtime, runs on low-end Android.

import model from "../../assets/model.json";

type Entry = { l: string[]; v: [number, number][] };

const VOCAB: Record<string, number> = {};
(model.vocab as string[]).forEach((t, i) => (VOCAB[t] = i));
const IDF = model.idf as number[];
const ENTRIES = model.entries as Entry[];
const SELECT = model.select_threshold as number;
const AMBIG = model.ambiguity_threshold as number;
const MAX_SELECTED = model.max_selected as number;

function tokenize(text: string): string[] {
  const words = (text.toLowerCase().replace(/\u2019/g, "'").match(/[a-z']+/g) ?? []) as string[];
  const feats: string[] = [];
  for (const w of words) {
    feats.push(w);
    const padded = `<${w}>`;
    for (let i = 0; i + 3 <= padded.length; i++) feats.push(padded.slice(i, i + 3));
  }
  return feats;
}

export type Prediction = { codes: string[]; confidence: number; ambiguous: boolean };

export function predictSymptoms(text: string): Prediction {
  const segments = text.toLowerCase().split(/\bfi\b|\bakkasumas\b|\band\b|,/).filter(s => s.trim());
  if (!segments.length) return { codes: [], confidence: 0, ambiguous: true };

  const votes: Record<string, number> = {};
  let worst = 1.0;

  for (const seg of segments) {
    const vec: Record<number, number> = {};
    for (const t of tokenize(seg)) {
      const i = VOCAB[t];
      if (i !== undefined) vec[i] = (vec[i] ?? 0) + IDF[i];
    }
    let norm = Math.sqrt(Object.values(vec).reduce((a, v) => a + v * v, 0)) || 1;
    for (const k of Object.keys(vec)) vec[+k] /= norm;

    let bestSim = 0;
    let bestLabels: string[] = [];
    for (const e of ENTRIES) {
      let s = 0;
      for (const [i, w] of e.v) if (vec[i] !== undefined) s += vec[i] * w;
      if (s > bestSim) { bestSim = s; bestLabels = e.l; }
    }
    worst = Math.min(worst, bestSim);
    if (bestSim >= SELECT) for (const c of bestLabels) votes[c] = Math.max(votes[c] ?? 0, bestSim);
  }

  const codes = Object.keys(votes).sort((a, b) => votes[b] - votes[a]).slice(0, MAX_SELECTED);
  // Fail-safe semantics: if ANY segment is not understood, a person must check.
  return { codes, confidence: worst, ambiguous: worst < AMBIG || codes.length === 0 };
}

export type Suggestion = { code: string; sim: number };
const SUGGEST_FLOOR = 0.18; // below this it's noise, not a suggestion

/** Closest symptoms even below the selection threshold — the user confirms by
 * tapping, so showing near-misses is safe and "always helps". */
export function suggestSymptoms(texts: string[], k = 3): Suggestion[] {
  const best: Record<string, number> = {};
  for (const text of texts) {
    for (const seg of text.toLowerCase().split(/\bfi\b|\bakkasumas\b|\band\b|,/)) {
      if (!seg.trim()) continue;
      const vec: Record<number, number> = {};
      for (const t of tokenize(seg)) {
        const i = VOCAB[t];
        if (i !== undefined) vec[i] = (vec[i] ?? 0) + IDF[i];
      }
      const norm = Math.sqrt(Object.values(vec).reduce((a, v) => a + v * v, 0)) || 1;
      for (const key of Object.keys(vec)) vec[+key] /= norm;
      for (const e of ENTRIES) {
        let s = 0;
        for (const [i, w] of e.v) if (vec[i] !== undefined) s += vec[i] * w;
        if (s >= SUGGEST_FLOOR) for (const c of e.l) best[c] = Math.max(best[c] ?? 0, s);
      }
    }
  }
  return Object.entries(best)
    .map(([code, sim]) => ({ code, sim }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, k);
}

/** Run prediction over the primary transcript AND recognizer alternatives;
 * keep the most confident reading, plus suggestions for the tap-to-confirm UI. */
export function predictBest(texts: string[]): Prediction & { suggestions: Suggestion[] } {
  const candidates = texts.filter(t => t.trim());
  let best: Prediction = { codes: [], confidence: 0, ambiguous: true };
  for (const t of candidates) {
    const p = predictSymptoms(t);
    const better = (!p.ambiguous && best.ambiguous) ||
      (p.ambiguous === best.ambiguous && p.confidence > best.confidence);
    if (better) best = p;
  }
  return { ...best, suggestions: best.ambiguous ? suggestSymptoms(candidates) : [] };
}
