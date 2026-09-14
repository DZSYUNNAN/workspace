import React, { useMemo, useRef, useState } from 'react';
import { useApp } from '../state';
import { Icon } from '../components/Icon';
import { PERMISSION_LABELS, type Permission } from '@mpw/kernel';
import { strToU8 } from 'fflate';
import guideMarkdown from '../../../../docs/PLUGIN_DEVELOPMENT_GUIDE.md?raw';
import { MARKETPLACE_CATEGORIES, filterMarketplace, marketplaceCatalog, validatePublishManifest, type MarketplacePlugin, type PluginCategory } from '../marketplace/catalog';
import { buildStarterZip, downloadBytes } from '../marketplace/devkit';

type Tab = 'market' | 'installed' | 'disabled' | 'develop';

export function PluginCenter(): React.ReactElement {
  const { kernel, refresh } = useApp();
  const [tab, setTab] = useState<Tab>('market');
  const [query, setQuery] = useState(''); const [category, setCategory] = useState<PluginCategory>('全部');
  const plugins = kernel.listPlugins(); const catalog = marketplaceCatalog(plugins);
  const shown = useMemo(() => {
    const base = tab === 'installed' ? catalog.filter((plugin) => plugin.enabled) : tab === 'disabled' ? catalog.filter((plugin) => !plugin.enabled) : catalog;
    return filterMarketplace(base, query, category);
  }, [catalog, tab, query, category]);

  return <div className="view plugin-market-view">
    <div className="plugin-market-hero"><div><h1>插件市场</h1><p className="sub">发现、启用和管理 ModuDesk 模块，也可以下载模板制作自己的插件。</p></div>
      <div className="plugin-market-stats"><span><b>{plugins.length}</b> 个插件</span><span><b>{plugins.filter((plugin) => plugin.enabled).length}</b> 已启用</span><span><b>{MARKETPLACE_CATEGORIES.length - 1}</b> 个分类</span></div></div>

    <div className="plugin-market-tabs">{([
      ['market', '浏览市场'], ['installed', `已启用 (${plugins.filter((plugin) => plugin.enabled).length})`],
      ['disabled', `已停用 (${plugins.filter((plugin) => !plugin.enabled).length})`], ['develop', '开发插件'],
    ] as [Tab, string][]).map(([id, label]) => <button key={id} className={`btn sm${tab === id ? ' primary' : ''}`} onClick={() => setTab(id)}>{label}</button>)}</div>

    {tab === 'develop' ? <DeveloperCenter /> : <>
      <div className="plugin-market-tools"><label className="plugin-search"><Icon name="search" size={14} /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索插件、作者或功能" /></label>
        <div className="plugin-categories">{MARKETPLACE_CATEGORIES.map((item) => <button key={item} className={`chip${category === item ? ' on' : ''}`} onClick={() => setCategory(item)}>{item}</button>)}</div></div>
      <div className="cards plugin-market-grid">{shown.map((plugin) => <PluginCard key={plugin.id} info={plugin} onChanged={refresh} />)}
        {shown.length === 0 && <div className="empty-state"><Icon name="puzzle" size={28} /><div>没有匹配的插件</div><span>可以换一个关键词或分类。</span></div>}</div>
      {tab === 'market' && <div className="card community-publish-card"><div><b>发布你的插件</b><p>下载开发模板，完成测试并提交源码审核，通过后即可进入市场。</p></div><button className="btn" onClick={() => setTab('develop')}><Icon name="code" size={13} /> 开始制作</button></div>}
    </>}
  </div>;
}

function PluginCard({ info, onChanged }: { info: MarketplacePlugin; onChanged(): void }): React.ReactElement {
  const { kernel } = useApp(); const [busy, setBusy] = useState(false); const [confirmDelete, setConfirmDelete] = useState(false);
  const toggle = async (): Promise<void> => { setBusy(true); try { if (info.enabled) await kernel.disablePlugin(info.id); else await kernel.enablePlugin(info.id); onChanged(); } finally { setBusy(false); } };
  return <div className={`card plugin-card${info.featured ? ' featured' : ''}`}>
    <div className="pc-head"><div className="pc-icon"><Icon name={info.icon} size={17} /></div><div style={{ flex: 1, minWidth: 0 }}>
      <div className="pc-title">{info.name} <span className="badge gray">v{info.version}</span>{info.featured && <span className="badge">推荐</span>}</div><div className="pc-author">{info.author} · {info.category}</div>
    </div><span className={`plugin-state ${info.enabled ? 'enabled' : ''}`}>{info.enabled ? '已启用' : '已停用'}</span></div>
    <div className="pc-description">{info.description}</div><div className="plugin-tags">{info.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
    <div className="perm-row">{info.permissions.map((permission) => <span key={permission} className="perm" title={PERMISSION_LABELS[permission as Permission]}><Icon name="check" size={10} /> {PERMISSION_LABELS[permission as Permission] ?? permission}</span>)}</div>
    {info.error && <div className="plugin-error">{info.error}</div>}
    <div className="plugin-card-actions"><button className={`btn sm${info.enabled ? '' : ' primary'}`} disabled={busy} onClick={() => void toggle()}>{busy ? '处理中…' : info.enabled ? '停用' : info.state === 'uninstalled' ? '恢复并启用' : '启用'}</button>
      {info.builtin ? <span>官方内置 · 本地安装</span> : confirmDelete ? <><button className="btn sm danger" onClick={async () => { await kernel.uninstallPlugin(info.id, { deleteData: true }); setConfirmDelete(false); onChanged(); }}>删除数据并卸载</button><button className="btn sm" onClick={() => setConfirmDelete(false)}>取消</button></> : <button className="btn sm danger" onClick={() => setConfirmDelete(true)}><Icon name="trash" size={12} /> 卸载</button>}
    </div>
  </div>;
}

function DeveloperCenter(): React.ReactElement {
  const input = useRef<HTMLInputElement>(null); const [validation, setValidation] = useState<{ ok: boolean; text: string } | null>(null); const [showGuide, setShowGuide] = useState(false);
  const validateFile = async (file: File): Promise<void> => {
    try { const result = validatePublishManifest(JSON.parse(await file.text())); setValidation(result.errors.length ? { ok: false, text: result.errors.join('\n') } : { ok: true, text: `发布清单有效：${result.manifest!.name} v${result.manifest!.version}\n插件 ID：${result.manifest!.id}\n下一步请运行 npm run check 并提交 Pull Request。` }); }
    catch (error) { setValidation({ ok: false, text: `无法读取 JSON：${error instanceof Error ? error.message : String(error)}` }); }
  };
  return <div className="plugin-developer-center"><div className="plugin-dev-steps">
    <div className="card"><span className="step-no">1</span><b>下载模板</b><p>获得最小插件、发布清单和测试示例。</p><button className="btn primary" onClick={() => downloadBytes(buildStarterZip(), 'modudesk-plugin-starter.zip', 'application/zip')}><Icon name="download" size={13} /> 下载开发模板</button></div>
    <div className="card"><span className="step-no">2</span><b>按教程开发</b><p>接入窗口、命令、搜索、数据和右侧 AI。</p><button className="btn" onClick={() => setShowGuide((value) => !value)}><Icon name="book" size={13} /> {showGuide ? '收起教程' : '查看教程'}</button><button className="btn" onClick={() => downloadBytes(strToU8(guideMarkdown), 'ModuDesk-插件制作与发布教程.md', 'text/markdown;charset=utf-8')}><Icon name="download" size={13} /> 下载教程</button></div>
    <div className="card"><span className="step-no">3</span><b>检查发布清单</b><p>上传 modudesk.plugin.json，发布前检查格式。</p><button className="btn" onClick={() => input.current?.click()}><Icon name="upload" size={13} /> 选择清单</button><input ref={input} hidden type="file" accept=".json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void validateFile(file); event.target.value = ''; }} /></div>
    <div className="card"><span className="step-no">4</span><b>提交发布</b><p>提供权限说明、测试结果、截图和维护计划。</p><a className="btn" href="https://github.com/DZSYUNNAN/workspace/pulls" target="_blank" rel="noreferrer"><Icon name="external" size={13} /> 前往 GitHub</a></div>
  </div>
    {validation && <pre className={`publish-validation ${validation.ok ? 'ok' : 'error'}`} role="status">{validation.ok ? '✓ ' : '⚠ '}{validation.text}</pre>}
    {showGuide && <pre className="plugin-guide-preview">{guideMarkdown}</pre>}
    <div className="card plugin-publish-policy"><b>当前发布方式</b><p>社区插件以源码 Pull Request 进入市场，并随 ModuDesk 版本完成审核和构建。这样可以在执行插件代码之前检查权限、依赖和敏感数据。运行时安装签名包会在隔离执行环境完成后开放。</p></div>
  </div>;
}
