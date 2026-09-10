import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@mpw/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
      '@mpw/ui': path.resolve(__dirname, 'packages/ui/src/index.tsx'),
      '@mpw/kernel': path.resolve(__dirname, 'packages/kernel/src/index.ts'),
      '@mpw/plugin-notes': path.resolve(__dirname, 'plugins/notes/src/index.ts'),
      '@mpw/plugin-references': path.resolve(__dirname, 'plugins/references/src/index.ts'),
      '@mpw/plugin-writing': path.resolve(__dirname, 'plugins/writing/src/index.ts'),
      '@mpw/plugin-email': path.resolve(__dirname, 'plugins/email/src/index.ts'),
      '@mpw/plugin-files': path.resolve(__dirname, 'plugins/files/src/index.ts'),
      '@mpw/plugin-ai': path.resolve(__dirname, 'plugins/ai/src/index.ts'),
      '@mpw/plugin-tasks': path.resolve(__dirname, 'plugins/tasks/src/index.ts'),
      '@mpw/plugin-projects': path.resolve(__dirname, 'plugins/projects/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/test/**/*.spec.ts', 'plugins/**/test/**/*.spec.ts', 'apps/**/test/**/*.spec.{ts,tsx}'],
    environment: 'node',
    environmentMatchGlobs: [
      ['**/*.dom.spec.ts', 'jsdom'],
      ['**/*.dom.spec.tsx', 'jsdom'],
    ],
    testTimeout: 20000,
  },
});
