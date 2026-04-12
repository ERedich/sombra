import { useCallback, useState } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import { useThemePreference } from '@/context/ThemePreferenceContext';
import Colors from '@/constants/Colors';
import { ApiError, workingSiteRequest } from '@/lib/api';
import { getNotificationsUnreadCount } from '@/lib/cmmsApi';
import {
  RNActivityIndicator,
  RNModal,
  RNPressable,
  RNScrollView,
  RNView,
} from '@/lib/rnJsx';
import { setSession } from '@/lib/sessionStorage';

export default function HomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const router = useRouter();
  const { user, signOut, refreshUser } = useAuth();
  const { preference, setPreference } = useThemePreference();
  const [unread, setUnread] = useState<number | null>(null);
  const [siteOpen, setSiteOpen] = useState(false);
  const [siteBusy, setSiteBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void getNotificationsUnreadCount()
        .then((r) => setUnread(r.unread_count))
        .catch(() => setUnread(null));
    }, []),
  );

  const workingSiteLabel = (() => {
    if (!user?.working_site_id) return 'No working site set';
    const opt = user.selectable_working_sites?.find(
      (s) => s.id === user.working_site_id,
    );
    if (opt) return `${opt.name} (${opt.key})`;
    return user.working_site_id;
  })();

  const plantSiteOptions =
    user?.selectable_working_sites?.filter((s) => s.is_plant === true) ?? [];

  const canPickSite =
    !!user?.allow_site_change_on_login && plantSiteOptions.length > 1;

  async function onPickSite(siteId: string) {
    if (!user || siteBusy) return;
    setSiteBusy(true);
    try {
      const { token, user: next } = await workingSiteRequest(siteId);
      await setSession(token, next);
      await refreshUser();
      setSiteOpen(false);
    } catch (e) {
      Alert.alert(
        'Could not change site',
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Request failed.',
      );
      setSiteOpen(false);
    } finally {
      setSiteBusy(false);
    }
  }

  return (
    <RNScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.title}>
        Hello{user?.name ? `, ${user.name}` : ''}
      </Text>
      <Text style={styles.meta}>{user?.login_name}</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Working site</Text>
        <Text style={styles.cardBody}>{workingSiteLabel}</Text>
        {canPickSite ? (
          <RNPressable style={styles.linkBtn} onPress={() => setSiteOpen(true)}>
            <Text style={styles.linkText}>Change site</Text>
          </RNPressable>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Shortcuts</Text>
        <RNPressable
          style={styles.shortcut}
          onPress={() => router.push('./work-orders')}>
          <Text style={styles.shortcutText}>Work orders</Text>
        </RNPressable>
        <RNPressable
          style={styles.shortcut}
          onPress={() => router.push('./assets')}>
          <Text style={styles.shortcutText}>Assets</Text>
        </RNPressable>
        <RNPressable
          style={styles.shortcut}
          onPress={() => router.push('/notifications')}>
          <Text style={styles.shortcutText}>
            Notifications
            {unread != null && unread > 0 ? ` (${unread} unread)` : ''}
          </Text>
        </RNPressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Appearance</Text>
        {(
          [
            ['system', 'System'],
            ['light', 'Light'],
            ['dark', 'Dark'],
          ] as const
        ).map(([value, label]) => (
          <RNPressable
            key={value}
            style={[
              styles.themeRow,
              preference === value && {
                borderLeftColor: palette.tint,
                backgroundColor:
                  colorScheme === 'dark'
                    ? 'rgba(255,255,255,0.06)'
                    : 'rgba(47,149,220,0.12)',
              },
            ]}
            onPress={() => setPreference(value)}>
            <Text
              style={[
                styles.themeRowText,
                { color: palette.text },
                preference === value && styles.themeRowTextSelected,
              ]}>
              {label}
            </Text>
          </RNPressable>
        ))}
      </View>

      <RNPressable style={styles.signOut} onPress={() => void signOut()}>
        <Text style={styles.signOutLabel}>Sign out</Text>
      </RNPressable>

      <RNModal visible={siteOpen} transparent animationType="fade">
        <RNView style={styles.modalBackdrop}>
          <RNView
            style={[styles.modalCard, { backgroundColor: palette.background }]}>
            <Text style={styles.modalTitle}>Working site</Text>
            {siteBusy ? (
              <RNActivityIndicator size="large" color="#2563eb" />
            ) : (
              plantSiteOptions.map((s) => (
                <RNPressable
                  key={s.id}
                  style={styles.siteRow}
                  onPress={() => void onPickSite(s.id)}>
                  <Text style={styles.siteRowText}>
                    {s.name} ({s.key})
                  </Text>
                </RNPressable>
              ))
            )}
            <RNPressable
              style={styles.modalCancel}
              onPress={() => setSiteOpen(false)}
              disabled={siteBusy}>
              <Text>Cancel</Text>
            </RNPressable>
          </RNView>
        </RNView>
      </RNModal>
    </RNScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
  },
  meta: {
    marginTop: 6,
    fontSize: 15,
    opacity: 0.7,
  },
  card: {
    marginTop: 24,
    padding: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(128,128,128,0.35)',
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '600',
    opacity: 0.75,
    marginBottom: 8,
  },
  cardBody: {
    fontSize: 17,
  },
  linkBtn: { marginTop: 12, alignSelf: 'flex-start' },
  linkText: { color: '#2563eb', fontSize: 16, fontWeight: '600' },
  shortcut: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.25)',
  },
  shortcutText: { fontSize: 17, color: '#2563eb' },
  themeRow: {
    marginHorizontal: -16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.25)',
  },
  themeRowText: { fontSize: 17 },
  themeRowTextSelected: { fontWeight: '700' },
  signOut: {
    marginTop: 32,
    paddingVertical: 14,
    alignSelf: 'flex-start',
  },
  signOutLabel: {
    color: '#b91c1c',
    fontSize: 16,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    borderRadius: 12,
    padding: 16,
    maxHeight: '80%',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  siteRow: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  siteRowText: { fontSize: 16 },
  modalCancel: { marginTop: 16, padding: 12, alignItems: 'center' },
});
