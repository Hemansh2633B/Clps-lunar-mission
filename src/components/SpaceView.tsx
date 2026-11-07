import { useState } from 'react';
import { Globe2, Rocket } from 'lucide-react';
import type { AppMode, LandingSite } from '../types/mission';
import { PlanetViewer } from './PlanetViewer';
import { FleetViewer } from './FleetViewer';

interface Props {
  sites: LandingSite[];
  selectedId: string;
  onSelect: (id: string) => void;
  timeMs: number;
  onTime: (ms: number) => void;
  mode: AppMode;
}

export function SpaceView({ sites, selectedId, onSelect, timeMs, onTime, mode }: Props) {
  const [tab, setTab] = useState<'planet' | 'fleet'>('planet');
  return (
    <div className="space-view">
      <div className="space-tabs" role="tablist" aria-label="3D space views">
        <button role="tab" aria-selected={tab === 'planet'} className={`space-tab ${tab === 'planet' ? 'active' : ''}`} onClick={() => setTab('planet')}>
          <Globe2 size={14} /> Planet · time-lapse
        </button>
        <button role="tab" aria-selected={tab === 'fleet'} className={`space-tab ${tab === 'fleet' ? 'active' : ''}`} onClick={() => setTab('fleet')}>
          <Rocket size={14} /> Fleet hangar
        </button>
        <span className="space-tabs-hint mono">{tab === 'planet' ? 'REAL SUN / EARTH · BODY-FIXED MOON' : 'STARSHIP · HLS · CLPS — STYLIZED 3D'}</span>
      </div>
      {tab === 'planet' ? (
        <PlanetViewer sites={sites} selectedId={selectedId} onSelect={onSelect} timeMs={timeMs} onTime={onTime} mode={mode} />
      ) : (
        <FleetViewer mode={mode} />
      )}
    </div>
  );
}
