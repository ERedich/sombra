import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';
import type { ListRenderItemInfo } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { Text, View } from '@/components/Themed';
import { ApiError } from '@/lib/api';
import { listNotifications, markNotificationsRead } from '@/lib/cmmsApi';
import type { NotificationRow } from '@/lib/cmmsTypes';
import {
  RNActivityIndicator,
  RNFlatList,
  RNPressable,
  RNRefreshControl,
} from '@/lib/rnJsx';

export default function NotificationsScreen() {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await listNotifications(168);
      setRows(data.notifications ?? []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load notifications.');
      setRows([]);
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

  async function onOpen(row: NotificationRow) {
    if (row.read_at) return;
    try {
      await markNotificationsRead([row.id]);
      setRows((prev) =>
        prev.map((n) =>
          n.id === row.id ? { ...n, read_at: new Date().toISOString() } : n,
        ),
      );
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : 'Could not mark notification read.',
      );
    }
  }

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
        keyExtractor={(item: NotificationRow) => item.id}
        refreshControl={
          <RNRefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={rows.length === 0 ? styles.emptyList : undefined}
        ListEmptyComponent={
          <Text style={styles.muted}>
            {error ? '' : 'No notifications in the last 7 days.'}
          </Text>
        }
        renderItem={({ item }: ListRenderItemInfo<NotificationRow>) => (
          <RNPressable
            style={({ pressed }: { pressed: boolean }) => [
              styles.row,
              !item.read_at && styles.rowUnread,
              pressed && styles.rowPressed,
            ]}
            onPress={() => void onOpen(item)}>
            <Text style={styles.rowMessage}>{item.message}</Text>
            <Text style={styles.rowMeta}>
              {item.kind} · {item.created_at?.replace('T', ' ').slice(0, 19)}
              {item.read_at ? '' : ' · Unread'}
            </Text>
          </RNPressable>
        )}
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
  rowUnread: { backgroundColor: 'rgba(37,99,235,0.06)' },
  rowPressed: { backgroundColor: 'rgba(37,99,235,0.12)' },
  rowMessage: { fontSize: 16, lineHeight: 22 },
  rowMeta: { fontSize: 12, opacity: 0.65, marginTop: 6 },
});
