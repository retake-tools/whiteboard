import {
  Crop,
  Expand,
  PenTool,
  Puzzle,
  Scaling,
  ScanSearch,
  SlidersHorizontal,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';
import type {
  PluginToolbarActionIconV1,
} from '../core/pluginContributionRegistry';

const iconByName = {
  adjustments: SlidersHorizontal,
  annotation: PenTool,
  crop: Crop,
  outpaint: Expand,
  resize: Scaling,
  'selection-mask': ScanSearch,
  'smart-edit': WandSparkles,
} satisfies Record<PluginToolbarActionIconV1, LucideIcon>;

export function PluginActionIcon({
  icon,
}: {
  icon?: PluginToolbarActionIconV1;
}): ReactElement {
  const Icon = icon ? iconByName[icon] : Puzzle;
  return <Icon aria-hidden="true" size={16} />;
}
