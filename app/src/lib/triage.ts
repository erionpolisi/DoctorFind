// Deterministic triage + PII-free payload. Mirrors server/hashing.py and
// server/app.py compute_tier(). Danger-sign rules always beat the classifier.

import * as Crypto from "expo-crypto";
import symptomsData from "../../assets/symptoms.json";

export type Symptom = {
  code: string; en: string; om: string; emoji: string;
  severity: 1 | 2 | 3; specialty: string;
};

export const SYMPTOMS: Symptom[] = (symptomsData.symptoms as Symptom[]);
export const BY_CODE: Record<string, Symptom> = Object.fromEntries(SYMPTOMS.map(s => [s.code, s]));
export const MAX_SELECTED = symptomsData.max_selected as number;

const APP_VERSION = "APPv1";
const SALT = "DF2026";
const HASH_LEN = 12;

export type Tier = "1" | "2" | "3" | "A";

export function computeTier(codes: string[]): Tier {
  const sevs = codes.map(c => BY_CODE[c].severity);
  if (sevs.includes(1)) return "1";
  if (sevs.includes(2) || sevs.filter(s => s === 3).length >= 3) return "2";
  return "3";
}

export async function buildPayload(codes: string[], loc: string, tier: Tier): Promise<string> {
  const canonical = [...codes].sort().join("|");
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${APP_VERSION}|${canonical}|salt=${SALT}`
  );
  return `H:${digest.slice(0, HASH_LEN)};V:1;L:${loc};T:${tier}`;
}

export type Reply = { caseId: string; name: string; phone: string; action: string; message: string };

export function parseReply(sms: string): Reply | null {
  const m = sms.match(/^R:(\d+);N:(.+?);P:(.+?);A:([A-Z_]+);M:(.+)$/);
  if (!m) return null;
  return { caseId: m[1], name: m[2], phone: m[3], action: m[4], message: m[5] };
}

export const ACTION_UI: Record<string, { om: string; en: string; color: string; icon: string }> = {
  GO_HOSPITAL: { om: "HOSPITAALA DHAQI — AMMA!", en: "Go to the hospital NOW", color: "#ff5d5d", icon: "🏥" },
  GO_CLINIC: { om: "Buufata fayyaa dhaqi — har'a", en: "Go to the health center today", color: "#ffb84d", icon: "🏥" },
  GO_PHARMACY: { om: "Mana qorichaa dhaqi", en: "Visit the pharmacy", color: "#58d68d", icon: "💊" },
  ASK_PERSON: { om: "Hin mirkanoofne — nama gaafadhu", en: "Not sure — ask a person", color: "#b48cff", icon: "🧑‍⚕️" },
  CALLBACK: { om: "Ogeessi fayyaa si bilbila", en: "A health worker will call you", color: "#b48cff", icon: "📞" },
};

export const TIER_UI: Record<Tier, { label: string; om: string; color: string }> = {
  "1": { label: "URGENT", om: "HATATTAMA", color: "#ff5d5d" },
  "2": { label: "Clinic today", om: "Har'a buufata fayyaa", color: "#ffb84d" },
  "3": { label: "Pharmacy / self-care", om: "Mana qorichaa", color: "#58d68d" },
  "A": { label: "Ask a person", om: "Nama gaafadhu", color: "#b48cff" },
};
