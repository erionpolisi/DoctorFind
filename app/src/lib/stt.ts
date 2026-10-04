// Speech-to-text, tuned for a low-resource language.
// No engine ships Afaan Oromoo ASR, so in Oromo mode we listen with SWAHILI
// acoustics (sw-TZ/sw-KE — phonetically much closer to Oromo than English);
// the character-trigram classifier then matches the Latin transcript. English
// mode uses en-US. Continuous: keeps listening across pauses (45 s cap) until
// the user taps stop; collects recognition alternatives for fuzzy matching.
// Expo Go has no native module -> "unavailable", UI degrades to typing.

import { Platform } from "react-native";

export type SttError = "unavailable" | "permission" | "insecure" | "network" | "error";
export type SttCallbacks = {
  onStart: (engine: string) => void;              // active locale label, e.g. "SW" | "EN"
  onPartial: (text: string) => void;
  onFinal: (text: string, alternatives: string[]) => void;
  onEnd: () => void;
  onError: (kind: SttError) => void;
};
export type SttHandle = { stop: () => void };

const MAX_SESSION_MS = 45_000;

const LOCALES: Record<"om" | "en", string[]> = {
  om: ["sw-TZ", "sw-KE", "en-US"],   // Swahili first: closest available acoustics to Oromo
  en: ["en-US", "en-GB"],
};
const label = (loc: string) => loc.split("-")[0].toUpperCase();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let native: any = null;
if (Platform.OS !== "web") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    native = require("expo-speech-recognition");
  } catch {
    native = null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const webSR = (): any =>
  Platform.OS === "web"
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null)
    : null;

export function sttAvailable(): boolean {
  return Platform.OS === "web" ? !!webSR() : !!native?.ExpoSpeechRecognitionModule;
}

export async function startStt(lang: "om" | "en", cb: SttCallbacks): Promise<SttHandle | null> {
  if (Platform.OS === "web") return startWeb(lang, cb);
  return startNative(lang, cb);
}

// ------------------------------------------------------------------- web
function startWeb(lang: "om" | "en", cb: SttCallbacks): SttHandle | null {
  const SR = webSR();
  if (!SR) { cb.onError("unavailable"); return null; }
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    cb.onError("insecure");
    return null;
  }

  const chain = LOCALES[lang];
  let chainIdx = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rec: any = null;
  let active = true;
  let finalText = "";
  const alternatives: string[] = [];
  const t0 = Date.now();

  const run = () => {
    const locale = chain[Math.min(chainIdx, chain.length - 1)];
    rec = new SR();
    rec.lang = locale;
    rec.continuous = true;          // keep listening across pauses
    rec.interimResults = true;
    rec.maxAlternatives = 4;
    let started = false;

    rec.onstart = () => { started = true; cb.onStart(label(locale)); };

    rec.onresult = (ev: { results: ArrayLike<{ 0: { transcript: string }; length: number; isFinal: boolean } & ArrayLike<{ transcript: string }>> }) => {
      let interim = "";
      let finals = "";
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) {
          finals += r[0].transcript + " ";
          for (let a = 1; a < r.length; a++) {
            const alt = r[a]?.transcript;
            if (alt && !alternatives.includes(alt)) alternatives.push(alt);
          }
        } else {
          interim += r[0].transcript;
        }
      }
      finalText = finals.trim();
      cb.onPartial((finalText + " " + interim).trim());
      if (finalText) cb.onFinal(finalText, [...alternatives]);
    };

    rec.onerror = (ev: { error?: string }) => {
      if (!active) return;
      const code = ev?.error ?? "error";
      if (code === "not-allowed" || code === "service-not-allowed") { active = false; cb.onError("permission"); return; }
      if (code === "network") { active = false; cb.onError("network"); return; }
      if ((code === "language-not-supported" || !started) && chainIdx < chain.length - 1) {
        chainIdx += 1;              // engine refused this locale: fall down the chain
        return;                     // onend fires next and restarts with the new locale
      }
      if (code === "no-speech" || code === "aborted") return;  // keep-alive handles these
      active = false;
      cb.onError("error");
    };

    rec.onend = () => {
      if (active && Date.now() - t0 < MAX_SESSION_MS) {
        try { run(); return; } catch { /* fall through */ }
      }
      active = false;
      cb.onEnd();
    };

    rec.start();
  };

  try { run(); } catch { cb.onError("error"); return null; }
  return {
    stop: () => {
      active = false;
      try { rec?.stop(); } catch { /* idle */ }
    },
  };
}

// ---------------------------------------------------------------- native
async function startNative(lang: "om" | "en", cb: SttCallbacks): Promise<SttHandle | null> {
  const mod = native?.ExpoSpeechRecognitionModule;
  if (!mod) { cb.onError("unavailable"); return null; }
  try {
    const perm = await mod.requestPermissionsAsync();
    if (!perm?.granted) { cb.onError("permission"); return null; }
    const locale = LOCALES[lang][0];
    const alternatives: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subs: any[] = [
      native.addSpeechRecognitionListener?.("start", () => cb.onStart(label(locale))),
      native.addSpeechRecognitionListener?.("result", (ev: { results?: { transcript?: string }[]; isFinal?: boolean }) => {
        const text = ev.results?.[0]?.transcript ?? "";
        if (!text) return;
        ev.results?.slice(1).forEach(r => {
          if (r.transcript && !alternatives.includes(r.transcript)) alternatives.push(r.transcript);
        });
        if (ev.isFinal) cb.onFinal(text, [...alternatives]);
        else cb.onPartial(text);
      }),
      native.addSpeechRecognitionListener?.("error", () => cb.onError("error")),
      native.addSpeechRecognitionListener?.("end", () => { subs.forEach(s => s?.remove?.()); cb.onEnd(); }),
    ];
    mod.start({ lang: locale, interimResults: true, continuous: true, maxAlternatives: 4 });
    return { stop: () => { try { mod.stop(); } catch { /* already stopped */ } } };
  } catch {
    cb.onError("unavailable");
    return null;
  }
}
