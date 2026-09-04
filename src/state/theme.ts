const KEY = 'lumo.theme.v1';
export type Theme = 'default' | 'warm' | 'cool' | 'glass';

export function applyTheme(t: Theme) {
  const html = document.documentElement;
  if (t === 'default') html.removeAttribute('data-theme');
  else html.setAttribute('data-theme', t);
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
}

export function readTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY) as Theme | null;
    if (t === 'warm' || t === 'cool' || t === 'glass' || t === 'default') return t;
  } catch { /* ignore */ }
  return 'default';
}

export const THEME_LABEL: Record<Theme, string> = {
  default: '默认',
  warm: '暖调',
  cool: '冷调',
  glass: '玻璃',
};
