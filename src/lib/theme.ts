export type AccentThemeId =
  | 'citrus-orange'
  | 'pacific-blue'
  | 'alpine-green'
  | 'crimson-rose'
  | 'flamingo-pink'
  | 'violet-indigo';

interface AccentThemeDefinition {
  id: AccentThemeId;
  label: string;
  accentRgb: `${number} ${number} ${number}`;
  accentHex: `#${string}`;
  accentSoftRgb: `${number} ${number} ${number}`;
  accentSoftHex: `#${string}`;
  accentTintRgb: `${number} ${number} ${number}`;
  accentTintHex: `#${string}`;
}

export interface AccentThemePalette extends AccentThemeDefinition {
  glowLightA: string;
  glowLightB: string;
  glowDarkA: string;
  glowDarkB: string;
  routeLineHex: `#${string}`;
  speedChartLineHex: `#${string}`;
  heatmapBaseLineHex: `#${string}`;
  heatmapTopLineHex: `#${string}`;
}

export const DEFAULT_ACCENT_THEME_ID: AccentThemeId = 'citrus-orange';

const ACCENT_THEME_DEFINITIONS: AccentThemeDefinition[] = [
  {
    id: 'citrus-orange',
    label: 'Citrus Orange',
    accentRgb: '252 76 2',
    accentHex: '#FC4C02',
    accentSoftRgb: '255 140 66',
    accentSoftHex: '#FF8C42',
    accentTintRgb: '255 204 170',
    accentTintHex: '#FFCCAA'
  },
  {
    id: 'pacific-blue',
    label: 'Pacific Blue',
    accentRgb: '14 165 233',
    accentHex: '#0EA5E9',
    accentSoftRgb: '56 189 248',
    accentSoftHex: '#38BDF8',
    accentTintRgb: '186 230 253',
    accentTintHex: '#BAE6FD'
  },
  {
    id: 'alpine-green',
    label: 'Alpine Green',
    accentRgb: '22 163 74',
    accentHex: '#16A34A',
    accentSoftRgb: '74 222 128',
    accentSoftHex: '#4ADE80',
    accentTintRgb: '187 247 208',
    accentTintHex: '#BBF7D0'
  },
  {
    id: 'crimson-rose',
    label: 'Crimson Rose',
    accentRgb: '225 29 72',
    accentHex: '#E11D48',
    accentSoftRgb: '251 113 133',
    accentSoftHex: '#FB7185',
    accentTintRgb: '254 205 211',
    accentTintHex: '#FECDD3'
  },
  {
    id: 'flamingo-pink',
    label: 'Flamingo Pink',
    accentRgb: '255 15 223',
    accentHex: '#ff0fdf',
    accentSoftRgb: '255 128 237',
    accentSoftHex: '#ff80ed',
    accentTintRgb: '255 205 243',
    accentTintHex: '#ffcdf3'
  },
  {
    id: 'violet-indigo',
    label: 'Navy Blue',
    accentRgb: '30 64 175',
    accentHex: '#1E40AF',
    accentSoftRgb: '59 130 246',
    accentSoftHex: '#3B82F6',
    accentTintRgb: '191 219 254',
    accentTintHex: '#BFDBFE'
  }
];

const toRgba = (triplet: string, alpha: number) => `rgba(${triplet.split(' ').join(', ')}, ${alpha})`;

export const ACCENT_THEME_OPTIONS: AccentThemePalette[] = ACCENT_THEME_DEFINITIONS.map((theme) => ({
  ...theme,
  glowLightA: toRgba(theme.accentRgb, 0.08),
  glowLightB: toRgba(theme.accentRgb, 0.04),
  glowDarkA: toRgba(theme.accentRgb, 0.14),
  glowDarkB: toRgba(theme.accentRgb, 0.08),
  routeLineHex: theme.accentHex,
  speedChartLineHex: theme.accentHex,
  heatmapBaseLineHex: theme.accentSoftHex,
  heatmapTopLineHex: theme.accentHex
}));

const ACCENT_THEME_BY_ID = Object.fromEntries(
  ACCENT_THEME_OPTIONS.map((theme) => [theme.id, theme])
) as Record<AccentThemeId, AccentThemePalette>;

export function isAccentThemeId(value: string): value is AccentThemeId {
  return value in ACCENT_THEME_BY_ID;
}

export function getAccentThemePalette(accentTheme: string | null | undefined): AccentThemePalette {
  if (accentTheme && isAccentThemeId(accentTheme)) {
    return ACCENT_THEME_BY_ID[accentTheme];
  }

  return ACCENT_THEME_BY_ID[DEFAULT_ACCENT_THEME_ID];
}

export function applyAccentThemeToDocument(accentTheme: string | null | undefined) {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;
  const palette = getAccentThemePalette(accentTheme);

  root.style.setProperty('--color-accent', palette.accentRgb);
  root.style.setProperty('--color-accent-soft', palette.accentSoftRgb);
  root.style.setProperty('--color-accent-tint', palette.accentTintRgb);
  root.style.setProperty('--app-glow-light-a', palette.glowLightA);
  root.style.setProperty('--app-glow-light-b', palette.glowLightB);
  root.style.setProperty('--app-glow-dark-a', palette.glowDarkA);
  root.style.setProperty('--app-glow-dark-b', palette.glowDarkB);
}
