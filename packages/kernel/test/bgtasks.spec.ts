import { describe, expect, it } from 'vitest';
import { BgTaskRegistry } from '@mpw/kernel';

describe('后台任务注册表(状态栏)', () => {
  it('begin/finish 触发变更通知并维护计数', () => {
    const reg = new BgTaskRegistry();
    let notified = 0;
    reg.setNotifier(() => notified++);
    const h = reg.begin('邮件同步');
    expect(reg.count()).toBe(1);
    expect(reg.list()[0]?.label).toBe('邮件同步');
    h.setProgress(0.5);
    expect(reg.list()[0]?.progress).toBe(0.5);
    h.finish();
    expect(reg.count()).toBe(0);
    expect(notified).toBeGreaterThanOrEqual(3);
  });
});
