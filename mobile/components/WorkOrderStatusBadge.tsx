import { StyleSheet } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import { RNText, RNView } from '@/lib/rnJsx';

type Scheme = 'light' | 'dark';

type BadgeColors = {
  bg: string;
  text: string;
  border: string;
};

const STATUS_PALETTES: Record<string, { light: BadgeColors; dark: BadgeColors }> = {
  open: {
    light: { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },
    dark: { bg: '#1e293b', text: '#e2e8f0', border: '#475569' },
  },
  assigned: {
    light: { bg: '#dbeafe', text: '#1d4ed8', border: '#93c5fd' },
    dark: { bg: '#1e3a5f', text: '#93c5fd', border: '#2563eb' },
  },
  on_hold: {
    light: { bg: '#fef3c7', text: '#b45309', border: '#fcd34d' },
    dark: { bg: '#422006', text: '#fcd34d', border: '#d97706' },
  },
  started: {
    light: { bg: '#dcfce7', text: '#15803d', border: '#86efac' },
    dark: { bg: '#052e16', text: '#86efac', border: '#22c55e' },
  },
  continued: {
    light: { bg: '#ccfbf1', text: '#0f766e', border: '#5eead4' },
    dark: { bg: '#042f2e', text: '#5eead4', border: '#14b8a6' },
  },
  done: {
    light: { bg: '#d1fae5', text: '#047857', border: '#6ee7b7' },
    dark: { bg: '#064e3b', text: '#6ee7b7', border: '#10b981' },
  },
  closed: {
    light: { bg: '#f4f4f5', text: '#52525b', border: '#d4d4d8' },
    dark: { bg: '#27272a', text: '#d4d4d8', border: '#71717a' },
  },
};

const FALLBACK = STATUS_PALETTES.open;

export function formatWorkOrderStatus(status: string): string {
  return status
    .split('_')
    .map((w) =>
      w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w,
    )
    .join(' ');
}

export function workOrderStatusColors(
  status: string,
  scheme: Scheme,
): BadgeColors {
  const key = status.trim().toLowerCase();
  const entry = STATUS_PALETTES[key] ?? FALLBACK;
  return entry[scheme];
}

type Props = {
  status: string;
};

export function WorkOrderStatusBadge({ status }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = workOrderStatusColors(status, scheme);
  const label = formatWorkOrderStatus(status);

  return (
    <RNView
      style={[
        styles.badge,
        { backgroundColor: c.bg, borderColor: c.border },
      ]}>
      <RNText style={[styles.badgeText, { color: c.text }]}>{label}</RNText>
    </RNView>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
