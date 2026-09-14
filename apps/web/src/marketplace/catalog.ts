import { ALL_PERMISSIONS, type PluginRowInfo } from '@mpw/kernel';

export type PluginCategory = '全部' | '办公' | '科研' | '写作' | '系统';

export interface MarketplaceMeta {
  category: Exclude<PluginCategory, '全部'>;
  tags: string[];
  featured?: boolean;
}

export interface MarketplacePlugin extends PluginRowInfo, MarketplaceMeta {}

export const MARKETPLACE_META: Record<string, MarketplaceMeta> = {
  'mpw.email': { category: '办公', tags: ['IMAP', 'SMTP', '校园邮箱'], featured: true },
  'mpw.notes': { category: '办公', tags: ['Markdown', '双向链接', 'AI'], featured: true },
  'mpw.tasks': { category: '办公', tags: ['待办', '截止日期', '计划'] },
  'mpw.projects': { category: '科研', tags: ['项目管理', '资源链接', '里程碑'] },
  'mpw.references': { category: '科研', tags: ['PDF', '高亮', 'BibTeX'], featured: true },
  'mpw.writing': { category: '写作', tags: ['LaTeX', 'SyncTeX', 'PDF'], featured: true },
  'mpw.files': { category: '办公', tags: ['文件库', '本地存储'] },
  'mpw.ai': { category: '系统', tags: ['AI', 'DeepSeek', '上下文'] },
  'mpw.layout-controls': { category: '系统', tags: ['窗口', '布局', '侧栏'] },
  'mpw.home': { category: '系统', tags: ['首页', '统计'] },
};

export const MARKETPLACE_CATEGORIES: PluginCategory[] = ['全部', '办公', '科研', '写作', '系统'];

export function marketplaceCatalog(plugins: PluginRowInfo[]): MarketplacePlugin[] {
  return plugins.map((plugin) => ({
    ...plugin,
    ...(MARKETPLACE_META[plugin.id] ?? { category: '系统' as const, tags: ['扩展'] }),
  })).sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || a.name.localeCompare(b.name, 'zh-CN'));
}

export function filterMarketplace(items: MarketplacePlugin[], query: string, category: PluginCategory): MarketplacePlugin[] {
  const q = query.trim().toLocaleLowerCase();
  return items.filter((item) => {
    if (category !== '全部' && item.category !== category) return false;
    if (!q) return true;
    return [item.name, item.id, item.author, item.description, ...item.tags].some((value) => value.toLocaleLowerCase().includes(q));
  });
}

export interface PublishManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  license: string;
  repository: string;
  permissions: string[];
  categories: string[];
}

export function validatePublishManifest(value: unknown): { manifest?: PublishManifest; errors: string[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { errors: ['清单必须是 JSON 对象'] };
  const data = value as Record<string, unknown>; const errors: string[] = [];
  if (data.schemaVersion !== 1) errors.push('schemaVersion 必须为 1');
  if (typeof data.id !== 'string' || !/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9_-]+)+$/.test(data.id)) errors.push('id 必须使用反向域名格式，例如 com.example.focus');
  if (typeof data.name !== 'string' || !data.name.trim()) errors.push('name 不能为空');
  if (typeof data.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(data.version)) errors.push('version 必须是 SemVer，例如 1.0.0');
  for (const key of ['author', 'description', 'license', 'repository']) if (typeof data[key] !== 'string' || !(data[key] as string).trim()) errors.push(`${key} 不能为空`);
  if (typeof data.repository === 'string' && !/^https:\/\//i.test(data.repository)) errors.push('repository 必须是 HTTPS 地址');
  if (!Array.isArray(data.permissions) || !data.permissions.every((item) => typeof item === 'string')) errors.push('permissions 必须是字符串数组');
  else for (const permission of data.permissions) if (!ALL_PERMISSIONS.includes(permission as never)) errors.push(`未知权限：${permission}`);
  if (!Array.isArray(data.categories) || !data.categories.every((item) => typeof item === 'string')) errors.push('categories 必须是字符串数组');
  else for (const category of data.categories) if (!MARKETPLACE_CATEGORIES.includes(category as PluginCategory) || category === '全部') errors.push(`未知分类：${category}`);
  return errors.length ? { errors } : { manifest: data as unknown as PublishManifest, errors };
}
