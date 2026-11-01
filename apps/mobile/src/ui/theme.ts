import { useColorScheme } from 'react-native';

/** Tokens from docs/design-system.md §2 (v0.2 vibrant pastel cards), light and dark. */
export interface Theme {
  dark: boolean;
  ground: string;
  frame: string;
  card: string;
  line: string;
  line2: string;
  ink: string;
  ink2: string;
  ink3: string;
  plum: string;
  onPlum: string;
  mint: Tone;
  blush: Tone;
  lilac: Tone;
  butter: Tone;
  sky: Tone;
  good: string;
  warn: string;
  bad: string;
}

export interface Tone {
  bg: string;
  ink: string;
  solid: string;
}

export const light: Theme = {
  dark: false,
  ground: '#e7e9ef',
  frame: '#f5f6f9',
  card: '#ffffff',
  line: '#eceef3',
  line2: '#e1e4ea',
  ink: '#17141b',
  ink2: '#5b5764',
  ink3: '#68636f',
  plum: '#3b1f3e',
  onPlum: '#ffffff',
  mint: { bg: '#e2f5e9', ink: '#1d7a46', solid: '#34b46c' },
  blush: { bg: '#fde7ea', ink: '#b52f49', solid: '#ea5f78' },
  lilac: { bg: '#ede9fc', ink: '#5a45c2', solid: '#8c78ee' },
  butter: { bg: '#fdf2d2', ink: '#7a5600', solid: '#f0b93a' },
  sky: { bg: '#e2eefd', ink: '#1d62b6', solid: '#4f97ec' },
  good: '#1f9d55',
  warn: '#b47e00',
  bad: '#d63c4f',
};

export const dark: Theme = {
  dark: true,
  ground: '#08070a',
  frame: '#111014',
  card: '#19171d',
  line: '#25222a',
  line2: '#2e2a34',
  ink: '#f3f0f6',
  ink2: '#b4aebd',
  ink3: '#948e9e',
  plum: '#e4c9ea',
  onPlum: '#17141b',
  mint: { bg: '#12291c', ink: '#6fd69a', solid: '#34b46c' },
  blush: { bg: '#31181e', ink: '#f59aab', solid: '#ea5f78' },
  lilac: { bg: '#221d3a', ink: '#b6a8ff', solid: '#8c78ee' },
  butter: { bg: '#2e2510', ink: '#f2c14e', solid: '#f0b93a' },
  sky: { bg: '#13223a', ink: '#8cc0ff', solid: '#4f97ec' },
  good: '#3ccb78',
  warn: '#f2b632',
  bad: '#f06a7c',
};

export type ToneName = 'mint' | 'blush' | 'lilac' | 'butter' | 'sky';

/** Shape and spacing (design-system.md: radius card 20, tile 16, control 12; 4 px base). */
export const radius = { card: 20, tile: 16, control: 12, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
