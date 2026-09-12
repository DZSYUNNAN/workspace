import React from 'react';
import { definePlugin } from '@mpw/kernel';
import { LayoutControlsView } from './LayoutControlsView';

export default definePlugin({
  manifest: {
    id: 'mpw.layout-controls',
    name: '窗口大小控制器',
    version: '0.1.0',
    author: 'ModuDesk',
    description: '集中调整当前工作区内停靠模块、分栏和浮动窗口的尺寸。',
    icon: 'panelRight',
    minCoreVersion: '^0.1.0',
    permissions: [],
    contributions: {
      widgets: [{ id: 'panel', title: '窗口大小', icon: 'panelRight', defaultArea: 'float', minW: 360, minH: 300 }],
      routes: [{ id: 'main', title: '窗口大小', icon: 'panelRight', showInSidebar: true, order: 85 }],
    },
  },
  activate(ctx) {
    ctx.ui.registerRoute('main', () => React.createElement(LayoutControlsView, { ctx }));
    ctx.ui.registerWidget('panel', () => React.createElement(LayoutControlsView, { ctx }));
  },
});
