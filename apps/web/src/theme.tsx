import { useEffect } from 'react';
import { useApp } from './state';
import type { Kernel } from '@mpw/kernel';

export type ThemeMode = 'light' | 'dark' | 'system';

export function getTheme(kernel: Kernel): ThemeMode {
  return kernel.settings.get<ThemeMode>('theme', 'system');
}

export function setTheme(kernel: Kernel, mode: ThemeMode): void {
  kernel.settings.set('theme', mode);
  kernel.events.emit('theme:changed', { mode });
}

export function applyTheme(mode: ThemeMode): void {
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function useTheme(): void {
  const { kernel, version } = useApp();
  useEffect(() => {
    applyTheme(getTheme(kernel));
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => {
      if (getTheme(kernel) === 'system') applyTheme('system');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [kernel, version]);
}
