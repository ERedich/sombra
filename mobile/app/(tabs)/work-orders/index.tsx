import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';
import type { ListRenderItemInfo } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { WorkOrderAssignmentInfoModal } from '@/components/WorkOrderAssignmentInfoModal';
import {
  WorkOrderAssignmentsIcons,
  type WorkOrderAssignmentIconKind,
} from '@/components/WorkOrderAssignmentsIcons';
import { WorkOrderStatusBadge } from '@/components/WorkOrderStatusBadge';
import { Text, View } from '@/components/Themed';
import { ApiError } from '@/lib/api';
import {
  listWorkOrders,
  listWorkOrderSubscriptions,
} from '@/lib/cmmsApi';
import type { WorkOrderRow } from '@/lib/cmmsTypes';
import {
  RNActivityIndicator,
  RNFlatList,
  RNPressable,
  RNRefreshControl,
  RNView,
} from '@/lib/rnJsx';

export default function WorkOrdersListScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<WorkOrderRow[]>([]);
  const [subscribedIds, setSubscribedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignmentModal, setAssignmentModal] = useState<{
    kind: WorkOrderAssignmentIconKind;
    row: WorkOrderRow;
  } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await listWorkOrders();
      setRows(data.work_orders ?? []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load work orders.');
      setRows([]);
    }
    try {
      const sub = await listWorkOrderSubscriptions();
      setSubscribedIds(new Set(sub.work_order_ids ?? []));
    } catch {
      setSubscribedIds(new Set());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  const handleAssignmentIconPress = useCallback(
    (item: WorkOrderRow, kind: WorkOrderAssignmentIconKind) => {
      setAssignmentModal({ kind, row: item });
    },
    [],
  );

  const handleInstructionProgressChanged = useCallback(
    (workOrderId: string, doneCount: number, _total: number) => {
      setRows((prev) =>
        prev.map((r) =>
          r.id === workOrderId
            ? { ...r, work_instruction_done_count: doneCount }
            : r,
        ),
      );
    },
    [],
  );

  if (loading && rows.length === 0) {
    return (
      <View style={styles.centered}>
        <RNActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : null}
      <RNFlatList
        data={rows}
        keyExtractor={(item: WorkOrderRow) => item.id}
        refreshControl={
          <RNRefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={rows.length === 0 ? styles.emptyList : undefined}
        ListEmptyComponent={
          <Text style={styles.muted}>
            {error ? '' : 'No work orders for your sites.'}
          </Text>
        }
        renderItem={({ item }: ListRenderItemInfo<WorkOrderRow>) => (
          <RNPressable
            style={({ pressed }: { pressed: boolean }) => [
              styles.row,
              pressed && styles.rowPressed,
            ]}
            onPress={() =>
              router.push({
                pathname: '/work-orders/[id]',
                params: { id: item.id },
              })
            }>
            <RNView style={styles.rowTitleRow}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                WO-{item.wo_key}
              </Text>
              <WorkOrderStatusBadge status={item.status} />
            </RNView>
            <RNView style={styles.assignmentsRow}>
              <WorkOrderAssignmentsIcons
                row={{
                  has_material_assignment: item.has_material_assignment,
                  has_employee_assignment: item.has_employee_assignment,
                  work_instruction_count: item.work_instruction_count,
                  work_instruction_done_count: item.work_instruction_done_count,
                  has_notification_assignment: subscribedIds.has(item.id),
                }}
                showNotificationIcon
                onPress={(kind) => handleAssignmentIconPress(item, kind)}
              />
            </RNView>
            <Text style={styles.rowSub} numberOfLines={2}>
              {item.short_text}
            </Text>
            <Text style={styles.rowFoot} numberOfLines={1}>
              {item.site_key} · {item.asset_name}
            </Text>
          </RNPressable>
        )}
      />
      <WorkOrderAssignmentInfoModal
        visible={assignmentModal !== null}
        kind={assignmentModal?.kind ?? null}
        row={assignmentModal?.row ?? null}
        isSubscribed={
          assignmentModal
            ? subscribedIds.has(assignmentModal.row.id)
            : false
        }
        onClose={() => setAssignmentModal(null)}
        onSubscriptionChanged={(woId, subscribed) => {
          setSubscribedIds((prev) => {
            const next = new Set(prev);
            if (subscribed) next.add(woId);
            else next.delete(woId);
            return next;
          });
        }}
        onInstructionProgressChanged={handleInstructionProgressChanged}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: '#b91c1c',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  muted: { padding: 24, textAlign: 'center', opacity: 0.7 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  row: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.35)',
  },
  rowPressed: { backgroundColor: 'rgba(37,99,235,0.08)' },
  rowTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowTitle: { flex: 1, flexShrink: 1, fontSize: 17, fontWeight: '600' },
  assignmentsRow: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  rowSub: { marginTop: 4, fontSize: 15 },
  rowFoot: { marginTop: 6, fontSize: 13, opacity: 0.65 },
});
