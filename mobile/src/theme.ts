// The one place colours, spacing and type sizes live. Rebrand here.
import { useColorScheme } from 'react-native';

import type { ComponentStatus } from './lib/types';

const light = {
  bg: '#F4F5F7',
  surface: '#FFFFFF',
  sunken: '#EDEFF2',
  text: '#101828',
  muted: '#5D6676',
  border: '#DFE3E8',
  accent: '#2563EB',
  onAccent: '#FFFFFF',
  danger: '#C8261B',
  status: {
    operational: '#12813F',
    degraded: '#B45F06',
    partial_outage: '#C2470A',
    major_outage: '#C8261B',
    maintenance: '#2559C4',
  } as Record<ComponentStatus, string>,
};

const dark: typeof light = {
  bg: '#0B0E14',
  surface: '#151A23',
  sunken: '#1D2430',
  text: '#F1F3F6',
  muted: '#9AA4B5',
  border: '#28303D',
  accent: '#6AA1FF',
  onAccent: '#0B0E14',
  danger: '#FF7A6E',
  status: {
    operational: '#3FCB79',
    degraded: '#F2B33D',
    partial_outage: '#FF9550',
    major_outage: '#FF7A6E',
    maintenance: '#7FAEFF',
  },
};

export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light);

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const font = { small: 13, body: 16, title: 20, display: 28 } as const;

/** Black or white, whichever reads better on the given hex colour. */
export function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? '#101828' : '#FFFFFF';
}

/** Hex colour with an alpha channel, e.g. tint('#2563EB', 0.12). */
export function tint(hex: string, alpha: number): string {
  return hex + Math.round(alpha * 255).toString(16).padStart(2, '0');
}
