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
    <Pressable style={st.langBtn} onPress={() => setLang(l => (l === "om" ? "en" : "om"))}>
      <Text style={st.langBtnText}>{lang === "om" ? "EN" : "OM"}</Text>
    </Pressable>
  );

  const MuteToggle = (
    <Pressable
      style={[st.langBtn, muted && { backgroundColor: "#fef2f2", borderColor: "#dc2626" }]}
      onPress={() => { if (!muted) Speech.stop(); setMuted(m => !m); }}>
      <Text style={st.langBtnText}>{muted ? "🔇" : "🔊"}</Text>
    </Pressable>
  );

  const Header = (
    <View style={st.header}>
      <View style={st.brandDot}><Text style={st.brandDotText}>✚</Text></View>
      <Text style={st.brand}>{t(lang, "appName")}</Text>
      <View style={{ flex: 1 }} />
      {screen === "consent" && (
        <Pressable style={st.gear} onPress={() => setShowSettings(s => !s)}><Text style={{ fontSize: 18 }}>⚙️</Text></Pressable>
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
        <Big color="#0f766e" onPress={() => { speak("Baga nagaan dhufte", "Welcome"); setScreen("home"); }}>
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
          <Big small color="#1d4ed8" onPress={() => runClassifier(freeText)}>🤖 {t(lang, "aiButton")}</Big>
        )}
        {aiNote && <Text style={st.aiNote}>{aiNote}</Text>}
        {notice && <Text style={st.notice}>{notice}</Text>}

        <Text style={st.orTap}>{t(lang, "orTap")} (max {MAX_SELECTED})</Text>
        <View style={st.grid}>
          {SYMPTOMS.map(s => {
            const on = selected.includes(s.code);
            return (
              <Pressable key={s.code} onPress={() => { toggle(s.code); speak(s.om, s.en); }}
                style={[st.cell, on && { borderColor: TIER_UI[String(s.severity) as Tier].color, backgroundColor: "#f0fdfa" }]}>
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
        <Big color="#0f766e" disabled={selected.length === 0 && !(ambiguous && freeText)} onPress={goConfirm}>
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
          <Big color="#0f766e" onPress={sendRealSms}>{t(lang, "sendSms")}</Big>
        )}
        <Big color="#1d4ed8" onPress={sendDemoChannel}>{t(lang, "sendDemo")}</Big>
        {notice && <Text style={st.notice}>{notice}</Text>}

        <View style={st.rowButtons}>
          <Big small color="#e2e8f0" dark onPress={() => setScreen("home")}>{t(lang, "back")}</Big>
          <Big small color="#e2e8f0" dark onPress={() =>
            speak(selected.map(c => BY_CODE[c].om).join(", "), selected.map(c => BY_CODE[c].en).join(", "))}>
            {t(lang, "speak")}
          </Big>
          <Big small color="#e2e8f0" dark onPress={() => setShowDetails(d => !d)}>ℹ️</Big>
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
          <Big small color="#e2e8f0" dark onPress={() => speak(ui.om, ui.en)}>{t(lang, "speak")}</Big>
        </>
      ) : (
        <View style={st.card}><Text style={st.body}>{t(lang, "noReply")}</Text></View>
      )}
      <Big color="#0f766e" onPress={resetAll}>{t(lang, "newCase")}</Big>
    </Shell>
  );
}

// ------------------------------------------------------------- UI helpers
function Shell({ children, header }: { children: React.ReactNode; header: React.ReactNode }) {
  return (
    <View style={st.root}>
      <StatusBar barStyle="dark-content" />
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
      <Text style={[st.bigText, small && { fontSize: 14 }, dark && { color: "#15213b" }]}>{children}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f4f6fa" },
  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingTop: 48, paddingBottom: 12,
    backgroundColor: "#ffffff", borderBottomWidth: 1, borderBottomColor: "#e3e8f0",
  },
  brandDot: { width: 30, height: 30, borderRadius: 8, backgroundColor: "#0f766e", alignItems: "center", justifyContent: "center" },
  brandDotText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  brand: { fontSize: 17, fontWeight: "800", color: "#15213b" },
  gear: { padding: 6 },
  langBtn: {
    borderWidth: 1.5, borderColor: "#0f766e", borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 5, backgroundColor: "#f0fdfa",
  },
  langBtnText: { color: "#0f766e", fontWeight: "800", fontSize: 13 },
  scroll: { padding: 16, paddingBottom: 48 },

  hero: { fontSize: 56, textAlign: "center", marginTop: 18 },
  heroTitle: { fontSize: 30, fontWeight: "800", color: "#15213b", textAlign: "center" },
  heroSub: { color: "#64748b", textAlign: "center", marginTop: 4, marginBottom: 14, fontSize: 15 },

  question: { fontSize: 24, fontWeight: "800", color: "#15213b", marginVertical: 10 },
  card: {
    backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#e3e8f0", borderRadius: 14,
    padding: 16, marginVertical: 8,
  },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#15213b", marginBottom: 6 },
  body: { color: "#334155", fontSize: 14.5, lineHeight: 21 },
  label: { color: "#64748b", fontSize: 12.5, marginTop: 10, marginBottom: 4 },
  input: {
    backgroundColor: "#f8fafc", borderColor: "#e3e8f0", borderWidth: 1, borderRadius: 10,
    color: "#15213b", padding: 10, fontSize: 14,
  },

  inputRow: { flexDirection: "row", gap: 10, alignItems: "stretch" },
  textInput: {
    flex: 1, backgroundColor: "#ffffff", borderColor: "#e3e8f0", borderWidth: 1, borderRadius: 14,
    color: "#15213b", padding: 14, fontSize: 16, minHeight: 56,
  },
  micBtn: {
    width: 56, borderRadius: 14, backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#e3e8f0",
    alignItems: "center", justifyContent: "center",
  },
  micBtnOn: { borderColor: "#dc2626", backgroundColor: "#fef2f2" },
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
    color: "#334155", fontSize: 14, marginTop: 10, backgroundColor: "#f0fdfa",
    borderColor: "#99f6e4", borderWidth: 1, borderRadius: 10, padding: 10, lineHeight: 20,
  },
  notice: {
    color: "#b91c1c", fontSize: 13, marginTop: 10, backgroundColor: "#fef2f2",
    borderColor: "#fecaca", borderWidth: 1, borderRadius: 10, padding: 10,
  },
  orTap: { color: "#64748b", fontSize: 13, marginTop: 16, marginBottom: 8 },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cell: {
    width: "23.3%", backgroundColor: "#ffffff", borderColor: "#e3e8f0", borderWidth: 2,
    borderRadius: 12, alignItems: "center", paddingVertical: 10, paddingHorizontal: 2, minHeight: 78,
  },
  emoji: { fontSize: 26 },
  cellLabel: { color: "#15213b", fontSize: 10.5, fontWeight: "700", textAlign: "center", marginTop: 4 },

  tierBar: { borderRadius: 10, padding: 11, marginTop: 14 },
  tierText: { color: "#ffffff", fontWeight: "800", textAlign: "center", fontSize: 15 },

  big: { borderRadius: 14, padding: 16, marginTop: 12 },
  bigSmall: { padding: 10, marginTop: 8, flex: 1 },
  bigText: { color: "#ffffff", fontWeight: "800", fontSize: 17, textAlign: "center" },
  rowButtons: { flexDirection: "row", gap: 8 },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    backgroundColor: "#f0fdfa", borderColor: "#99f6e4", borderWidth: 1,
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
  },
  chipText: { color: "#134e4a", fontWeight: "700", fontSize: 14 },
  privacyNote: { color: "#64748b", fontSize: 12, marginTop: 10 },
  payload: {
    color: "#0f766e", fontFamily: Platform.OS === "web" ? "monospace" : "monospace",
    fontSize: 13, backgroundColor: "#f8fafc", padding: 10, borderRadius: 8,
  },

  replyCard: {
    backgroundColor: "#ffffff", borderWidth: 3, borderRadius: 18, padding: 22,
    alignItems: "center", marginVertical: 10,
  },
  replyIcon: { fontSize: 52 },
  replyAction: { fontSize: 22, fontWeight: "900", textAlign: "center", marginVertical: 8 },
  replyFacility: { color: "#15213b", fontSize: 19, fontWeight: "700", textAlign: "center" },
  callBtn: { borderRadius: 14, paddingVertical: 12, paddingHorizontal: 22, marginTop: 14, alignItems: "center" },
  callBtnText: { color: "#fff", fontWeight: "800", fontSize: 17 },
  callBtnSub: { color: "rgba(255,255,255,0.85)", fontSize: 11.5, marginTop: 2 },
});
