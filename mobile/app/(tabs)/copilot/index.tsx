import { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { Audio } from 'expo-av';
import { useRouter } from 'expo-router';

import { Text, View } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { ApiError } from '@/lib/api';
import {
  createAsset,
  createWorkOrder,
  postAiCopilotTurn,
  postAiTranscribe,
  type CopilotTurnResult,
} from '@/lib/cmmsApi';
import {
  RNActivityIndicator,
  RNFlatList,
  RNPressable,
  RNTextInput,
  RNView,
} from '@/lib/rnJsx';

type ChatRow =
  | { kind: 'msg'; role: 'user' | 'assistant'; content: string }
  | { kind: 'confirm'; item: CopilotTurnResult['confirmable'][number] };

function strings(de: boolean) {
  return {
    noSite: de
      ? 'Kein Arbeitsstandort. Bitte erneut anmelden oder Standort wählen.'
      : 'No working site. Sign in again or pick a site.',
    placeholder: de
      ? 'Nachricht eingeben…'
      : 'Type a message…',
    send: de ? 'Senden' : 'Send',
    record: de ? 'Aufnehmen' : 'Record',
    stop: de ? 'Stopp & Transkript' : 'Stop & transcribe',
    confirmWo: de ? 'Arbeitsauftrag anlegen' : 'Create work order',
    confirmAsset: de ? 'Objekt anlegen' : 'Create asset',
    cancel: de ? 'Verwerfen' : 'Discard',
    busy: de ? 'Bitte warten…' : 'Please wait…',
    micDenied: de
      ? 'Mikrofonzugriff wird für die Aufnahme benötigt.'
      : 'Microphone permission is required to record.',
    txFail: de ? 'Transkription fehlgeschlagen' : 'Transcription failed',
    copilotFail: de ? 'Copilot-Anfrage fehlgeschlagen' : 'Copilot request failed',
    saveFail: de ? 'Speichern fehlgeschlagen' : 'Save failed',
  };
}

export default function CopilotScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const siteId = user?.working_site_id ?? null;
  const de = Boolean(
    user?.locale?.toLowerCase().startsWith('de'),
  );
  const S = useMemo(() => strings(de), [de]);
  const whisperLang = de ? 'de' : 'en';

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<
    { role: 'user' | 'assistant'; content: string }[]
  >([]);
  const [pending, setPending] = useState<CopilotTurnResult['confirmable']>([]);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);

  const listData: ChatRow[] = useMemo(() => {
    const rows: ChatRow[] = messages.map((m) => ({
      kind: 'msg' as const,
      role: m.role,
      content: m.content,
    }));
    for (const item of pending) {
      rows.push({ kind: 'confirm', item });
    }
    return rows;
  }, [messages, pending]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !siteId) return;
    const prior = messages;
    const nextMsgs = [...prior, { role: 'user' as const, content: text }];
    setMessages(nextMsgs);
    setInput('');
    setBusy(true);
    try {
      const res = await postAiCopilotTurn({ messages: nextMsgs });
      setMessages([...nextMsgs, res.message]);
      setPending(res.confirmable);
    } catch (e) {
      setMessages(prior);
      setInput(text);
      Alert.alert(
        'Kira',
        e instanceof ApiError ? e.message : S.copilotFail,
      );
    } finally {
      setBusy(false);
    }
  }, [input, siteId, messages, S.copilotFail]);

  const startRec = useCallback(async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Microphone', S.micDenied);
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      setRecording(rec);
    } catch (e) {
      Alert.alert(
        'Recording',
        e instanceof Error ? e.message : 'Failed to start',
      );
    }
  }, [S.micDenied]);

  const stopRec = useCallback(async () => {
    if (!recording) return;
    setBusy(true);
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      if (uri) {
        const { transcript } = await postAiTranscribe(uri, {
          language: whisperLang,
        });
        setInput((prev) => `${prev ? `${prev} ` : ''}${transcript}`.trim());
      }
    } catch (e) {
      Alert.alert(
        'Transcribe',
        e instanceof ApiError ? e.message : S.txFail,
      );
    } finally {
      setBusy(false);
    }
  }, [recording, whisperLang, S.txFail]);

  const onConfirm = useCallback(
    async (item: CopilotTurnResult['confirmable'][number]) => {
      setBusy(true);
      try {
        if (item.type === 'create_work_order') {
          await createWorkOrder(item.payload);
          setPending((p) => p.filter((x) => x.id !== item.id));
          router.push('/work-orders');
        } else {
          await createAsset(item.payload);
          setPending((p) => p.filter((x) => x.id !== item.id));
          router.push('/assets');
        }
      } catch (e) {
        Alert.alert(
          'Save',
          e instanceof ApiError ? e.message : S.saveFail,
        );
      } finally {
        setBusy(false);
      }
    },
    [router, S.saveFail],
  );

  const onDiscard = useCallback((id: string) => {
    setPending((p) => p.filter((x) => x.id !== id));
  }, []);

  if (!siteId) {
    return (
      <View style={styles.pad}>
        <Text>{S.noSite}</Text>
      </View>
    );
  }

  return (
    <RNView style={styles.root}>
      <RNFlatList
        data={listData}
        keyExtractor={(row, i) =>
          row.kind === 'msg' ? `m-${i}-${row.role}` : `c-${row.item.id}`
        }
        contentContainerStyle={styles.listPad}
        renderItem={({ item: row }) => {
          if (row.kind === 'msg') {
            return (
              <RNView
                style={[
                  styles.bubble,
                  row.role === 'user' ? styles.bubbleUser : styles.bubbleAsst,
                ]}>
                <Text
                  style={
                    row.role === 'user' ? styles.bubbleUserText : undefined
                  }>
                  {row.content}
                </Text>
              </RNView>
            );
          }
          const pl = JSON.stringify(row.item.payload, null, 2);
          return (
            <RNView style={styles.card}>
              <Text style={styles.cardTitle}>
                {row.item.type === 'create_work_order'
                  ? S.confirmWo
                  : S.confirmAsset}
              </Text>
              <Text selectable style={styles.cardBody}>
                {pl}
              </Text>
              <RNView style={styles.cardActions}>
                <RNPressable
                  style={styles.btnGhost}
                  onPress={() => onDiscard(row.item.id)}>
                  <Text>{S.cancel}</Text>
                </RNPressable>
                <RNPressable
                  style={styles.btnPrimary}
                  onPress={() => void onConfirm(row.item)}
                  disabled={busy}>
                  <Text style={styles.btnPrimaryText}>
                    {row.item.type === 'create_work_order'
                      ? S.confirmWo
                      : S.confirmAsset}
                  </Text>
                </RNPressable>
              </RNView>
            </RNView>
          );
        }}
      />
      {busy ? (
        <RNActivityIndicator style={styles.spin} />
      ) : null}
      <RNView style={styles.footer}>
        <RNTextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={S.placeholder}
          multiline
          editable={!busy}
        />
        <RNView style={styles.footerRow}>
          {!recording ? (
            <RNPressable style={styles.btnRec} onPress={() => void startRec()}>
              <Text style={styles.btnRecText}>{S.record}</Text>
            </RNPressable>
          ) : (
            <RNPressable
              style={styles.btnStop}
              onPress={() => void stopRec()}>
              <Text style={styles.btnRecText}>{S.stop}</Text>
            </RNPressable>
          )}
          <RNPressable
            style={styles.btnSend}
            onPress={() => void send()}
            disabled={busy || !input.trim()}>
            <Text style={styles.btnRecText}>{S.send}</Text>
          </RNPressable>
        </RNView>
      </RNView>
    </RNView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pad: { padding: 16 },
  listPad: { padding: 12, paddingBottom: 24, gap: 10 },
  bubble: {
    maxWidth: '92%',
    padding: 12,
    borderRadius: 12,
    marginBottom: 4,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: '#2563eb',
  },
  bubbleAsst: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(128,128,128,0.2)',
  },
  bubbleUserText: { color: '#fff' },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(128,128,128,0.45)',
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    gap: 8,
  },
  cardTitle: { fontWeight: '700', fontSize: 15 },
  cardBody: { fontSize: 12, fontFamily: 'monospace' },
  cardActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  btnGhost: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  btnPrimary: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#0f766e',
  },
  btnPrimaryText: { color: '#fff', fontWeight: '600' },
  spin: { marginVertical: 6 },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.35)',
    padding: 10,
    gap: 8,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(128,128,128,0.5)',
    borderRadius: 10,
    padding: 10,
    fontSize: 16,
    maxHeight: 120,
    textAlignVertical: 'top',
  },
  footerRow: { flexDirection: 'row', gap: 8 },
  btnRec: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#64748b',
  },
  btnStop: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#b91c1c',
  },
  btnSend: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#2563eb',
    alignItems: 'center',
  },
  btnRecText: { color: '#fff', fontWeight: '600' },
});
