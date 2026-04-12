import { useCallback, useLayoutEffect, useState } from 'react';
import { Alert, StyleSheet } from 'react-native';
import {
  useFocusEffect,
  useLocalSearchParams,
  useNavigation,
  useRouter,
} from 'expo-router';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

import { Text, View } from '@/components/Themed';
import {
  Checkbox,
  CheckboxIcon,
  CheckboxIndicator,
  CheckboxLabel,
} from '@/components/ui/checkbox';
import { WorkOrderStatusBadge } from '@/components/WorkOrderStatusBadge';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import Colors from '@/constants/Colors';
import { useWoAppSettings } from '@/context/WoAppSettingsContext';
import { ApiError } from '@/lib/api';
import {
  getWorkOrder,
  patchWorkOrderWorkInstruction,
  postWorkOrderFeedback,
  postWorkOrderHold,
  postWorkOrderStart,
} from '@/lib/cmmsApi';
import type { WorkInstructionDto, WorkOrderDetail } from '@/lib/cmmsTypes';
import { mergePatchedInstruction } from '@/lib/workInstructionMerge';
import {
  RNActivityIndicator,
  RNModal,
  RNPressable,
  RNScrollView,
  RNTextInput,
  RNView,
} from '@/lib/rnJsx';
import {
  ACTIVE_STATUSES,
  PLAY_STATUSES,
  workOrderCanStart,
  workOrderCanStopOrHold,
} from '@/lib/workOrderGating';

function startHint(
  user: { employee_id: string | null; employee_workgroup_ids: string[] },
  wo: WorkOrderDetail,
  startRequiresAssignment: boolean,
): string | null {
  if (!user.employee_id) {
    return startRequiresAssignment
      ? 'Link your user to an employee to start work.'
      : 'Link your user to an employee.';
  }
  const wgId = wo.workgroup_id?.trim() ?? '';
  const inWg =
    wgId.length === 0 || user.employee_workgroup_ids.includes(wgId);
  if (!inWg) {
    return 'Your employee must belong to this work order’s workgroup.';
  }
  if (
    startRequiresAssignment &&
    !(wo.assigned_employee_ids ?? []).includes(user.employee_id)
  ) {
    return 'You must be assigned to this work order to start it.';
  }
  return null;
}

function stopHint(
  user: { employee_id: string | null },
  wo: WorkOrderDetail,
  startRequiresAssignment: boolean,
): string | null {
  if (!user.employee_id) {
    return startRequiresAssignment
      ? 'Link your user to an employee.'
      : 'Link your user to an employee.';
  }
  if (
    startRequiresAssignment &&
    !(wo.assigned_employee_ids ?? []).includes(user.employee_id)
  ) {
    return 'You must be assigned to this work order.';
  }
  return null;
}

export default function WorkOrderDetailScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const navigation = useNavigation();
  const router = useRouter();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id =
    typeof rawId === 'string'
      ? rawId
      : Array.isArray(rawId)
        ? rawId[0] ?? ''
        : '';
  const { user } = useAuth();
  const woSettings = useWoAppSettings();

  const [wo, setWo] = useState<WorkOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [holdOpen, setHoldOpen] = useState(false);
  const [holdReason, setHoldReason] = useState('');

  const [fbOpen, setFbOpen] = useState(false);
  const [fbHours, setFbHours] = useState('0');
  const [fbText, setFbText] = useState('');
  type FbOutcome = 'none' | 'done' | 'on_hold';
  const [fbOutcome, setFbOutcome] = useState<FbOutcome>('none');
  const [fbHoldReason, setFbHoldReason] = useState('');
  const [togglingInstructionIds, setTogglingInstructionIds] = useState(
    () => new Set<string>(),
  );

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const data = await getWorkOrder(id);
      setWo(data.work_order);
    } catch (e) {
      setWo(null);
      setError(
        e instanceof ApiError ? e.message : 'Failed to load work order.',
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      if (!id) {
        setLoading(false);
        return;
      }
      if (!UUID_RE.test(id)) {
        setLoading(false);
        router.replace('..');
        return;
      }
      setLoading(true);
      void load();
    }, [id, load, router]),
  );

  useLayoutEffect(() => {
    if (wo) {
      navigation.setOptions({ title: `WO-${wo.wo_key}` });
    }
  }, [navigation, wo]);

  const canStart =
    wo &&
    user &&
    PLAY_STATUSES.has(wo.status) &&
    workOrderCanStart(
      wo,
      user.employee_id,
      user.employee_workgroup_ids,
      woSettings.start_requires_assignment,
    );

  const canStopHold =
    wo &&
    user &&
    ACTIVE_STATUSES.has(wo.status) &&
    workOrderCanStopOrHold(
      wo,
      user.employee_id,
      woSettings.start_requires_assignment,
    );

  const startBlockReason =
    wo && user && PLAY_STATUSES.has(wo.status)
      ? startHint(user, wo, woSettings.start_requires_assignment)
      : null;

  const stopBlockReason =
    wo && user && ACTIVE_STATUSES.has(wo.status)
      ? stopHint(user, wo, woSettings.start_requires_assignment)
      : null;

  async function onStart() {
    if (!wo || !canStart || busy) return;
    setBusy(true);
    try {
      const data = await postWorkOrderStart(wo.id);
      setWo(data.work_order);
    } catch (e) {
      Alert.alert(
        'Start failed',
        e instanceof ApiError ? e.message : 'Unknown error',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitHold() {
    if (!wo || busy) return;
    const r = holdReason.trim();
    if (!r) {
      Alert.alert('Hold', 'Please enter a reason.');
      return;
    }
    setBusy(true);
    try {
      const data = await postWorkOrderHold(wo.id, r);
      setWo(data.work_order);
      setHoldOpen(false);
      setHoldReason('');
    } catch (e) {
      Alert.alert(
        'Hold failed',
        e instanceof ApiError ? e.message : 'Unknown error',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitFeedback() {
    if (!wo || !user?.employee_id || busy) return;
    const hours = Number(fbHours);
    if (!Number.isFinite(hours) || hours < 0) {
      Alert.alert('Feedback', 'Hours must be a non-negative number.');
      return;
    }
    const text = fbText.trim();
    if (text === '' && hours <= 0) {
      Alert.alert(
        'Feedback',
        'Enter feedback text or hours greater than zero.',
      );
      return;
    }
    if (fbOutcome === 'on_hold') {
      const hr = fbHoldReason.trim();
      if (!hr) {
        Alert.alert('Feedback', 'Hold reason is required to put on hold.');
        return;
      }
    }

    const wiList = wo.work_instructions ?? [];
    if (
      fbOutcome === 'done' &&
      wiList.length > 0 &&
      !wiList.every((w) => w.done)
    ) {
      Alert.alert(
        'Work instructions',
        'Complete all work instructions before marking this work order done.',
      );
      return;
    }

    const payload: Parameters<typeof postWorkOrderFeedback>[1] = {
      entries: [
        {
          employee_id: user.employee_id,
          feedback_text: text,
          hours,
        },
      ],
    };
    if (fbOutcome === 'done') payload.target_status = 'done';
    else if (fbOutcome === 'on_hold') {
      payload.target_status = 'on_hold';
      payload.hold_reason = fbHoldReason.trim();
    }

    setBusy(true);
    try {
      const data = await postWorkOrderFeedback(wo.id, payload);
      setWo(data.work_order);
      setFbOpen(false);
      setFbHours('0');
      setFbText('');
      setFbOutcome('none');
      setFbHoldReason('');
    } catch (e) {
      Alert.alert(
        'Feedback failed',
        e instanceof ApiError ? e.message : 'Unknown error',
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggleWorkInstruction(wi: WorkInstructionDto) {
    if (!wo || togglingInstructionIds.has(wi.id) || busy) return;
    setTogglingInstructionIds((prev) => new Set(prev).add(wi.id));
    try {
      const data = await patchWorkOrderWorkInstruction(wo.id, wi.id, {
        done: !wi.done,
      });
      setWo((prev) =>
        prev ? mergePatchedInstruction(prev, data.work_instruction) : null,
      );
    } catch (e) {
      Alert.alert(
        'Instruction',
        e instanceof ApiError ? e.message : 'Could not update instruction.',
      );
    } finally {
      setTogglingInstructionIds((prev) => {
        const next = new Set(prev);
        next.delete(wi.id);
        return next;
      });
    }
  }

  if (loading || !id) {
    return (
      <View style={styles.centered}>
        <RNActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (error || !wo) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error ?? 'Not found.'}</Text>
      </View>
    );
  }

  return (
    <RNView style={styles.flex}>
      <RNScrollView contentContainerStyle={styles.scroll}>
        <RNView style={styles.statusRow}>
          <Text style={styles.statusLabel}>Status</Text>
          <WorkOrderStatusBadge status={wo.status} />
        </RNView>
        <Text style={styles.block}>{wo.short_text}</Text>
        <Text style={styles.meta}>
          {wo.site_key} · {wo.asset_key} {wo.asset_name}
        </Text>
        <Text style={styles.meta}>
          {wo.work_type_key} · {wo.workgroup_name}
        </Text>
        {wo.hold_reason ? (
          <Text style={styles.hold}>On hold: {wo.hold_reason}</Text>
        ) : null}

        {wo.instruction_text ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Instructions</Text>
            <Text style={styles.block}>{wo.instruction_text}</Text>
          </View>
        ) : null}

        {wo.work_instructions?.length ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Work instructions</Text>
            <Text style={styles.wiHint}>
              Use the checkboxes to mark each step done.
            </Text>
            {[...wo.work_instructions]
              .sort((a, b) => a.sort_nr - b.sort_nr)
              .map((wi) => {
                const toggling = togglingInstructionIds.has(wi.id);
                return (
                  <RNView
                    key={wi.id}
                    style={[
                      styles.wiRow,
                      (busy || toggling) && styles.wiRowDisabled,
                    ]}>
                    <Checkbox
                      value={wi.id}
                      isChecked={wi.done}
                      isDisabled={busy || toggling}
                      onChange={() => void toggleWorkInstruction(wi)}
                      className="flex-1">
                      <CheckboxIndicator>
                        <CheckboxIcon />
                      </CheckboxIndicator>
                      <CheckboxLabel>{wi.instruction_text}</CheckboxLabel>
                    </Checkbox>
                    {toggling ? (
                      <RNActivityIndicator
                        size="small"
                        color="#2563eb"
                        style={styles.wiSpinner}
                      />
                    ) : null}
                  </RNView>
                );
              })}
          </View>
        ) : null}

        <View style={styles.actions}>
          {PLAY_STATUSES.has(wo.status) ? (
            <>
              <RNPressable
                style={[styles.btn, styles.btnPrimary, !canStart && styles.btnDisabled]}
                disabled={!canStart || busy}
                onPress={() => void onStart()}>
                <Text
                  style={[
                    styles.btnPrimaryText,
                    !canStart && styles.btnTextDisabled,
                  ]}>
                  Start work
                </Text>
              </RNPressable>
              {startBlockReason ? (
                <Text style={styles.hint}>{startBlockReason}</Text>
              ) : null}
            </>
          ) : null}

          {ACTIVE_STATUSES.has(wo.status) ? (
            <>
              <RNPressable
                style={[styles.btn, styles.btnHold, !canStopHold && styles.btnDisabled]}
                disabled={!canStopHold || busy}
                onPress={() => {
                  if (!canStopHold) return;
                  setHoldOpen(true);
                }}>
                <Text
                  style={[styles.btnHoldText, !canStopHold && styles.btnTextDisabled]}>
                  Put on hold
                </Text>
              </RNPressable>
              <RNPressable
                style={[
                  styles.btn,
                  styles.btnSecondary,
                  !canStopHold && styles.btnDisabled,
                ]}
                disabled={!canStopHold || busy}
                onPress={() => {
                  if (!canStopHold) return;
                  setFbOpen(true);
                }}>
                <Text
                  style={[
                    styles.btnSecondaryText,
                    !canStopHold && styles.btnTextDisabled,
                  ]}>
                  Feedback / complete
                </Text>
              </RNPressable>
              {stopBlockReason ? (
                <Text style={styles.hint}>{stopBlockReason}</Text>
              ) : null}
            </>
          ) : null}
        </View>
      </RNScrollView>

      <RNModal visible={holdOpen} transparent animationType="fade">
        <RNView style={styles.modalBackdrop}>
          <RNView
            style={[
              styles.modalCard,
              { backgroundColor: palette.background },
            ]}>
            <Text style={styles.modalTitle}>Put on hold</Text>
            <RNTextInput
              style={[
                styles.input,
                { color: palette.text, borderColor: palette.tabIconDefault },
              ]}
              placeholder="Reason (required)"
              placeholderTextColor="#888"
              value={holdReason}
              onChangeText={setHoldReason}
              multiline
            />
            <RNView style={styles.modalRow}>
              <RNPressable
                style={styles.modalBtnGhost}
                onPress={() => {
                  setHoldOpen(false);
                  setHoldReason('');
                }}>
                <Text>Cancel</Text>
              </RNPressable>
              <RNPressable
                style={styles.modalBtnPrimary}
                onPress={() => void submitHold()}
                disabled={busy}>
                <Text style={styles.btnPrimaryText}>Submit</Text>
              </RNPressable>
            </RNView>
          </RNView>
        </RNView>
      </RNModal>

      <RNModal visible={fbOpen} transparent animationType="fade">
        <RNView style={styles.modalBackdrop}>
          <RNScrollView contentContainerStyle={styles.modalScroll}>
            <RNView
              style={[
                styles.modalCard,
                { backgroundColor: palette.background },
              ]}>
              <Text style={styles.modalTitle}>Feedback</Text>
              <Text style={styles.label}>Hours</Text>
              <RNTextInput
                style={[
                  styles.input,
                  { color: palette.text, borderColor: palette.tabIconDefault },
                ]}
                keyboardType="decimal-pad"
                value={fbHours}
                onChangeText={setFbHours}
              />
              <Text style={styles.label}>Notes</Text>
              <RNTextInput
                style={[
                  styles.input,
                  styles.inputTall,
                  { color: palette.text, borderColor: palette.tabIconDefault },
                ]}
                placeholder="Feedback text"
                placeholderTextColor="#888"
                value={fbText}
                onChangeText={setFbText}
                multiline
              />
              <Text style={styles.label}>After saving</Text>
              <RNView style={styles.seg}>
                {(
                  [
                    ['none', 'Log only'],
                    ['done', 'Mark done'],
                    ['on_hold', 'Put on hold'],
                  ] as const
                ).map(([key, label]) => (
                  <RNPressable
                    key={key}
                    style={[
                      styles.segItem,
                      fbOutcome === key && styles.segItemOn,
                    ]}
                    onPress={() => setFbOutcome(key)}>
                    <Text
                      style={
                        fbOutcome === key ? styles.segItemTextOn : undefined
                      }>
                      {label}
                    </Text>
                  </RNPressable>
                ))}
              </RNView>
              {fbOutcome === 'on_hold' ? (
                <>
                  <Text style={styles.label}>Hold reason</Text>
                  <RNTextInput
                    style={[
                      styles.input,
                      { color: palette.text, borderColor: palette.tabIconDefault },
                    ]}
                    placeholder="Required for on hold"
                    placeholderTextColor="#888"
                    value={fbHoldReason}
                    onChangeText={setFbHoldReason}
                    multiline
                  />
                </>
              ) : null}
              <RNView style={styles.modalRow}>
                <RNPressable
                  style={styles.modalBtnGhost}
                  onPress={() => {
                    setFbOpen(false);
                    setFbHours('0');
                    setFbText('');
                    setFbOutcome('none');
                    setFbHoldReason('');
                  }}>
                  <Text>Cancel</Text>
                </RNPressable>
                <RNPressable
                  style={styles.modalBtnPrimary}
                  onPress={() => void submitFeedback()}
                  disabled={busy}>
                  <Text style={styles.btnPrimaryText}>Submit</Text>
                </RNPressable>
              </RNView>
            </RNView>
          </RNScrollView>
        </RNView>
      </RNModal>
    </RNView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  scroll: { padding: 16, paddingBottom: 40 },
  errorText: { color: '#b91c1c', textAlign: 'center' },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 12,
  },
  statusLabel: { fontSize: 14, opacity: 0.8 },
  block: { fontSize: 17, lineHeight: 24 },
  meta: { fontSize: 14, opacity: 0.75, marginTop: 6 },
  hold: {
    marginTop: 12,
    color: '#b45309',
    fontSize: 15,
  },
  section: { marginTop: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '600', marginBottom: 8 },
  wiHint: { fontSize: 13, opacity: 0.7, marginBottom: 10 },
  wiRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(128,128,128,0.35)',
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 8,
  },
  wiRowDisabled: { opacity: 0.55 },
  wiSpinner: { marginTop: 4, width: 28 },
  actions: { marginTop: 28, gap: 12 },
  btn: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnPrimary: { backgroundColor: '#2563eb' },
  btnPrimaryText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  btnHold: { backgroundColor: '#f59e0b' },
  btnHoldText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  btnSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#2563eb',
  },
  btnSecondaryText: { color: '#2563eb', fontWeight: '600', fontSize: 16 },
  btnDisabled: { opacity: 0.45 },
  btnTextDisabled: { opacity: 0.9 },
  hint: { fontSize: 13, opacity: 0.75, marginTop: -4 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  modalScroll: { flexGrow: 1, justifyContent: 'center' },
  modalCard: {
    borderRadius: 12,
    padding: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 6, marginTop: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 16,
  },
  inputTall: { minHeight: 80, textAlignVertical: 'top' },
  modalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 16,
  },
  modalBtnGhost: { padding: 12 },
  modalBtnPrimary: {
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  seg: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  segItem: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  segItemOn: { backgroundColor: '#dbeafe', borderColor: '#2563eb' },
  segItemTextOn: { color: '#1d4ed8', fontWeight: '600' },
});
