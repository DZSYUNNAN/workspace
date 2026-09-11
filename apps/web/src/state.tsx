import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Kernel } from '@mpw/kernel';
import type { LayoutState } from '@mpw/shared';
import type { WorkspaceData } from './adapters/backup';

export type AppRoute =
  | { type: 'home' }
  | { type: 'pluginRoute'; key: string }
  | { type: 'plugins' }
  | { type: 'settings' };

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'warn' | 'error';
}

interface AppCtx {
  data?: WorkspaceData;
  kernel: Kernel;
  version: number;
  refresh: () => void;
  route: AppRoute;
  navigate: (route: AppRoute) => void;
  workspaceId: string;
  setWorkspaceId: (id: string) => void;
  layout: LayoutState;
  setLayout: (updater: (l: LayoutState) => LayoutState) => void;
  toasts: Toast[];
  pushToast: (message: string, kind?: Toast['kind']) => void;
  aiPanelOpen: boolean;
  setAiPanelOpen: (open: boolean) => void;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp outside provider');
  return ctx;
}

export function AppProvider({ kernel, children, data }: { kernel: Kernel; children: React.ReactNode; data?: WorkspaceData }): React.ReactElement {
  const [version, setVersion] = useState(0);
  const [route, setRoute] = useState<AppRoute>({ type: 'home' });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [aiPanelOpen, setAiPanelOpen] = useState(true);
  const savedWs = kernel.settings.get<string | null>('workspace.active', null);
  const workspaces = kernel.workspaces.list();
  const [workspaceId, setWorkspaceIdState] = useState<string>(
    workspaces.some((w) => w.id === savedWs) ? (savedWs as string) : (workspaces[0]?.id ?? '')
  );
  const initialLayout = parseLayout(kernel.workspaces.getLayout(workspaceId));
  const [layout, setLayoutState] = useState<LayoutState>(initialLayout);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const pushToast = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-4), { id, message, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const setLayout = useCallback(
    (updater: (l: LayoutState) => LayoutState) => {
      setLayoutState((prev) => {
        const next = updater(prev);
        kernel.workspaces.saveLayout(workspaceId, JSON.stringify(next));
        kernel.events.emit('layout:changed', { workspaceId });
        return next;
      });
    },
    [kernel, workspaceId]
  );

  const setWorkspaceId = useCallback(
    (id: string) => {
      setWorkspaceIdState(id);
      kernel.settings.set('workspace.active', id);
      setLayoutState(parseLayout(kernel.workspaces.getLayout(id)));
    },
    [kernel]
  );

  // system event wiring → UI refresh + toasts
  useEffect(() => {
    const offs = [
      kernel.events.on('workspace:navigate', (payload) => {
        const { plugin, id } = payload as { plugin: string; id: string };
        setRoute({ type: 'pluginRoute', key: `${plugin}/main` });
        kernel.events.emit(`ui:open:${plugin}`, { hit: { id: `${plugin}:resource:${id}` } });
      }),
      kernel.events.on('plugins:changed', () => refresh()),
      kernel.events.on('settings:changed', () => refresh()),
      kernel.events.on('notify', (p) => {
        const d = p as { message: string; kind?: Toast['kind'] };
        pushToast(d.message, d.kind ?? 'info');
      }),
      kernel.events.on('ui:openWidget', (p) => {
        const d = p as { widgetId: string };
        setRoute({ type: 'home' });
        setLayoutState((prev) => {
          // ensure the widget is present: add to center as a tab if missing
          const present = JSON.stringify(prev).includes(d.widgetId);
          if (present) return prev;
          const next = addWidgetToArea(prev, d.widgetId, 'center');
          kernel.workspaces.saveLayout(workspaceId, JSON.stringify(next));
          return next;
        });
        refresh();
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [kernel, refresh, pushToast, workspaceId]);

  const value = useMemo<AppCtx>(
    () => ({
      data,
      kernel,
      version,
      refresh,
      route,
      navigate: setRoute,
      workspaceId,
      setWorkspaceId,
      layout,
      setLayout,
      toasts,
      pushToast,
      aiPanelOpen,
      setAiPanelOpen,
    }),
    [data, kernel, version, refresh, route, workspaceId, setWorkspaceId, layout, setLayout, toasts, pushToast, aiPanelOpen]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function parseLayout(json: string | null): LayoutState {
  const fallback: LayoutState = {
    version: 1,
    areas: {
      left: null,
      right: null,
      top: null,
      bottom: null,
      center: { kind: 'tabs', items: ['mpw.home/dashboard'], active: 0 },
    },
    floats: [],
    sizes: { leftW: 250, rightW: 340, topH: 180, bottomH: 160 },
  };
  if (!json) return fallback;
  try {
    const parsed = JSON.parse(json) as LayoutState;
    if (parsed.version !== 1 || !parsed.areas) return fallback;
    if (!parsed.areas.center && parsed.floats.length === 0) parsed.areas.center = fallback.areas.center;
    return parsed;
  } catch {
    return fallback;
  }
}

export function addWidgetToArea(l: LayoutState, widgetId: string, area: keyof LayoutState['areas']): LayoutState {
  const current = l.areas[area];
  let next: LayoutState['areas'][typeof area];
  if (!current) next = { kind: 'leaf', widgetId };
  else if (current.kind === 'leaf') next = { kind: 'tabs', items: [current.widgetId, widgetId], active: 1 };
  else if (current.kind === 'tabs') next = { kind: 'tabs', items: [...current.items, widgetId], active: current.items.length };
  else next = { kind: 'split', dir: 'col', ratio: 0.5, a: current, b: { kind: 'leaf', widgetId } };
  return { ...l, areas: { ...l.areas, [area]: next } };
}
