import React, { useEffect, useState } from 'react';
import type { PluginContext } from '@mpw/kernel';
import { decodeDocument, extension } from '@mpw/shared';
import { PdfReader } from './PdfReader';
export function DocumentReader({ ctx, blobRef, fileName, referenceId }: { ctx: PluginContext; blobRef: string; fileName: string; referenceId: string }): React.ReactElement {
  const [text, setText] = useState('正在读取…');
  useEffect(() => {
    let cancelled = false;
    if (extension(fileName) === 'pdf') return;
    void (async () => {
      const blob = await ctx.blobs.get(blobRef); if (!blob) throw new Error('附件缺失，请恢复备份');
      if (['doc', 'rtf'].includes(extension(fileName))) return '该格式已保存，可下载原文件后用 Word 打开；转换为 DOCX 后可在此预览。';
      return decodeDocument(fileName, blob.bytes).blocks.map((b) => b.text).join('\n\n');
    })().then((value) => { if (!cancelled) setText(value); }).catch((e) => { if (!cancelled) setText(`预览不可用：${String(e instanceof Error ? e.message : e)}。可返回详情下载原文件。`); });
    return () => { cancelled = true; };
  }, [ctx, blobRef, fileName]);
  if (extension(fileName) === 'pdf') return <PdfReader ctx={ctx} blobRef={blobRef} fileName={fileName} referenceId={referenceId} />;
  return <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.8, overflow: 'auto' }}>{text}</pre>;
}
