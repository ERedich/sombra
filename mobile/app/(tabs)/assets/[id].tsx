import { useCallback, useLayoutEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import {
  useFocusEffect,
  useLocalSearchParams,
  useNavigation,
  useRouter,
} from 'expo-router';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

import { Text, View } from '@/components/Themed';
import { ApiError } from '@/lib/api';
import { getAsset } from '@/lib/cmmsApi';
import type { AssetRow } from '@/lib/cmmsTypes';
import { RNActivityIndicator, RNScrollView } from '@/lib/rnJsx';

function field(label: string, value: string | null | undefined | number) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <Text style={styles.line}>
      <Text style={styles.label}>{label}: </Text>
      {String(value)}
    </Text>
  );
}

export default function AssetDetailScreen() {
  const navigation = useNavigation();
  const router = useRouter();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id =
    typeof rawId === 'string'
      ? rawId
      : Array.isArray(rawId)
        ? rawId[0] ?? ''
        : '';

  const [row, setRow] = useState<AssetRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const data = await getAsset(id);
      setRow(data.asset);
    } catch (e) {
      setRow(null);
      setError(e instanceof ApiError ? e.message : 'Failed to load asset.');
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
    if (row) {
      navigation.setOptions({ title: row.key });
    }
  }, [navigation, row]);

  if (loading || !id) {
    return (
      <View style={styles.centered}>
        <RNActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (error || !row) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error ?? 'Not found.'}</Text>
      </View>
    );
  }

  return (
    <RNScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.title}>{row.name}</Text>
      <Text style={styles.meta}>
        {row.site_key} · {row.site_name}
      </Text>
      {field('Type', row.asset_type)}
      {field('Equipment #', row.equipment_number)}
      {field('Serial', row.serial_no)}
      {field('Build year', row.build_year)}
      {field('Parent', row.parent_asset_key)}
      {field('Cost center', row.costcenter_key)}
      {field('Classification', row.asset_classification_name ?? row.asset_classification_key)}
      <Text style={styles.footer}>
        Updated {row.updated_at?.slice(0, 10) ?? '—'}
      </Text>
    </RNScrollView>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  scroll: { padding: 16, paddingBottom: 40 },
  errorText: { color: '#b91c1c', textAlign: 'center' },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  meta: { fontSize: 14, opacity: 0.75, marginBottom: 16 },
  line: { fontSize: 16, marginBottom: 10 },
  label: { fontWeight: '600' },
  footer: { marginTop: 24, fontSize: 13, opacity: 0.6 },
});
