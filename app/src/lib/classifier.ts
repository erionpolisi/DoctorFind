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
  const segments = text.toLowerCase().split(/\bfi\b|\bakkasumas\b|,/).filter(s => s.trim());
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
