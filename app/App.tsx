// DoctorFind — offline-first patient app (Afaan Oromoo).
// Capture symptoms (pictograms for non-readers + free text) -> on-device Small
// AI -> deterministic triage -> PII-free hashed payload -> SMS (real composer
// or demo gateway channel) -> fixed-template routing reply.
// No diagnosis. Low confidence => "Hin mirkanoofne — nama gaafadhu".

import React, { useState } from "react";
import {
  Linking, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View,
} from "react-native";
import * as SMS from "expo-sms";
import * as Speech from "expo-speech";

import { predictSymptoms } from "./src/lib/classifier";
import {
  ACTION_UI, BY_CODE, buildPayload, computeTier, MAX_SELECTED, parseReply,
  Reply, SYMPTOMS, Tier, TIER_UI,
} from "./src/lib/triage";

type Screen = "consent" | "select" | "confirm" | "reply";

const DEFAULT_GATEWAY_URL = "http://192.168.0.100:8000";
const DEFAULT_GATEWAY_PHONE = "+251900000000";
const LOC_ID = "OR-12"; // coarse location cell: village-level, never GPS

export default function App() {
  const [screen, setScreen] = useState<Screen>("consent");
  const [gatewayUrl, setGatewayUrl] = useState(DEFAULT_GATEWAY_URL);
  const [gatewayPhone, setGatewayPhone] = useState(DEFAULT_GATEWAY_PHONE);
  const [selected, setSelected] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [ambiguous, setAmbiguous] = useState(false);
  const [payload, setPayload] = useState("");
  const [reply, setReply] = useState<Reply | null>(null);
  const [sentViaRealSms, setSentViaRealSms] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const tier: Tier = ambiguous && selected.length === 0 ? "A" : computeTier(selected);

  const speak = (om: string, en: string) => {
    // Honest gap: few Android builds ship an Oromo TTS voice. Try `om`, else
    // read the English line. Pictograms + color remain the no-audio channel.
    Speech.stop();
    Speech.speak(om, { language: "om", onError: () => Speech.speak(en, { language: "en" }) });
  };

  const runClassifier = () => {
    const p = predictSymptoms(freeText);
    setAmbiguous(p.ambiguous);
    if (p.ambiguous && p.codes.length === 0) {
      setAiNote("🧑‍⚕️ Hin mirkanoofne — nama gaafadhu.\n(AI not sure — this will go to a person.)");
      return;
    }
    const merged = [...new Set([...selected, ...p.codes])].slice(0, MAX_SELECTED);
    setSelected(merged);
    setAiNote(
      (p.ambiguous ? "⚠️ Gartokko hin hubatamne — namni ilaala. (Partly unclear — a person will review.)\n" : "") +
      "AI hubate: " + p.codes.map(c => `${BY_CODE[c].emoji} ${BY_CODE[c].om}`).join(", ") +
      `  (sim ${p.confidence.toFixed(2)})`
    );
  };

  const toggle = (code: string) =>
    setSelected(s => s.includes(code) ? s.filter(c => c !== code)
      : s.length >= MAX_SELECTED ? s : [...s, code]);

  const goConfirm = async () => {
    const p = await buildPayload(selected, LOC_ID, tier);
    setPayload(p);
    setSendError(null);
    setScreen("confirm");
  };

  const sendRealSms = async () => {
    setSentViaRealSms(true);
    if (await SMS.isAvailableAsync()) {
      await SMS.sendSMSAsync([gatewayPhone], payload); // opens composer: user confirms, works with SIM only
      setReply(null);
      setScreen("reply");
    } else {
      setSendError("SMS composer not available on this device (emulator?). Use the demo channel.");
    }
  };

  const sendDemoChannel = async () => {
    setSentViaRealSms(false);
    setSendError(null);
    try {
      const res = await fetch(`${gatewayUrl}/gateway/sms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender: "demo-phone", body: payload }),
      });
      const data = await res.json();
      const r = parseReply(data.reply_sms);
      setReply(r);
      setScreen("reply");
      if (r) {
        const ui = ACTION_UI[r.action];
        if (ui) speak(ui.om, ui.en);
      }
    } catch {
      // store-and-forward spirit: payload stays; SMS path still works offline
      setSendError("Demo channel unreachable — payload kept. Use 'Ergi SMS' (works without internet).");
    }
  };

  const resetAll = () => {
    setSelected([]); setFreeText(""); setAiNote(null); setAmbiguous(false);
    setPayload(""); setReply(null); setSendError(null); setScreen("select");
  };

  // ------------------------------------------------------------- screens
  if (screen === "consent") {
    return (
      <Shell>
        <Text style={st.logo}>🏥 DoctorFind</Text>
        <Text style={st.subtitle}>Gargaarsa fayyaa — SMS qofaan{"\n"}(Health routing over SMS only)</Text>
        <Card>
          <Text style={st.h2}>Eeyyama (Consent)</Text>
          <Text style={st.body}>
            Appiin kun mallattoo dhukkubaa kee lakkoofsa iccitiidhaan (hash) gara buufata fayyaa
            ergiti. Maqaan kee, lakkoofsi kee, bakki kee sirriin HIN ergamu.{"\n\n"}
            Your symptoms are sent as an anonymous code. No name, no phone number, no exact
            location ever leaves this phone. A health worker makes the final decision.{"\n\n"}
            ⚠️ Appiin kun QORANNOO MITI — dhukkuba hin himu. (This app does NOT diagnose.)
          </Text>
        </Card>
        <Big color="#58d68d" onPress={() => { speak("Baga nagaan dhufte. Mallattoo kee filadhu.", "Welcome. Choose your symptoms."); setScreen("select"); }}>
          ✓ Eeyyee — ittan fufa{"\n"}(Yes — continue)
        </Big>
        <Card>
          <Text style={st.h2}>⚙ Demo settings</Text>
          <Text style={st.label}>Gateway URL (laptop LAN IP)</Text>
          <TextInput style={st.input} value={gatewayUrl} onChangeText={setGatewayUrl}
            autoCapitalize="none" autoCorrect={false} />
          <Text style={st.label}>Gateway SMS number</Text>
          <TextInput style={st.input} value={gatewayPhone} onChangeText={setGatewayPhone}
            autoCapitalize="none" autoCorrect={false} keyboardType="phone-pad" />
        </Card>
      </Shell>
    );
  }

  if (screen === "select") {
    return (
      <Shell>
        <Text style={st.h1}>Maal si dhukkuba?{"\n"}<Text style={st.en}>(What hurts?)</Text></Text>

        <Card>
          <Text style={st.label}>Barreessi ykn dubbadhu (type in Afaan Oromoo):</Text>
          <TextInput
            style={[st.input, { minHeight: 44 }]}
            placeholder='fkn: "mataan na dhukkuba fi qaamni na gubaa"'
            placeholderTextColor="#5a6a85"
            value={freeText} onChangeText={setFreeText} multiline
          />
          <Big small color="#4da3ff" onPress={runClassifier}>🤖 Hubadhu (AI: understand)</Big>
          {aiNote && <Text style={[st.body, { marginTop: 8 }]}>{aiNote}</Text>}
        </Card>

        <Text style={st.label}>
          ykn suuraa tuqi — hanga {MAX_SELECTED} (or tap pictures, up to {MAX_SELECTED}):
        </Text>
        <View style={st.grid}>
          {SYMPTOMS.map(s => {
            const on = selected.includes(s.code);
            return (
              <Pressable key={s.code} onPress={() => { toggle(s.code); speak(s.om, s.en); }}
                style={[st.cell, on && { borderColor: TIER_UI[String(s.severity) as Tier]?.color ?? "#4da3ff", backgroundColor: "#1d2b45" }]}>
                <Text style={st.emoji}>{s.emoji}</Text>
                <Text style={st.om}>{s.om}</Text>
                <Text style={st.enSmall}>{s.en}</Text>
              </Pressable>
            );
          })}
        </View>

        {(selected.length > 0 || (ambiguous && freeText)) && (
          <View style={[st.tierBar, { backgroundColor: TIER_UI[tier].color }]}>
            <Text style={st.tierText}>{TIER_UI[tier].om} · {TIER_UI[tier].label}</Text>
          </View>
        )}
        <Big color="#58d68d" disabled={selected.length === 0 && !(ambiguous && freeText)}
          onPress={goConfirm}>
          Itti fufi ▸ (Continue)
        </Big>
      </Shell>
    );
  }

  if (screen === "confirm") {
    return (
      <Shell>
        <Text style={st.h1}>Mirkaneessi <Text style={st.en}>(Confirm)</Text></Text>
        <Card>
          {selected.length === 0
            ? <Text style={st.body}>🧑‍⚕️ Hin mirkanoofne — namatu ilaala.{"\n"}(Unclear input — a person will review it.)</Text>
            : selected.map(c => (
              <Text key={c} style={st.confirmRow}>
                {BY_CODE[c].emoji}  {BY_CODE[c].om}  <Text style={st.enSmall}>({BY_CODE[c].en})</Text>
              </Text>
            ))}
          <View style={[st.tierBar, { backgroundColor: TIER_UI[tier].color, marginTop: 10 }]}>
            <Text style={st.tierText}>{TIER_UI[tier].om} · {TIER_UI[tier].label}</Text>
          </View>
        </Card>

        <Card>
          <Text style={st.h2}>📡 Ergaa SMS (≤160, PII hin qabu / no PII)</Text>
          <Text style={st.payload}>{payload}</Text>
          <Text style={st.enSmall}>
            Hash = symptom codes only. Name/phone/GPS never sent. Loc = village cell {LOC_ID}.
          </Text>
        </Card>

        <Big small color="#b48cff" onPress={() =>
          speak(
            "Mallattoo kee: " + selected.map(c => BY_CODE[c].om).join(", "),
            "Your symptoms: " + selected.map(c => BY_CODE[c].en).join(", ")
          )}>
          🔊 Dubbisi (Speak)
        </Big>
        <Big color="#58d68d" onPress={sendRealSms}>📨 Ergi — SMS dhugaa{"\n"}(Send via real SMS)</Big>
        <Big color="#4da3ff" onPress={sendDemoChannel}>🛰 Ergi — Demo channel{"\n"}(simulated SMS gateway)</Big>
        {sendError && <Text style={st.error}>{sendError}</Text>}
        <Big small color="#223052" onPress={() => setScreen("select")}>◂ Deebi'i (Back)</Big>
      </Shell>
    );
  }

  // reply screen
  const ui = reply ? ACTION_UI[reply.action] : null;
  return (
    <Shell>
      <Text style={st.h1}>Deebii <Text style={st.en}>(Reply)</Text></Text>
      {sentViaRealSms && !reply ? (
        <Card>
          <Text style={st.h2}>📨 SMS ergameera (SMS sent)</Text>
          <Text style={st.body}>
            Deebiin karaa SMS dhufa — appiin kun interneetii hin barbaadu.{"\n"}
            (The routing reply arrives as a normal SMS. No internet needed — this is the point.)
          </Text>
        </Card>
      ) : reply && ui ? (
        <>
          <View style={[st.replyCard, { borderColor: ui.color }]}>
            <Text style={st.replyIcon}>{ui.icon}</Text>
            <Text style={[st.replyAction, { color: ui.color }]}>{ui.om}</Text>
            <Text style={st.body}>{ui.en}</Text>
            <Text style={st.replyFacility}>{reply.name}</Text>
            <Pressable onPress={() => Linking.openURL(`tel:${reply.phone}`)}>
              <Text style={st.phone}>📞 {reply.phone} — tuqi bilbiluuf (tap to call)</Text>
            </Pressable>
          </View>
          <Big small color="#b48cff" onPress={() => speak(ui.om, ui.en)}>🔊 Irra deebi'i (Repeat)</Big>
          <Card>
            <Text style={st.enSmall}>Raw SMS: {`R:${reply.caseId};N:${reply.name};P:${reply.phone};A:${reply.action};M:${reply.message}`}</Text>
          </Card>
        </>
      ) : (
        <Card><Text style={st.body}>Deebiin hin jiru (no reply parsed).</Text></Card>
      )}
      <Big color="#223052" onPress={resetAll}>⟲ Kaasaa haaraa (New case)</Big>
    </Shell>
  );
}

// ------------------------------------------------------------- UI helpers
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <View style={st.root}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={st.scroll}>{children}</ScrollView>
    </View>
  );
}
function Card({ children }: { children: React.ReactNode }) {
  return <View style={st.card}>{children}</View>;
}
function Big({ children, onPress, color, disabled, small }: {
  children: React.ReactNode; onPress: () => void; color: string;
  disabled?: boolean; small?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled}
      style={({ pressed }) => [
        st.big, small && st.bigSmall,
        { backgroundColor: color, opacity: disabled ? 0.35 : pressed ? 0.8 : 1 },
      ]}>
      <Text style={[st.bigText, small && { fontSize: 15 }]}>{children}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0e1420" },
  scroll: { padding: 16, paddingTop: 52, paddingBottom: 40 },
  logo: { fontSize: 34, fontWeight: "800", color: "#e8edf6", textAlign: "center" },
  subtitle: { color: "#8b97ad", textAlign: "center", marginVertical: 10, fontSize: 15 },
  h1: { fontSize: 24, fontWeight: "800", color: "#e8edf6", marginBottom: 12 },
  h2: { fontSize: 16, fontWeight: "700", color: "#e8edf6", marginBottom: 6 },
  en: { color: "#8b97ad", fontSize: 16, fontWeight: "400" },
  enSmall: { color: "#8b97ad", fontSize: 11 },
  body: { color: "#cdd6e4", fontSize: 14, lineHeight: 20 },
  label: { color: "#8b97ad", fontSize: 13, marginBottom: 4, marginTop: 8 },
  input: {
    backgroundColor: "#171f2f", borderColor: "#263148", borderWidth: 1, borderRadius: 8,
    color: "#e8edf6", padding: 10, fontSize: 15,
  },
  card: {
    backgroundColor: "#171f2f", borderColor: "#263148", borderWidth: 1, borderRadius: 12,
    padding: 14, marginVertical: 8,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  cell: {
    width: "31%", backgroundColor: "#171f2f", borderColor: "#263148", borderWidth: 2,
    borderRadius: 12, alignItems: "center", paddingVertical: 10, paddingHorizontal: 4,
  },
  emoji: { fontSize: 30 },
  om: { color: "#e8edf6", fontSize: 12, fontWeight: "700", textAlign: "center", marginTop: 4 },
  tierBar: { borderRadius: 8, padding: 10, marginTop: 12 },
  tierText: { color: "#10131a", fontWeight: "800", textAlign: "center", fontSize: 15 },
  big: { borderRadius: 12, padding: 16, marginTop: 12 },
  bigSmall: { padding: 10, marginTop: 8 },
  bigText: { color: "#10131a", fontWeight: "800", fontSize: 18, textAlign: "center" },
  payload: {
    color: "#9fe8c8", fontFamily: "monospace", fontSize: 14, backgroundColor: "#0e1420",
    padding: 10, borderRadius: 8, marginVertical: 6,
  },
  confirmRow: { color: "#e8edf6", fontSize: 18, marginVertical: 3 },
  replyCard: {
    backgroundColor: "#171f2f", borderWidth: 3, borderRadius: 16, padding: 20,
    alignItems: "center", marginVertical: 10,
  },
  replyIcon: { fontSize: 52 },
  replyAction: { fontSize: 22, fontWeight: "900", textAlign: "center", marginVertical: 8 },
  replyFacility: { color: "#e8edf6", fontSize: 20, fontWeight: "700", marginTop: 10, textAlign: "center" },
  phone: { color: "#4da3ff", fontSize: 17, fontWeight: "700", marginTop: 8 },
  error: { color: "#ff5d5d", marginTop: 8, fontSize: 13 },
});
