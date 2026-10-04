// UI strings — Afaan Oromoo first, English toggle.

export type Lang = "om" | "en";

const STRINGS = {
  appName: { om: "DoctorFind", en: "DoctorFind" },
  tagline: { om: "Gargaarsa fayyaa — SMS qofaan", en: "Health routing — SMS only" },
  consentTitle: { om: "Eeyyama", en: "Consent" },
  consentBody: {
    om: "Mallattoon kee lakkoofsa iccitii (hash) ta'ee ergama. Maqaan, lakkoofsi fi bakki kee sirriin HIN ergamu. Murtee xumuraa ogeessa fayyaatu kenna. Appiin kun dhukkuba HIN himu.",
    en: "Your symptoms are sent as an anonymous code. No name, phone number or exact location ever leaves this phone. A health worker makes the final decision. This app does NOT diagnose.",
  },
  consentYes: { om: "✓ Eeyyee — ittan fufa", en: "✓ Yes — continue" },
  settings: { om: "Demo settings", en: "Demo settings" },
  gatewayUrl: { om: "Gateway URL", en: "Gateway URL" },
  gatewayPhone: { om: "Lakkoofsa SMS gateway", en: "Gateway SMS number" },
  whatHurts: { om: "Maal si dhukkuba?", en: "What hurts?" },
  placeholder: { om: "fkn: mataan na dhukkuba…", en: "e.g.: I have a headache…" },
  aiButton: { om: "Hubadhu", en: "Understand" },
  aiUnsure: { om: "Hin mirkanoofne — nama gaafadhu. Namatu ilaala.", en: "Not sure — ask a person. A person will review this." },
  aiPartial: { om: "Gartokko hin hubatamne — namni ilaala.", en: "Partly unclear — a person will review." },
  aiFound: { om: "AI hubate:", en: "AI recognized:" },
  orTap: { om: "ykn suuraa tuqi", en: "or tap pictures" },
  continueBtn: { om: "Itti fufi ▸", en: "Continue ▸" },
  confirm: { om: "Mirkaneessi", en: "Confirm" },
  unclearReview: { om: "Hin mirkanoofne — namatu ilaala.", en: "Unclear — a person will review it." },
  smsNote: { om: "Hash qofa ergama — maqaa/GPS hin qabu", en: "Only a hash is sent — no name/GPS" },
  speak: { om: "🔊 Dubbisi", en: "🔊 Speak" },
  sendSms: { om: "📨 Ergi — SMS", en: "📨 Send — SMS" },
  sendDemo: { om: "🛰 Ergi — Demo", en: "🛰 Send — Demo" },
  back: { om: "◂ Deebi'i", en: "◂ Back" },
  reply: { om: "Deebii", en: "Reply" },
  smsSent: { om: "📨 SMS ergameera", en: "📨 SMS sent" },
  smsSentNote: {
    om: "Deebiin karaa SMS dhufa — interneetiin hin barbaachisu.",
    en: "The routing reply arrives as a normal SMS — no internet needed.",
  },
  noReply: { om: "Deebiin hin jiru.", en: "No reply yet." },
  newCase: { om: "⟲ Kaasaa haaraa", en: "⟲ New case" },
  call: { om: "tuqi bilbiluuf", en: "tap to call" },
  details: { om: "Bal'ina (SMS payload)", en: "Details (SMS payload)" },
  listening: { om: "Dhaggeeffachaa jira…", en: "Listening…" },
  sttUnavailable: {
    om: "Sagaleen as hin hojjetu — APK ykn web fayyadami.",
    en: "Voice input is not available here — use the APK or the web version.",
  },
  sttError: {
    om: "Sagalee hin hubanne — Afaan Ingilizii yaali ykn barreessi.",
    en: "Could not recognize speech — try English or type instead.",
  },
  sttPermission: {
    om: "Maayikirofoonii hayyami — settings keessatti.",
    en: "Microphone permission denied — allow it in settings.",
  },
  sttInsecure: {
    om: "Maayikirofooniin localhost/https qofa irratti hojjeta.",
    en: "Mic works only on localhost or https (browser security rule).",
  },
  sttNetwork: {
    om: "Tajaajilli sagalee hin argamne — network dhorkameera. Edge yaali ykn barreessi.",
    en: "Speech service unreachable — this network blocks it. Try Microsoft Edge, or type instead.",
  },
  sttEnFallback: {
    om: "Afaan Oromoo hin deeggaramne — Ingiliziidhaan dhaggeeffata.",
    en: "Oromo not supported by this engine — listening in English.",
  },
  demoUnreachable: {
    om: "Demo channel hin argamne — SMS fayyadami (interneetii malee hojjeta).",
    en: "Demo channel unreachable — use SMS (works without internet).",
  },
  smsUnavailable: { om: "SMS meeshaa kana irratti hin jiru.", en: "SMS not available on this device." },
} as const;

export type StringKey = keyof typeof STRINGS;

export const t = (lang: Lang, key: StringKey): string => STRINGS[key][lang];
