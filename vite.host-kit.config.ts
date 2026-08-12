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
        plugin: resolve(import.meta.dirname, 'src/host-kit/plugin/index.ts'),
        'plugin-react': resolve(import.meta.dirname, 'src/host-kit/plugin-react/index.ts'),
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
        '@retake-tools/package-contracts',
        '@retake-tools/package-sdk',
        '@retake-tools/plugin-runtime',
      ],
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js',
        entryFileNames: '[name].js',
      },
    },
  },
});
