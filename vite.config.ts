import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { localApiPlugin } from './server/vite-local-api';

export default defineConfig({
  plugins: [localApiPlugin(), react()],
});
