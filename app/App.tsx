// DoctorFind — offline-first patient app. Afaan Oromoo first, EN toggle.
// Simple by design: one question, pictograms, voice/text, two send paths.
// No diagnosis; low confidence => "ask a person" (human review).

import React, { useEffect, useRef, useState } from "react";
import {
  Animated, Easing, Linking, Platform, Pressable, ScrollView, StatusBar,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import * as SMS from "expo-sms";
import * as Speech from "expo-speech";

import { predictSymptoms } from "./src/lib/classifier";
import { Lang, t } from "./src/lib/i18n";
import { sttAvailable, startStt, SttHandle } from "./src/lib/stt";
import { speakSmart } from "./src/lib/tts";
import {
  ACTION_UI, BY_CODE, buildPayload, computeTier, MAX_SELECTED, parseReply,
  Reply, SYMPTOMS, Tier, TIER_UI,
} from "./src/lib/triage";

type Screen = "consent" | "home" | "confirm" | "reply";

const DEFAULT_GATEWAY_URL = Platform.OS === "web" && typeof window !== "undefined"
  ? window.location.origin
  : "http://192.168.0.100:8000";
const DEFAULT_GATEWAY_PHONE = "+251900000000";
const LOC_ID = "OR-12"; // coarse village cell — never GPS

export default function App() {
  const [lang, setLang] = useState<Lang>("om");
  const [screen, setScreen] = useState<Screen>("consent");
  const [showSettings, setShowSettings] = useState(false);
  const [gatewayUrl, setGatewayUrl] = useState(DEFAULT_GATEWAY_URL);
  const [gatewayPhone, setGatewayPhone] = useState(DEFAULT_GATEWAY_PHONE);
  const [smsPossible, setSmsPossible] = useState(false);

  const [selected, setSelected] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [ambiguous, setAmbiguous] = useState(false);
  const [payload, setPayload] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);
  const [sentViaRealSms, setSentViaRealSms] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);
  const sttRef = useRef<SttHandle | null>(null);
  const baseTextRef = useRef("");
  const mutedRef = useRef(false);
  const pulse = useRef(new Animated.Value(1)).current;
  mutedRef.current = muted;

  useEffect(() => { SMS.isAvailableAsync().then(setSmsPossible).catch(() => setSmsPossible(false)); }, []);

  useEffect(() => {
    if (!listening) { pulse.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.6, duration: 500, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 500, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [listening, pulse]);

  const tier: Tier = ambiguous && selected.length === 0 ? "A" : computeTier(selected);

  const speak = (om: string, en: string) => {
    if (mutedRef.current) return;
    void speakSmart(lang === "om" ? om : en, lang);
  };

  // ---------------------------------------------------------------- AI
  const runClassifier = (text: string) => {
    const p = predictSymptoms(text);
    setAmbiguous(p.ambiguous);
    if (p.ambiguous && p.codes.length === 0) {
      setAiNote(`🧑‍⚕️ ${t(lang, "aiUnsure")}`);
      return;
    }
    const merged = [...new Set([...selected, ...p.codes])].slice(0, MAX_SELECTED);
    setSelected(merged);
    setAiNote(
      (p.ambiguous ? `⚠️ ${t(lang, "aiPartial")}\n` : "") +
      `${t(lang, "aiFound")} ` + p.codes.map(c => `${BY_CODE[c].emoji} ${BY_CODE[c][lang]}`).join(", ")
    );
  };

  // ---------------------------------------------------------------- STT
  const toggleMic = async () => {
    if (listening) { sttRef.current?.stop(); setListening(false); return; }
    if (!sttAvailable()) { setNotice(t(lang, "sttUnavailable")); return; }
    setNotice(null);
    baseTextRef.current = freeText.trim() ? freeText.trim() + " " : "";
    sttRef.current = await startStt(lang, {
      onStart: () => setListening(true),
      onPartial: (text) => setFreeText(baseTextRef.current + text),
      onFinal: (text) => { setFreeText(baseTextRef.current + text); runClassifier(baseTextRef.current + text); },
      onEnd: () => setListening(false),
      onError: (kind) => {
        setListening(false);
        const key = kind === "unavailable" ? "sttUnavailable"
          : kind === "permission" ? "sttPermission"
          : kind === "insecure" ? "sttInsecure"
          : kind === "network" ? "sttNetwork" : "sttError";
        setNotice(t(lang, key));
      },
      onInfo: (kind) => { if (kind === "enFallback") setNotice(t(lang, "sttEnFallback")); },
    });
  };

  const toggle = (code: string) =>
    setSelected(s => s.includes(code) ? s.filter(c => c !== code)
      : s.length >= MAX_SELECTED ? s : [...s, code]);

  const goConfirm = async () => {
    sttRef.current?.stop();
    setPayload(await buildPayload(selected, LOC_ID, tier));
    setNotice(null);
    setScreen("confirm");
  };

  // ---------------------------------------------------------------- send
  const sendRealSms = async () => {
    setSentViaRealSms(true);
    if (Platform.OS === "web") {
      // Browsers cannot send SMS, but the sms: intent opens the phone's
      // messaging app with the payload prefilled — works with zero data.
      window.location.href = `sms:${gatewayPhone}?body=${encodeURIComponent(payload)}`;
      setReply(null);
      setScreen("reply");
      return;
    }
    if (await SMS.isAvailableAsync()) {
      await SMS.sendSMSAsync([gatewayPhone], payload);
      setReply(null);
      setScreen("reply");
    } else {
      setNotice(t(lang, "smsUnavailable"));
    }
  };

  const sendDemoChannel = async () => {
    setSentViaRealSms(false);
    setNotice(null);
    try {
      const res = await fetch(`${gatewayUrl.replace(/\/$/, "")}/gateway/sms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender: "demo-phone", body: payload }),
      });
      const data = await res.json();
      const r = parseReply(data.reply_sms);
      setReply(r);
      setScreen("reply");
      if (r && ACTION_UI[r.action]) speak(ACTION_UI[r.action].om, ACTION_UI[r.action].en);
    } catch {
      setNotice(t(lang, "demoUnreachable"));
    }
  };

  const resetAll = () => {
    setSelected([]); setFreeText(""); setAiNote(null); setAmbiguous(false);
    setPayload(""); setReply(null); setNotice(null); setShowDetails(false); setScreen("home");
  };

  // ---------------------------------------------------------------- chrome
  const LangToggle = (
    <Pressable style={st.hBtn} onPress={() => setLang(l => (l === "om" ? "en" : "om"))}>
      <Text style={st.hBtnText}>{lang === "om" ? "EN" : "OM"}</Text>
    </Pressable>
  );

  const MuteToggle = (
    <Pressable
      style={[st.hBtn, muted && st.hBtnMuted]}
      onPress={() => { if (!muted) Speech.stop(); setMuted(m => !m); }}>
      <Text style={st.hBtnText}>{muted ? "🔇" : "🔊"}</Text>
    </Pressable>
  );

  const Header = (
    <View style={st.header}>
      <Text style={st.brand}>Doctor<Text style={st.brandAccent}>Find</Text><Text style={st.brandSup}> ✚</Text></Text>
      <View style={{ flex: 1 }} />
      {screen === "consent" && (
        <Pressable style={st.hBtn} onPress={() => setShowSettings(s => !s)}><Text style={st.hBtnText}>⚙️</Text></Pressable>
      )}
      {MuteToggle}
      {LangToggle}
    </View>
  );

  // ---------------------------------------------------------------- screens
  if (screen === "consent") {
    return (
      <Shell header={Header}>
        <Text style={st.hero}>🏥</Text>
        <Text style={st.heroTitle}>{t(lang, "appName")}</Text>
        <Text style={st.heroSub}>{t(lang, "tagline")}</Text>
        <View style={st.card}>
          <Text style={st.cardTitle}>{t(lang, "consentTitle")}</Text>
          <Text style={st.body}>{t(lang, "consentBody")}</Text>
        </View>
        <Big color="#10a37f" onPress={() => { speak("Baga nagaan dhufte", "Welcome"); setScreen("home"); }}>
          {t(lang, "consentYes")}
        </Big>
        {showSettings && (
          <View style={st.card}>
            <Text style={st.cardTitle}>⚙ {t(lang, "settings")}</Text>
            <Text style={st.label}>{t(lang, "gatewayUrl")}</Text>
            <TextInput style={st.input} value={gatewayUrl} onChangeText={setGatewayUrl}
              autoCapitalize="none" autoCorrect={false} />
            <Text style={st.label}>{t(lang, "gatewayPhone")}</Text>
            <TextInput style={st.input} value={gatewayPhone} onChangeText={setGatewayPhone}
              autoCapitalize="none" keyboardType="phone-pad" />
          </View>
        )}
      </Shell>
    );
  }

  if (screen === "home") {
    return (
      <Shell header={Header}>
        <Text style={st.question}>{t(lang, "whatHurts")}</Text>

        <View style={st.inputRow}>
          <TextInput
            style={st.textInput}
            placeholder={t(lang, "placeholder")}
            placeholderTextColor="#94a3b8"
            value={freeText}
            onChangeText={setFreeText}
            multiline
          />
          <Pressable style={[st.micBtn, listening && st.micBtnOn]} onPress={toggleMic}>
            {listening
              ? <Animated.View style={[st.micPulse, { transform: [{ scale: pulse }] }]} />
              : null}
            <Text style={st.micIcon}>🎙️</Text>
          </Pressable>
        </View>
        {listening && (
          <View style={st.listenBar}>
            <Animated.View style={[st.redDot, { transform: [{ scale: pulse }] }]} />
            <Text style={st.listenText}>{t(lang, "listening")}</Text>
          </View>
        )}
        {!!freeText.trim() && !listening && (
          <Big small color="#3f7fde" onPress={() => runClassifier(freeText)}>🤖 {t(lang, "aiButton")}</Big>
        )}
        {aiNote && <Text style={st.aiNote}>{aiNote}</Text>}
        {notice && <Text style={st.notice}>{notice}</Text>}

        <Text style={st.orTap}>{t(lang, "orTap")} (max {MAX_SELECTED})</Text>
        <View style={st.grid}>
          {SYMPTOMS.map(s => {
            const on = selected.includes(s.code);
            return (
              <Pressable key={s.code} onPress={() => { toggle(s.code); speak(s.om, s.en); }}
                style={[st.cell, on && { borderColor: TIER_UI[String(s.severity) as Tier].color, backgroundColor: "#e6f7f1" }]}>
                <Text style={st.emoji}>{s.emoji}</Text>
                <Text style={st.cellLabel} numberOfLines={2}>{s[lang]}</Text>
              </Pressable>
            );
          })}
        </View>

        {(selected.length > 0 || (ambiguous && freeText)) && (
          <View style={[st.tierBar, { backgroundColor: TIER_UI[tier].color }]}>
            <Text style={st.tierText}>{TIER_UI[tier][lang]}</Text>
          </View>
        )}
        <Big color="#10a37f" disabled={selected.length === 0 && !(ambiguous && freeText)} onPress={goConfirm}>
          {t(lang, "continueBtn")}
        </Big>
      </Shell>
    );
  }

  if (screen === "confirm") {
    return (
      <Shell header={Header}>
        <Text style={st.question}>{t(lang, "confirm")}</Text>

        <View style={st.card}>
          {selected.length === 0
            ? <Text style={st.body}>🧑‍⚕️ {t(lang, "unclearReview")}</Text>
            : (
              <View style={st.chips}>
                {selected.map(c => (
                  <View key={c} style={st.chip}>
                    <Text style={st.chipText}>{BY_CODE[c].emoji} {BY_CODE[c][lang]}</Text>
                  </View>
                ))}
              </View>
            )}
          <View style={[st.tierBar, { backgroundColor: TIER_UI[tier].color, marginTop: 12 }]}>
            <Text style={st.tierText}>{TIER_UI[tier][lang]}</Text>
          </View>
          <Text style={st.privacyNote}>🔒 {t(lang, "smsNote")}</Text>
        </View>

        {(smsPossible || Platform.OS === "web") && (
          <Big color="#10a37f" onPress={sendRealSms}>{t(lang, "sendSms")}</Big>
        )}
        <Big color="#3f7fde" onPress={sendDemoChannel}>{t(lang, "sendDemo")}</Big>
        {notice && <Text style={st.notice}>{notice}</Text>}

        <View style={st.rowButtons}>
          <Big small color="#eef2f7" dark onPress={() => setScreen("home")}>{t(lang, "back")}</Big>
          <Big small color="#eef2f7" dark onPress={() =>
            speak(selected.map(c => BY_CODE[c].om).join(", "), selected.map(c => BY_CODE[c].en).join(", "))}>
            {t(lang, "speak")}
          </Big>
          <Big small color="#eef2f7" dark onPress={() => setShowDetails(d => !d)}>ℹ️</Big>
        </View>
        {showDetails && (
          <View style={st.card}>
            <Text style={st.cardTitle}>{t(lang, "details")}</Text>
            <Text style={st.payload}>{payload}</Text>
          </View>
        )}
      </Shell>
    );
  }

  // reply
  const ui = reply ? ACTION_UI[reply.action] : null;
  return (
    <Shell header={Header}>
      <Text style={st.question}>{t(lang, "reply")}</Text>
      {sentViaRealSms && !reply ? (
        <View style={st.card}>
          <Text style={st.cardTitle}>{t(lang, "smsSent")}</Text>
          <Text style={st.body}>{t(lang, "smsSentNote")}</Text>
        </View>
      ) : reply && ui ? (
        <>
          <View style={[st.replyCard, { borderColor: ui.color }]}>
            <Text style={st.replyIcon}>{ui.icon}</Text>
            <Text style={[st.replyAction, { color: ui.color }]}>{lang === "om" ? ui.om : ui.en}</Text>
            <Text style={st.replyFacility}>{reply.name}</Text>
            <Pressable style={[st.callBtn, { backgroundColor: ui.color }]} onPress={() => Linking.openURL(`tel:${reply.phone}`)}>
              <Text style={st.callBtnText}>📞 {reply.phone}</Text>
              <Text style={st.callBtnSub}>{t(lang, "call")}</Text>
            </Pressable>
          </View>
          <Big small color="#eef2f7" dark onPress={() => speak(ui.om, ui.en)}>{t(lang, "speak")}</Big>
        </>
      ) : (
        <View style={st.card}><Text style={st.body}>{t(lang, "noReply")}</Text></View>
      )}
      <Big color="#10a37f" onPress={resetAll}>{t(lang, "newCase")}</Big>
    </Shell>
  );
}

// ------------------------------------------------------------- UI helpers
function Shell({ children, header }: { children: React.ReactNode; header: React.ReactNode }) {
  return (
    <View style={st.root}>
      <StatusBar barStyle="light-content" />
      {header}
      <ScrollView contentContainerStyle={st.scroll}>{children}</ScrollView>
    </View>
  );
}
function Big({ children, onPress, color, disabled, small, dark }: {
  children: React.ReactNode; onPress: () => void; color: string;
  disabled?: boolean; small?: boolean; dark?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled}
      style={({ pressed }) => [
        st.big, small && st.bigSmall,
        { backgroundColor: color, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 },
      ]}>
      <Text style={[st.bigText, small && { fontSize: 14 }, dark && { color: "#273142" }]}>{children}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f2f5f9" },
  header: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 16, paddingTop: 48, paddingBottom: 12,
    backgroundColor: "#0a7a5f",
  },
  brand: { fontSize: 19, fontWeight: "800", color: "#ffffff", letterSpacing: 0.2 },
  brandAccent: { color: "#9fe8cf" },
  brandSup: { color: "#c9f3e4", fontSize: 12 },
  hBtn: {
    minWidth: 38, height: 34, borderRadius: 17, paddingHorizontal: 11,
    backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center",
  },
  hBtnMuted: { backgroundColor: "rgba(220,38,38,0.45)" },
  hBtnText: { color: "#ffffff", fontWeight: "800", fontSize: 13 },
  scroll: { padding: 16, paddingBottom: 48 },

  hero: { fontSize: 56, textAlign: "center", marginTop: 18 },
  heroTitle: { fontSize: 30, fontWeight: "800", color: "#273142", textAlign: "center" },
  heroSub: { color: "#8a94a6", textAlign: "center", marginTop: 4, marginBottom: 14, fontSize: 15 },

  question: { fontSize: 22, fontWeight: "800", color: "#273142", marginVertical: 10 },
  card: {
    backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#e9edf3", borderRadius: 12,
    padding: 16, marginVertical: 8,
    shadowColor: "#273142", shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  cardTitle: { fontSize: 14, fontWeight: "800", color: "#0a7a5f", marginBottom: 6 },
  body: { color: "#45526b", fontSize: 14.5, lineHeight: 21 },
  label: { color: "#8a94a6", fontSize: 12.5, marginTop: 10, marginBottom: 4 },
  input: {
    backgroundColor: "#f7f9fc", borderColor: "#e9edf3", borderWidth: 1, borderRadius: 9,
    color: "#273142", padding: 10, fontSize: 14,
  },

  inputRow: { flexDirection: "row", gap: 10, alignItems: "stretch" },
  textInput: {
    flex: 1, backgroundColor: "#ffffff", borderColor: "#e9edf3", borderWidth: 1, borderRadius: 12,
    color: "#273142", padding: 14, fontSize: 16, minHeight: 56,
    shadowColor: "#273142", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  micBtn: {
    width: 56, borderRadius: 12, backgroundColor: "#10a37f",
    alignItems: "center", justifyContent: "center",
  },
  micBtnOn: { backgroundColor: "#fee2e2", borderWidth: 2, borderColor: "#dc2626" },
  micIcon: { fontSize: 24 },
  micPulse: {
    position: "absolute", width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(220,38,38,0.18)",
  },
  listenBar: {
    flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10,
    backgroundColor: "#fef2f2", borderColor: "#fecaca", borderWidth: 1, borderRadius: 10, padding: 10,
  },
  redDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#dc2626" },
  listenText: { color: "#b91c1c", fontWeight: "700", fontSize: 14 },

  aiNote: {
    color: "#177a53", fontSize: 14, marginTop: 10, backgroundColor: "#e8f8f0",
    borderColor: "#c9ecd9", borderWidth: 1, borderRadius: 10, padding: 10, lineHeight: 20,
  },
  notice: {
    color: "#b91c1c", fontSize: 13, marginTop: 10, backgroundColor: "#fef2f2",
    borderColor: "#fecaca", borderWidth: 1, borderRadius: 10, padding: 10,
  },
  orTap: { color: "#8a94a6", fontSize: 13, marginTop: 16, marginBottom: 8 },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cell: {
    width: "23.3%", backgroundColor: "#ffffff", borderColor: "#e9edf3", borderWidth: 2,
    borderRadius: 12, alignItems: "center", paddingVertical: 10, paddingHorizontal: 2, minHeight: 78,
  },
  emoji: { fontSize: 26 },
  cellLabel: { color: "#273142", fontSize: 10.5, fontWeight: "700", textAlign: "center", marginTop: 4 },

  tierBar: { borderRadius: 10, padding: 11, marginTop: 14 },
  tierText: { color: "#ffffff", fontWeight: "800", textAlign: "center", fontSize: 15 },

  big: { borderRadius: 12, padding: 16, marginTop: 12,
    shadowColor: "#273142", shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  bigSmall: { padding: 10, marginTop: 8, flex: 1 },
  bigText: { color: "#ffffff", fontWeight: "800", fontSize: 17, textAlign: "center" },
  rowButtons: { flexDirection: "row", gap: 8 },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    backgroundColor: "#e6f7f1", borderColor: "#bfe9da", borderWidth: 1,
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
  },
  chipText: { color: "#0a7a5f", fontWeight: "700", fontSize: 14 },
  privacyNote: { color: "#8a94a6", fontSize: 12, marginTop: 10 },
  payload: {
    color: "#10a37f", fontFamily: Platform.OS === "web" ? "monospace" : "monospace",
    fontSize: 13, backgroundColor: "#f7f9fc", padding: 10, borderRadius: 8,
  },

  replyCard: {
    backgroundColor: "#ffffff", borderWidth: 3, borderRadius: 14, padding: 22,
    alignItems: "center", marginVertical: 10,
    shadowColor: "#273142", shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  replyIcon: { fontSize: 52 },
  replyAction: { fontSize: 22, fontWeight: "900", textAlign: "center", marginVertical: 8 },
  replyFacility: { color: "#273142", fontSize: 19, fontWeight: "700", textAlign: "center" },
  callBtn: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 22, marginTop: 14, alignItems: "center" },
  callBtnText: { color: "#fff", fontWeight: "800", fontSize: 17 },
  callBtnSub: { color: "rgba(255,255,255,0.85)", fontSize: 11.5, marginTop: 2 },
});
