import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    cssCodeSplit: true,
    emptyOutDir: true,
    lib: {
      entry: {
        index: resolve(import.meta.dirname, 'src/host-kit/index.ts'),
        react: resolve(import.meta.dirname, 'src/host-kit/react/index.ts'),
        styles: resolve(import.meta.dirname, 'src/host-kit/styles.ts'),
      },
      formats: ['es'],
    },
    outDir: resolve(import.meta.dirname, 'packages/host-kit/dist'),
    rolldownOptions: {
      external: [
        'react',
        'react/jsx-runtime',
        '@xyflow/react',
      ],
      output: {
        entryFileNames: '[name].js',
      },
    },
  },
});
