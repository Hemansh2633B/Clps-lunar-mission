import { Globe2 } from 'lucide-react';
import type { AppMode, LandingSite } from '../types/mission';
import { PlanetViewer } from './PlanetViewer';

interface Props {
  sites: LandingSite[];
  selectedId: string;
  onSelect: (id: string) => void;
  timeMs: number;
  onTime: (ms: number) => void;
  mode: AppMode;
}

/** Optional global Moon context; the main planner's local horizon remains the decision view. */
export function SpaceView({ sites, selectedId, onSelect, timeMs, onTime, mode }: Props) {
  return (
    <div className="space-view">
      <div className="space-tabs" role="group" aria-label="Moon context">
        <span className="space-tabs-hint"><Globe2 size={12} /> GLOBAL SUN / EARTH CONTEXT · LOCAL HORIZON IN PLANNER</span>
      </div>
      <PlanetViewer sites={sites} selectedId={selectedId} onSelect={onSelect} timeMs={timeMs} onTime={onTime} mode={mode} />
    </div>
  );
}
