import { useEffect, useState } from 'react';
import { Alert, StyleSheet } from 'react-native';

import type { WorkOrderAssignmentIconKind } from '@/components/WorkOrderAssignmentsIcons';
import { Text } from '@/components/Themed';
import {
  Checkbox,
  CheckboxIcon,
  CheckboxIndicator,
  CheckboxLabel,
} from '@/components/ui/checkbox';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { ApiError } from '@/lib/api';
import {
  getWorkOrder,
  listWorkOrderAssignedEmployees,
  patchWorkOrderWorkInstruction,
  postWorkOrderSubscriptionsBulk,
} from '@/lib/cmmsApi';
import type {
  WorkInstructionDto,
  WorkOrderDetail,
  WorkOrderRow,
} from '@/lib/cmmsTypes';
import { mergePatchedInstruction } from '@/lib/workInstructionMerge';
import {
  RNActivityIndicator,
  RNModal,
  RNPressable,
  RNScrollView,
  RNText,
  RNView,
} from '@/lib/rnJsx';

type Props = {
  visible: boolean;
  kind: WorkOrderAssignmentIconKind | null;
  row: WorkOrderRow | null;
  isSubscribed: boolean;
  onClose: () => void;
  /** Called after a successful subscribe/unsubscribe so the list can refresh the bell. */
  onSubscriptionChanged?: (workOrderId: string, subscribed: boolean) => void;
  /** After toggling a work instruction `done` flag (list row progress). */
  onInstructionProgressChanged?: (
    workOrderId: string,
    doneCount: number,
    total: number,
  ) => void;
};

function titleForKind(kind: WorkOrderAssignmentIconKind): string {
  switch (kind) {
    case 'material':
      return 'Material assignment';
    case 'employee':
      return 'Assigned employees';
    case 'instructions':
      return 'Work instructions';
    case 'notification':
      return 'Notifications';
    default:
      return '';
  }
}

export function WorkOrderAssignmentInfoModal({
  visible,
  kind,
  row,
  isSubscribed,
  onClose,
  onSubscriptionChanged,
  onInstructionProgressChanged,
}: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkOrderDetail | null>(null);
  const [employees, setEmployees] = useState<
    { employee_id: string; employee_key: string; employee_name: string }[]
  >([]);
  const [subscriptionBusy, setSubscriptionBusy] = useState(false);
  const [togglingInstructionId, setTogglingInstructionId] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!visible || !row || !kind) {
      setLoadError(null);
      setDetail(null);
      setEmployees([]);
      setLoading(false);
      setTogglingInstructionId(null);
      return;
    }

    if (kind === 'material' || kind === 'notification') {
      setLoading(false);
      setLoadError(null);
      setDetail(null);
      setEmployees([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setDetail(null);
    setEmployees([]);

    void (async () => {
      try {
        if (kind === 'instructions') {
          const data = await getWorkOrder(row.id);
          if (!cancelled) setDetail(data.work_order);
        } else if (kind === 'employee') {
          const data = await listWorkOrderAssignedEmployees(row.id);
          if (!cancelled) setEmployees(data.employees ?? []);
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(
            e instanceof ApiError ? e.message : 'Failed to load.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, kind, row?.id]);

  async function toggleInstructionInModal(wi: WorkInstructionDto) {
    if (!row || togglingInstructionId) return;
    setTogglingInstructionId(wi.id);
    try {
      const data = await patchWorkOrderWorkInstruction(row.id, wi.id, {
        done: !wi.done,
      });
      setDetail((prev) => {
        if (!prev) return prev;
        const next = mergePatchedInstruction(prev, data.work_instruction);
        onInstructionProgressChanged?.(
          row.id,
          next.work_instruction_done_count ?? 0,
          next.work_instructions?.length ?? 0,
        );
        return next;
      });
    } catch (e) {
      Alert.alert(
        'Instruction',
        e instanceof ApiError ? e.message : 'Could not update instruction.',
      );
    } finally {
      setTogglingInstructionId(null);
    }
  }

  if (!visible || !row || !kind) {
    return null;
  }

  async function onSubscribePress() {
    const wo = row;
    if (!wo) return;
    setSubscriptionBusy(true);
    try {
      await postWorkOrderSubscriptionsBulk('subscribe', [wo.id]);
      onSubscriptionChanged?.(wo.id, true);
      onClose();
    } catch (e) {
      Alert.alert(
        'Subscription',
        e instanceof ApiError ? e.message : 'Failed to subscribe.',
      );
    } finally {
      setSubscriptionBusy(false);
    }
  }

  async function onUnsubscribePress() {
    const wo = row;
    if (!wo) return;
    setSubscriptionBusy(true);
    try {
      await postWorkOrderSubscriptionsBulk('unsubscribe', [wo.id]);
      onSubscriptionChanged?.(wo.id, false);
      onClose();
    } catch (e) {
      Alert.alert(
        'Subscription',
        e instanceof ApiError ? e.message : 'Failed to unsubscribe.',
      );
    } finally {
      setSubscriptionBusy(false);
    }
  }

  function renderBody() {
    if (!row) return null;
    if (kind === 'material') {
      const has = row.has_material_assignment === true;
      return (
        <RNText style={[styles.bodyText, { color: palette.text }]}>
          {has
            ? 'A material assignment is linked to this work order.'
            : 'No material assignment is linked to this work order. (Material linking is not available on mobile yet.)'}
        </RNText>
      );
    }

    if (kind === 'notification') {
      return (
        <RNView style={styles.notificationBlock}>
          <RNText style={[styles.bodyText, { color: palette.text }]}>
            {isSubscribed
              ? 'You are subscribed to notifications for this work order. You will see updates in the Notifications tab when events occur.'
              : 'Subscribe to receive notifications when this work order is updated.'}
          </RNText>
          {isSubscribed ? (
            <RNPressable
              style={[styles.actionBtn, styles.actionBtnDanger]}
              disabled={subscriptionBusy}
              onPress={() => void onUnsubscribePress()}>
              {subscriptionBusy ? (
                <RNActivityIndicator color="#fff" />
              ) : (
                <RNText style={styles.actionBtnDangerText}>Unsubscribe</RNText>
              )}
            </RNPressable>
          ) : (
            <RNPressable
              style={[styles.actionBtn, styles.actionBtnPrimary]}
              disabled={subscriptionBusy}
              onPress={() => void onSubscribePress()}>
              {subscriptionBusy ? (
                <RNActivityIndicator color="#fff" />
              ) : (
                <RNText style={styles.actionBtnPrimaryText}>Subscribe</RNText>
              )}
            </RNPressable>
          )}
        </RNView>
      );
    }

    if (loading) {
      return (
        <RNView style={styles.centeredPad}>
          <RNActivityIndicator size="large" color="#2563eb" />
        </RNView>
      );
    }

    if (loadError) {
      return (
        <RNText style={[styles.errorText, { color: '#b91c1c' }]}>
          {loadError}
        </RNText>
      );
    }

    if (kind === 'employee') {
      if (employees.length === 0) {
        return (
          <RNText style={[styles.bodyText, { color: palette.text }]}>
            No employees are assigned to this work order.
          </RNText>
        );
      }
      return (
        <RNView style={styles.listBlock}>
          {employees.map((e) => (
            <RNView key={e.employee_id} style={styles.listItem}>
              <RNText style={[styles.empKey, { color: palette.text }]}>
                {e.employee_key}
              </RNText>
              <RNText style={[styles.empName, { color: palette.text }]}>
                {e.employee_name}
              </RNText>
            </RNView>
          ))}
        </RNView>
      );
    }

    if (kind === 'instructions') {
      const list = detail?.work_instructions ?? [];
      if (list.length === 0) {
        return (
          <RNText style={[styles.bodyText, { color: palette.text }]}>
            No structured work instructions. See the work order detail screen
            for general instructions if any.
          </RNText>
        );
      }
      return (
        <RNView style={styles.listBlock}>
          <RNText
            style={[styles.instructionHint, { color: palette.text }]}>
            Use the checkboxes to mark each step done.
          </RNText>
          {[...list]
            .sort((a, b) => a.sort_nr - b.sort_nr)
            .map((wi) => {
              const toggling = togglingInstructionId === wi.id;
              const otherBusy =
                togglingInstructionId != null && togglingInstructionId !== wi.id;
              return (
                <RNView
                  key={wi.id}
                  style={[
                    styles.instructionRow,
                    otherBusy && styles.instructionRowDisabled,
                  ]}>
                  <Checkbox
                    value={wi.id}
                    isChecked={wi.done}
                    isDisabled={!!togglingInstructionId}
                    onChange={() => void toggleInstructionInModal(wi)}
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
                      style={styles.instructionSpinner}
                    />
                  ) : null}
                </RNView>
              );
            })}
        </RNView>
      );
    }

    return null;
  }

  return (
    <RNModal visible={visible} transparent animationType="fade">
      <RNView style={styles.backdrop}>
        <RNView
          style={[styles.card, { backgroundColor: palette.background }]}>
          <Text style={styles.modalTitle}>{titleForKind(kind)}</Text>
          <RNText
            style={[styles.subtitle, { color: palette.text, opacity: 0.75 }]}>
            WO-{row.wo_key} · {row.short_text}
          </RNText>
          <RNScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled">
            {renderBody()}
          </RNScrollView>
          <RNPressable style={styles.closeBtn} onPress={onClose}>
            <RNText style={[styles.closeBtnText, { color: '#2563eb' }]}>
              Close
            </RNText>
          </RNPressable>
        </RNView>
      </RNView>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    borderRadius: 12,
    padding: 16,
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    marginBottom: 12,
  },
  scroll: { maxHeight: 360 },
  scrollContent: { paddingBottom: 8 },
  bodyText: { fontSize: 16, lineHeight: 22 },
  centeredPad: { paddingVertical: 24, alignItems: 'center' },
  errorText: { fontSize: 15 },
  listBlock: { gap: 12 },
  listItem: { marginBottom: 4 },
  empKey: { fontSize: 15, fontWeight: '600' },
  empName: { fontSize: 14, opacity: 0.85, marginTop: 2 },
  instructionHint: { fontSize: 13, opacity: 0.75, marginBottom: 4 },
  instructionRow: {
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
  instructionRowDisabled: { opacity: 0.5 },
  instructionSpinner: { marginTop: 4, width: 28 },
  notificationBlock: { gap: 16 },
  actionBtn: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  actionBtnPrimary: { backgroundColor: '#2563eb' },
  actionBtnPrimaryText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  actionBtnDanger: { backgroundColor: '#dc2626' },
  actionBtnDangerText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  closeBtn: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  closeBtnText: { fontSize: 16, fontWeight: '600' },
});
