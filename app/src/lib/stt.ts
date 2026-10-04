// Speech-to-text wrapper.
// - Web: Web Speech API. Requires a secure context (https or localhost) and
//   mic permission. If the engine rejects Afaan Oromoo (om-ET), we restart
//   once in en-US and tell the UI via onInfo("enFallback").
// - Android APK / dev build: expo-speech-recognition (native recognizer).
// - Expo Go: module not bundled -> "unavailable", UI degrades to typing.

import { Platform } from "react-native";

export type SttError = "unavailable" | "permission" | "insecure" | "network" | "error";
export type SttCallbacks = {
  onStart: () => void;                 // mic is actually live (drives the indicator)
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onEnd: () => void;
  onError: (kind: SttError) => void;
  onInfo?: (kind: "enFallback") => void;
};
export type SttHandle = { stop: () => void };

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

const locale = (lang: "om" | "en") => (lang === "om" ? "om-ET" : "en-US");

export async function startStt(lang: "om" | "en", cb: SttCallbacks): Promise<SttHandle | null> {
  if (Platform.OS === "web") return startWeb(lang, cb);
  return startNative(lang, cb);
}

// ------------------------------------------------------------------- web
function startWeb(lang: "om" | "en", cb: SttCallbacks): SttHandle | null {
  const SR = webSR();
  if (!SR) { cb.onError("unavailable"); return null; }
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    cb.onError("insecure");  // http over LAN IP: browser blocks the mic
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rec: any = null;
  let stopped = false;
  let restarting = false;
  let triedEnFallback = lang === "en";

  const run = (loc: string) => {
    restarting = false;
    rec = new SR();
    rec.lang = loc;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let gotResult = false;

    rec.onstart = () => cb.onStart();
    rec.onresult = (ev: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => {
      gotResult = true;
      let interim = "", final = "";
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        (r.isFinal ? (final += r[0].transcript) : (interim += r[0].transcript));
      }
      if (final) cb.onFinal(final);
      else if (interim) cb.onPartial(interim);
    };
    rec.onerror = (ev: { error?: string }) => {
      if (stopped) return;
      const code = ev?.error ?? "error";
      if (code === "not-allowed" || code === "service-not-allowed") {
        cb.onError("permission");
        return;
      }
      if (code === "network") {
        // Chrome streams audio to Google's speech service; blocked networks
        // (corporate proxy) land here. Edge uses Azure and may work.
        cb.onError("network");
        return;
      }
      // Engine refused the language (or produced nothing for it): retry in English once.
      if (!triedEnFallback && !gotResult) {
        triedEnFallback = true;
        restarting = true;
        cb.onInfo?.("enFallback");
        try { run("en-US"); return; } catch { /* fall through */ }
      }
      if (code !== "no-speech" && code !== "aborted") cb.onError("error");
    };
    rec.onend = () => { if (!stopped && !restarting) cb.onEnd(); };
    rec.start();
  };

  try { run(locale(lang)); } catch { cb.onError("error"); return null; }
  return { stop: () => { stopped = true; try { rec?.stop(); } catch { /* idle */ } cb.onEnd(); } };
}

// ---------------------------------------------------------------- native
async function startNative(lang: "om" | "en", cb: SttCallbacks): Promise<SttHandle | null> {
  const mod = native?.ExpoSpeechRecognitionModule;
  if (!mod) { cb.onError("unavailable"); return null; }
  try {
    const perm = await mod.requestPermissionsAsync();
    if (!perm?.granted) { cb.onError("permission"); return null; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subs: any[] = [
      native.addSpeechRecognitionListener?.("start", () => cb.onStart()),
      native.addSpeechRecognitionListener?.("result", (ev: { results?: { transcript?: string }[]; isFinal?: boolean }) => {
        const text = ev.results?.[0]?.transcript ?? "";
        if (!text) return;
        (ev.isFinal ? cb.onFinal : cb.onPartial)(text);
      }),
      native.addSpeechRecognitionListener?.("error", () => cb.onError("error")),
      native.addSpeechRecognitionListener?.("end", () => { subs.forEach(s => s?.remove?.()); cb.onEnd(); }),
    ];
    mod.start({ lang: locale(lang), interimResults: true, continuous: false });
    return { stop: () => { try { mod.stop(); } catch { /* already stopped */ } } };
  } catch {
    cb.onError("unavailable");
    return null;
  }
}
