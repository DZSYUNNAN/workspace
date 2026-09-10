/** UI 层中文标签映射(内核保持语言无关)。 */
import type { Permission } from '@mpw/kernel';

export const PERM_CN: Record<string, string> = {
  storage: '本地存储',
  blobs: '文件系统',
  network: '网络访问',
  credentials: '凭据(加密钥匙串)',
  clipboard: '剪贴板',
  'ai:invoke': 'AI 助手',
  native: '系统能力(本地编译)',
};

export function permLabel(p: Permission | string): string {
  return PERM_CN[p] ?? p;
}

export const APP_NAME = 'ModuDesk';
export const APP_TAGLINE = '一个工作台,无限可能';
