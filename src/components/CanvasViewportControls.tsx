import { LocateFixed, Map, Minus, Plus } from 'lucide-react';
import { useOnViewportChange, useReactFlow } from '@xyflow/react';
import { useState, type ReactElement } from 'react';
import { useI18n } from '../i18n';
import type { RetakeEdge, RetakeNode } from '../core/types';
import { TooltipIconButton } from './Tooltip';

interface CanvasViewportControlsProps {
  isMiniMapVisible: boolean;
  onToggleMiniMap: () => void;
}

export function CanvasViewportControls({
  isMiniMapVisible,
  onToggleMiniMap,
}: CanvasViewportControlsProps): ReactElement {
  const { t } = useI18n();
  const reactFlow = useReactFlow<RetakeNode, RetakeEdge>();
  const [zoomPercent, setZoomPercent] = useState(100);

  useOnViewportChange({
    onChange: (viewport) => setZoomPercent(Math.round(viewport.zoom * 100)),
  });

  return (
    <div className="canvas-utility-dock nodrag nopan" aria-label={t('toolbar.viewportControls')}>
      <div className="zoom-readout" aria-label={t('toolbar.zoomLevel')}>
        {zoomPercent}%
      </div>
      <div className="canvas-utility-buttons">
        <TooltipIconButton label={t('toolbar.zoomOut')} onClick={() => void reactFlow.zoomOut({ duration: 180 })}>
          <Minus size={16} />
        </TooltipIconButton>
        <TooltipIconButton label={t('toolbar.zoomIn')} onClick={() => void reactFlow.zoomIn({ duration: 180 })}>
          <Plus size={16} />
        </TooltipIconButton>
        <TooltipIconButton
          label={t('toolbar.fitView')}
          onClick={() => void reactFlow.fitView({ duration: 260, padding: 0.18 })}
        >
          <LocateFixed size={16} />
        </TooltipIconButton>
        <TooltipIconButton
          isPressed={isMiniMapVisible}
          label={isMiniMapVisible ? t('toolbar.hideMiniMap') : t('toolbar.showMiniMap')}
          onClick={onToggleMiniMap}
        >
          <Map size={16} />
        </TooltipIconButton>
      </div>
    </div>
  );
}
