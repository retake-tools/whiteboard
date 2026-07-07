import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import './feedback.css';
import './components/board-history-panel.css';
import './components/execution-inspector.css';
import './components/image-generation-panel.css';
import './components/project-board.css';
import './components/top-bar.css';
import './nodes/block-node.css';
import { App } from './App';
import { I18nProvider } from './i18n';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
