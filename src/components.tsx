import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X, Upload, ImagePlus, Link2Off } from 'lucide-react';
import { api } from './api';
import type { Translate } from './i18n';

export function Dialog({ title, children, close, wide = false, t }: { title: string; children: ReactNode; close: () => void; wide?: boolean; t: Translate }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} aria-labelledby={titleId} className={wide ? 'dialog wide' : 'dialog'} onCancel={e => { e.preventDefault(); close(); }}>
    <header className="dialog-header"><h2 id={titleId}>{title}</h2><button className="icon-button" onClick={close} aria-label={t('close')}><X size={20}/></button></header>
    {children}
  </dialog>;
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}
export function ErrorNotice({ error, t }: { error: string; t: Translate }) { return error ? <p role="alert" className="notice error">{t(error)}</p> : null; }
export type Asset = { id: string; name: string; width: number; height: number; bytes: number; published: boolean };
export function ImageLibrary({ t, select, notify }: { t: Translate; select?: (id: string) => void; notify: (s: string) => void }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const load = () => api<Asset[]>('/assets').then(setAssets).catch(e => setError(e.message));
  useEffect(() => { void load(); }, []);
  async function upload(file?: File) {
    if (!file || busy) return;
    setBusy(true); setError('');
    try {
      const form = new FormData(); form.append('file', file);
      const a = await api<Asset>('/assets', { method: 'POST', body: form });
      await load(); select?.(a.id);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="image-library" onPaste={e => { const file = [...e.clipboardData.files][0]; if (file) { e.preventDefault(); void upload(file); } }}>
    <div className="upload-zone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void upload(e.dataTransfer.files[0]); }}>
      <ImagePlus size={30}/><p>{t('imageHint')}</p>
      <button disabled={busy} onClick={() => input.current?.click()}><Upload size={16}/>{t(busy ? 'busy' : 'upload')}</button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }}/>
    </div>
    <ErrorNotice error={error} t={t}/>
    {!assets.length && <p className="empty">{t('noImages')}</p>}
    <div className="asset-grid">{assets.map(a => <article className="asset" key={a.id}>
      <button className="asset-image" disabled={!select} onClick={() => select?.(a.id)} aria-label={a.name}><img src={`/api/assets/${a.id}/content`} alt={a.name}/></button>
      <strong>{a.name}</strong><small>{a.width} × {a.height} · {t(a.published ? 'publishedImage' : 'privateImage')}</small>
      {a.published && <button className="text-button danger" onClick={async () => {
        if (!confirm(t('revokeConfirm'))) return;
        try { await api(`/assets/${a.id}/revoke`, { method: 'POST', body: '{}' }); await load(); } catch (e) { notify((e as Error).message); }
      }}><Link2Off size={14}/>{t('revoke')}</button>}
    </article>)}</div>
  </div>;
}
