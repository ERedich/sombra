const tintColorLight = '#2f95dc';

/** Align with web `lara-dark-amber` (see frontend/public/themes/lara-dark-amber/theme.css). */
const surfaceGroundDark = '#111827';
const surfaceCardDark = '#1f2937';
const textPrimaryDark = 'rgba(255, 255, 255, 0.87)';
const primaryDark = '#fbbf24';

export default {
  light: {
    text: '#000',
    background: '#fff',
    card: '#fff',
    tint: tintColorLight,
    tabIconDefault: '#ccc',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: textPrimaryDark,
    background: surfaceGroundDark,
    card: surfaceCardDark,
    tint: primaryDark,
    tabIconDefault: '#6b7280',
    tabIconSelected: primaryDark,
  },
};
