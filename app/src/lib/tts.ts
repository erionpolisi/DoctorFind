// Text-to-speech with voice selection.
// No engine ships an Afaan Oromoo voice, so for Oromo text we prefer:
// om voice -> Swahili voice (same Latin script, much closer phonetics than
// English) -> default. For English we prefer Natural/Neural/Online voices
// (Edge exposes Azure "Natural" voices, Chrome exposes Google voices).

import * as Speech from "expo-speech";

type Voice = { identifier: string; name: string; language: string };

let voicesPromise: Promise<Voice[]> | null = null;

async function getVoices(): Promise<Voice[]> {
  if (!voicesPromise) {
    voicesPromise = (async () => {
      let v = (await Speech.getAvailableVoicesAsync()) as Voice[];
      if (!v?.length) {  // web often populates the list asynchronously
        await new Promise(r => setTimeout(r, 400));
        v = (await Speech.getAvailableVoicesAsync()) as Voice[];
      }
      return v ?? [];
    })().catch(() => []);
  }
  return voicesPromise;
}

const QUALITY = /natural|neural|online|premium|google/i;

function pick(voices: Voice[], langPrefix: string): Voice | undefined {
  const match = voices.filter(v => v.language?.toLowerCase().startsWith(langPrefix));
  return match.find(v => QUALITY.test(v.name)) ?? match[0];
}

export async function speakSmart(text: string, lang: "om" | "en"): Promise<void> {
  const voices = await getVoices();
  const voice = lang === "om"
    ? pick(voices, "om") ?? pick(voices, "sw")
    : pick(voices, "en");
  Speech.stop();
  Speech.speak(text, {
    voice: voice?.identifier,
    language: voice?.language ?? (lang === "om" ? "om" : "en"),
    rate: 0.92,   // slightly slow: accessibility for low-literacy users
    pitch: 1.0,
  });
}
