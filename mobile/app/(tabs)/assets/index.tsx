import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';
import type { ListRenderItemInfo } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Text, View } from '@/components/Themed';
import { ApiError } from '@/lib/api';
import { listAssets } from '@/lib/cmmsApi';
import type { AssetRow } from '@/lib/cmmsTypes';
import {
  RNActivityIndicator,
  RNFlatList,
  RNPressable,
  RNRefreshControl,
} from '@/lib/rnJsx';

export default function AssetsListScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await listAssets();
      setRows(data.assets ?? []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load assets.');
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
        keyExtractor={(item: AssetRow) => item.id}
        refreshControl={
          <RNRefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={rows.length === 0 ? styles.emptyList : undefined}
        ListEmptyComponent={
          <Text style={styles.muted}>
            {error ? '' : 'No assets for your sites.'}
          </Text>
        }
        renderItem={({ item }: ListRenderItemInfo<AssetRow>) => (
          <RNPressable
            style={({ pressed }: { pressed: boolean }) => [
              styles.row,
              pressed && styles.rowPressed,
            ]}
            onPress={() =>
              router.push({
                pathname: '/assets/[id]',
                params: { id: item.id },
              })
            }>
            <Text style={styles.rowTitle}>
              {item.key}
              <Text style={styles.rowMeta}> · {item.asset_type}</Text>
            </Text>
            <Text style={styles.rowSub} numberOfLines={2}>
              {item.name}
            </Text>
            <Text style={styles.rowFoot} numberOfLines={1}>
              {item.site_key}
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
  rowPressed: { backgroundColor: 'rgba(37,99,235,0.08)' },
  rowTitle: { fontSize: 17, fontWeight: '600' },
  rowMeta: { fontWeight: '400', opacity: 0.75 },
  rowSub: { marginTop: 4, fontSize: 15 },
  rowFoot: { marginTop: 6, fontSize: 13, opacity: 0.65 },
});
