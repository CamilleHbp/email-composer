import { useRef, useState, type ReactNode } from 'react';
import { Monitor, Smartphone, GripVertical } from 'lucide-react';
import type { Translate } from './i18n';

const MIN_WIDTH = 300;
export const MOBILE_MAX_WIDTH = 600;
const MAX_WIDTH = 2560;
const clampWidth = (width: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));

export function PreviewSizeControls({ width, desktopWidth, onChange, t }: {
  width: number; desktopWidth: number; onChange: (width: number) => void; t: Translate;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return <div className="preview-size-controls" onClick={e => e.stopPropagation()}>
    <div className="segmented">
      <button className={width > MOBILE_MAX_WIDTH ? 'active' : ''} aria-pressed={width > MOBILE_MAX_WIDTH} aria-label={t('desktop')} onClick={() => { setDraft(null); onChange(desktopWidth); }}><Monitor size={17}/></button>
      <button className={width <= MOBILE_MAX_WIDTH ? 'active' : ''} aria-pressed={width <= MOBILE_MAX_WIDTH} aria-label={t('mobile')} onClick={() => { setDraft(null); onChange(375); }}><Smartphone size={17}/></button>
    </div>
    <label className="preview-width-input"><span className="sr-only">{t('previewWidth')}</span><input type="number" min={MIN_WIDTH} max={MAX_WIDTH} value={draft ?? width} onChange={e => {
      setDraft(e.target.value);
      const value = Number(e.target.value);
      if (e.target.value && value >= MIN_WIDTH && value <= MAX_WIDTH) onChange(clampWidth(value));
    }} onBlur={() => { if (draft?.trim() && Number.isFinite(Number(draft))) onChange(clampWidth(Number(draft))); setDraft(null); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/><span aria-hidden="true">px</span></label>
  </div>;
}

export function PreviewViewport({ width, onChange, t, children }: {
  width: number; onChange: (width: number) => void; t: Translate; children: ReactNode;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ offset: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  return <div ref={track} className={`preview-viewport-track${resizing ? ' resizing' : ''}`}>
    <div className="preview-viewport" style={{ width }}>
      {children}
      <button className="preview-resize-handle" role="slider" aria-label={t('resizePreview')} title={t('resizePreview')} aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} aria-valuenow={width} aria-valuetext={`${width} px`} aria-orientation="horizontal"
        onClick={e => e.stopPropagation()} onPointerDown={e => {
          if (e.button !== 0) return;
          e.preventDefault(); e.stopPropagation();
          drag.current = { offset: e.clientX - e.currentTarget.parentElement!.getBoundingClientRect().right };
          e.currentTarget.setPointerCapture(e.pointerId); setResizing(true);
        }} onPointerMove={e => {
          if (!drag.current || !track.current) return;
          const bounds = track.current.getBoundingClientRect();
          const right = e.clientX - drag.current.offset - bounds.left;
          onChange(clampWidth(right < bounds.width ? right * 2 - bounds.width : right));
        }} onPointerUp={e => { drag.current = null; setResizing(false); e.currentTarget.releasePointerCapture(e.pointerId); }} onPointerCancel={() => { drag.current = null; setResizing(false); }} onLostPointerCapture={() => { drag.current = null; setResizing(false); }}
        onKeyDown={e => {
          const next = e.key === 'Home' ? MIN_WIDTH : e.key === 'End' ? MAX_WIDTH : e.key === 'ArrowLeft' ? width - (e.shiftKey ? 10 : 1) : e.key === 'ArrowRight' ? width + (e.shiftKey ? 10 : 1) : null;
          if (next !== null) { e.preventDefault(); e.stopPropagation(); onChange(clampWidth(next)); }
        }}><GripVertical size={16}/></button>
    </div>
  </div>;
}
