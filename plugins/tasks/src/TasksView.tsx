import React, { useEffect, useState } from 'react';
import type { PluginContext } from '@mpw/kernel';
import { Icon } from '@mpw/ui';
import { addTask, listTasks, removeTask, setDone, type TaskRecord } from './store';

const PRIORITY_LABEL: Record<string, string> = { high: '高', normal: '中', low: '低' };

export function TasksView(props: { ctx: PluginContext; compact?: boolean }): React.ReactElement {
  const { ctx } = props;
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [showDone, setShowDone] = useState(true);
  const [draft, setDraft] = useState('');

  const reload = async (): Promise<void> => setTasks(await listTasks(ctx, showDone));

  useEffect(() => {
    void reload();
    const off = ctx.events.on('tasks:changed', () => void reload());
    return off;
  }, [showDone]);

  const emitStats = async (): Promise<void> => {
    const all = await listTasks(ctx, true);
    const open = all.filter((t) => !t.done).length;
    ctx.events.emit('plugin:stats', {
      pluginId: 'mpw.tasks',
      name: '任务',
      stats: [
        { label: '待办任务', count: open, icon: 'check' },
        { label: '已完成', count: all.length - open, icon: 'check' },
      ],
    });
  };

  const create = async (): Promise<void> => {
    const title = draft.trim();
    if (!title) return;
    setDraft('');
    await addTask(ctx, title);
    ctx.events.emit('tasks:changed', {});
    await emitStats();
  };

  return (
    <div className="widget">
      <div className="widget-toolbar">
        <input
          className="input"
          style={{ flex: 1, minWidth: 80 }}
          placeholder="添加任务,回车确认…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void create()}
        />
        <button className="btn sm primary" onClick={() => void create()}>
          <Icon name="plus" size={12} /> 添加任务
        </button>
        <button className={`btn sm${showDone ? ' primary' : ''}`} onClick={() => setShowDone((v) => !v)}>
          已完成
        </button>
      </div>
      <div className="list">
        {tasks.map((t) => (
          <div key={t.id} className="list-row" style={{ gap: 10 }}>
            <button
              className={`task-check${t.done ? ' on' : ''}`}
              title={t.done ? '标记为待办' : '标记完成'}
              onClick={async () => {
                await setDone(ctx, t.id, !t.done);
                ctx.events.emit('tasks:changed', { id: t.id });
                await emitStats();
              }}
            >
              {t.done ? <Icon name="check" size={12} /> : null}
            </button>
            <span style={{ flex: 1, minWidth: 0, textDecoration: t.done ? 'line-through' : 'none', color: t.done ? 'var(--text-3)' : 'var(--text)' }}>
              {t.title}
            </span>
            {t.due && <span className="badge gray">⏰ {t.due}</span>}
            {t.priority !== 'normal' && (
              <span className="badge" style={t.priority === 'high' ? { background: 'color-mix(in srgb, var(--danger) 12%, transparent)', color: 'var(--danger)' } : undefined}>
                {PRIORITY_LABEL[t.priority] ?? t.priority}
              </span>
            )}
            <button
              className="icon-btn danger"
              onClick={async () => {
                await removeTask(ctx, t.id);
                ctx.events.emit('tasks:changed', { id: t.id });
                await emitStats();
              }}
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
        ))}
        {tasks.length === 0 && (
          <div className="empty-state">
            <Icon name="check" size={24} />
            <div>暂无任务</div>
            <div style={{ fontSize: 11 }}>待办、日程、论文任务都可以放在这里</div>
          </div>
        )}
      </div>
    </div>
  );
}
