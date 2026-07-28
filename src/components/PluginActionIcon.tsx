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
  PluginCommandIconV1,
} from '@retake-tools/package-sdk';

const iconByName = {
  adjustments: SlidersHorizontal,
  annotation: PenTool,
  crop: Crop,
  outpaint: Expand,
  resize: Scaling,
  'selection-mask': ScanSearch,
  'smart-edit': WandSparkles,
} satisfies Record<PluginCommandIconV1, LucideIcon>;

export function PluginActionIcon({
  icon,
}: {
  icon?: PluginCommandIconV1;
}): ReactElement {
  const Icon = icon ? iconByName[icon] : Puzzle;
  return <Icon aria-hidden="true" size={16} />;
}
