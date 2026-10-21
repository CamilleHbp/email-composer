import { useEffect, useRef, useState, type DragEvent, type CSSProperties } from 'react';
import { ArrowLeft, Undo2, Redo2, Eye, ArrowUpRight, Plus, Type, AlignLeft, Image, MousePointer2, Minus, MoveVertical, Columns2, Square, Copy, Trash2, ChevronUp, ChevronDown, Save, Download, Clipboard, Check, GripVertical, Layers } from 'lucide-react';
import { MOBILE_MAX_WIDTH, PreviewSizeControls, PreviewViewport } from './PreviewViewport';
import { api, download } from './api';
import { Dialog, Field, ErrorNotice, ImageLibrary } from './components';
import type { Translate } from './i18n';
import { assetIds, cloneNode, deleteNode, isContainer, kinds, locate, moveNode, node, validateDocument, walk, type EmailDocument, type EmailNode, type Kind, type TemplateRecord } from '../shared/model';
import { columnWidths, contentWidth, plainText, renderEmail, richText } from '../shared/render';
import { formattedText, insetsCss, paddingInsets } from '../shared/formatting';

type Props = {
  record: TemplateRecord; collections: { id: string; name: string }[]; sections: TemplateRecord[];
  t: Translate; lang: 'en' | 'fr'; onSave: (r: TemplateRecord) => void; onClose: () => void;
  duplicate: (r: TemplateRecord) => Promise<TemplateRecord>;
};
const icons = { section: Square, row: Columns2, column: Columns2, heading: Type, text: AlignLeft, image: Image, button: MousePointer2, divider: Minus, spacer: MoveVertical };
const signature = (v: { document: EmailDocument; name: string; kind: string; collectionId: string | null }) => JSON.stringify([v.document, v.name, v.kind, v.collectionId]);
export function Editor({ record, collections, sections, t, lang, onSave, onClose, duplicate }: Props) {
  const [doc, setDoc] = useState(record.document);
  const [name, setName] = useState(record.name);
  const [kind, setKind] = useState(record.kind);
  const [collectionId, setCollection] = useState(record.collectionId);
  const [selection, setSelection] = useState<string | null>(null);
  const [past, setPast] = useState<EmailDocument[]>([]);
  const [future, setFuture] = useState<EmailDocument[]>([]);
  const [tab, setTab] = useState<'blocks' | 'layers' | 'sections'>('blocks');
  const [modal, setModal] = useState<'preview' | 'export' | 'images' | null>(null);
  const [customPreviewWidth, setPreviewWidth] = useState<number | null>(null);
  const documentPadding = doc.paddingSides ?? [16, 16, 16, 16];
  const desktopPreviewWidth = Math.max(doc.width + documentPadding[1] + documentPadding[3], MOBILE_MAX_WIDTH + 1);
  const previewWidth = customPreviewWidth ?? desktopPreviewWidth;
  const mobile = previewWidth <= MOBILE_MAX_WIDTH;
  const [dropPreview, setDropPreview] = useState<{ parent: string | null; left: number; top: number; width: number; height: number } | null>(null);
  const dragSource = useRef<{ id: string; kind: Kind } | null>(null);
  const [preview, setPreview] = useState('');
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const [imageWarningDismissed, setImageWarningDismissed] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<'saved' | 'saving' | 'unsaved' | 'offline' | 'conflict'>('saved');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [manual, setManual] = useState('');
  const [recovery, setRecovery] = useState<TemplateRecord | null>(() => {
    try {
      const local = JSON.parse(localStorage.getItem(`mail-studio-recovery:${record.id}`) ?? 'null');
      return local && Number.isInteger(local.revision) && signature(local) !== signature(record) ? { ...local, document: validateDocument(local.document) } : null;
    } catch { return null; }
  });
  const revision = useRef(record.revision);
  const saved = useRef(signature(record));
  const current = useRef({ document: doc, name, kind, collectionId });
  current.current = { document: doc, name, kind, collectionId };
  const saving = useRef<Promise<boolean> | null>(null);
  const conflicted = useRef(false);
  const manualFrame = useRef<HTMLIFrameElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const selected = walk(doc.nodes).find(n => n.id === selection);
  const sig = signature(current.current);
  function commit(next: EmailDocument) {
    try { validateDocument(next); setPast(p => [...p.slice(-99), doc]); setFuture([]); setDoc(next); setError(''); }
    catch (e) { setError((e as Error).message); }
  }
  function change(id: string, fn: (n: EmailNode) => void) {
    const next = structuredClone(doc); const n = walk(next.nodes).find(n => n.id === id);
    if (n) { fn(n); commit(next); }
  }
  function undo() { if (!past.length) return; setFuture(f => [doc, ...f]); setDoc(past[past.length - 1]); setPast(p => p.slice(0, -1)); }
  function redo() { if (!future.length) return; setPast(p => [...p, doc]); setDoc(future[0]); setFuture(f => f.slice(1)); }
  async function save(): Promise<boolean> {
    if (saving.current) return saving.current;
    if (conflicted.current) return false;
    saving.current = (async () => {
      try {
        while (signature(current.current) !== saved.current) {
          setStatus('saving');
          const snapshot = structuredClone(current.current);
          const result = await api<TemplateRecord>(`/templates/${record.id}`, { method: 'PUT', body: JSON.stringify({ ...snapshot, revision: revision.current }) });
          revision.current = result.revision; saved.current = signature(snapshot); onSave(result);
        }
        localStorage.removeItem(`mail-studio-recovery:${record.id}`);
        setStatus('saved'); return true;
      } catch (e) {
        conflicted.current = (e as Error).message === 'revision_conflict';
        setStatus(conflicted.current ? 'conflict' : 'offline'); setError((e as Error).message); return false;
      }
    })().finally(() => { saving.current = null; });
    return saving.current;
  }
  useEffect(() => {
    if (sig === saved.current || recovery) return;
    try { localStorage.setItem(`mail-studio-recovery:${record.id}`, JSON.stringify({ ...record, ...current.current, revision: revision.current })); } catch { setError('service_unavailable'); }
    if (conflicted.current) { setStatus('conflict'); return; }
    setStatus('unsaved');
    const timer = setTimeout(() => void save(), 900);
    return () => clearTimeout(timer);
  }, [sig, recovery]);
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => { if (signature(current.current) !== saved.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 's') { e.preventDefault(); void save(); }
        if (e.key === 'z' && !(e.target as HTMLElement).matches('input,textarea,[contenteditable]')) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      }
    };
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  });
  useEffect(() => {
    if (!modal || modal === 'images') return;
    const assets = Object.fromEntries(assetIds(doc).map(id => [id, `/api/assets/${id}/content`]));
    const output = renderEmail(doc, { assets, clipboard: true });
    setWarnings(output.warnings);
    setPreview(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0">${output.fragment}</body></html>`);
  }, [doc, modal]);
  function defaultText(k: Kind) { return k === 'heading' ? t('headingDefault') : k === 'text' ? t('textDefault') : k === 'button' ? t('buttonDefault') : ''; }
  function add(k: Kind, targetId?: string | null, at?: number) {
    const next = structuredClone(doc);
    const target = targetId !== undefined ? walk(next.nodes).find(n => n.id === targetId) : selected && isContainer(selected) ? walk(next.nodes).find(n => n.id === selection) : undefined;
    if (target?.kind === 'row' && k !== 'column') { setError('invalid_move'); return; }
    const n = node(k, defaultText(k));
    const list = target ? target.children : next.nodes;
    list.splice(at ?? list.length, 0, n); commit(next); setSelection(n.id);
  }
  function drop(e: DragEvent, target: string | null, index: number) {
    e.preventDefault(); e.stopPropagation();
    setDropPreview(null);
    const id = e.dataTransfer.getData('application/mail-studio-node');
    const type = e.dataTransfer.getData('application/mail-studio-kind') as Kind;
    try { if (id) commit(moveNode(doc, id, target, index)); else if (kinds.includes(type)) add(type, target, index); } catch (e) { setError((e as Error).message); }
  }
  function move(id: string, offset: number) {
    const found = locate(doc.nodes, id);
    if (found) try { commit(moveNode(doc, id, found.parent?.id ?? null, found.index + (offset > 0 ? 2 : -1))); } catch (e) { setError((e as Error).message); }
  }
  function copyNode() {
    if (!selected) return;
    const next = structuredClone(doc); const found = locate(next.nodes, selected.id)!; const copy = cloneNode(selected);
    found.list.splice(found.index + 1, 0, copy); commit(next); setSelection(copy.id);
  }
  async function run(fn: () => Promise<void>) { setBusy(true); setError(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function exportEmail(format: 'copy' | 'html' | 'eml' | 'archive') {
    if (format === 'copy') {
      // Start clipboard permission in the click's activation window (Safari included).
      const output = api<{ html: string; text: string; warnings: string[] }>('/exports', { method: 'POST', body: JSON.stringify({ document: doc, format }) });
      let copied = false;
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        try {
          await navigator.clipboard.write([new ClipboardItem({
            'text/html': output.then(r => new Blob([r.html], { type: 'text/html' })),
            'text/plain': output.then(r => new Blob([r.text], { type: 'text/plain' })),
          })]);
          copied = true;
        } catch { /* Successful export remains available for manual copy. */ }
      }
      const result = await output;
      setWarnings(result.warnings);
      if (copied) setNotice('copied'); else setManual(result.html);
    } else await download('/exports', { method: 'POST', body: JSON.stringify({ document: doc, format }) }, format === 'archive' ? 'template.zip' : `email.${format}`);
  }
  function canvasDestination(e: DragEvent<HTMLDivElement>) {
    const source = dragSource.current;
    if (!source) return null;
    const canvas = e.currentTarget;
    const element = e.target as HTMLElement;
    const zone = source.kind === 'column' ? null : element.closest<HTMLElement>('[data-drop-index]');
    const block = element.closest<HTMLElement>(source.kind === 'column' ? '.kind-column, .kind-row' : '[data-node-id]');
    let parent: string | null = null;
    let index = doc.nodes.length;
    if (zone) {
      parent = zone.dataset.dropParent || null;
      index = Number(zone.dataset.dropIndex);
    } else if (block) {
      const found = locate(doc.nodes, block.dataset.nodeId!)!;
      const n = found.list[found.index];
      const rect = block.getBoundingClientRect();
      const horizontal = found.parent?.kind === 'row' && !(mobile && found.parent.style.stack);
      const position = horizontal ? e.clientX - rect.left : e.clientY - rect.top;
      const size = horizontal ? rect.width : rect.height;
      if (isContainer(n) && (source.kind === 'column' ? n.kind === 'row' : true) && position > 12 && position < size - 12) {
        parent = n.id; index = n.children.length;
      } else {
        parent = found.parent?.id ?? null; index = found.index + (position > size / 2 ? 1 : 0);
      }
    }
    const target = parent ? walk(doc.nodes).find(n => n.id === parent) : undefined;
    if (source.kind === 'column' ? target?.kind !== 'row' : target?.kind === 'row') return null;
    if (source.id) {
      const moving = locate(doc.nodes, source.id);
      if (!moving || (parent && walk([moving.list[moving.index]]).some(n => n.id === parent))) return null;
    }
    const zones = Array.from(canvas.querySelectorAll<HTMLElement>('[data-drop-index]'));
    const marker = zones.find(z => (z.dataset.dropParent || null) === parent && Number(z.dataset.dropIndex) === index);
    const bounds = canvas.getBoundingClientRect();
    const nodeElements = Array.from(canvas.querySelectorAll<HTMLElement>('[data-node-id]'));
    const targetElement = nodeElements.find(el => el.dataset.nodeId === parent);
    if (marker) {
      const rect = marker.getBoundingClientRect();
      let left = rect.left;
      let right = rect.right;
      let top = rect.top + rect.height / 2;
      if (targetElement) {
        const containerRect = targetElement.getBoundingClientRect();
        // Keep nested insertion visibly inside its destination, even without padding.
        left = Math.max(left, containerRect.left + 8);
        right = Math.min(right, containerRect.right - 8);
        top = target?.children.length
          ? Math.max(containerRect.top + 8, Math.min(top, containerRect.bottom - 11))
          : containerRect.top + containerRect.height / 2;
      }
      return { parent, index, preview: { parent, left: left - bounds.left, top: top - bounds.top, width: Math.max(0, right - left), height: 3 } };
    }
    // Rows place columns side by side, or vertically in the mobile preview.
    const children = target?.children ?? doc.nodes;
    const child = children[Math.min(index, children.length - 1)];
    const nodeElement = nodeElements.find(el => el.dataset.nodeId === child?.id);
    if (!nodeElement) return null;
    const rect = nodeElement.getBoundingClientRect();
    const horizontal = target?.kind === 'row' && !(mobile && target.style.stack);
    const after = index === children.length;
    const containerRect = targetElement?.getBoundingClientRect() ?? bounds;
    const insetLeft = Math.max(rect.left, containerRect.left + 8);
    const insetTop = Math.max(rect.top, containerRect.top + 8);
    return { parent, index, preview: horizontal
      ? { parent, left: Math.max(containerRect.left + 8, Math.min(after ? rect.right : rect.left, containerRect.right - 11)) - bounds.left, top: insetTop - bounds.top, width: 3, height: Math.max(0, Math.min(rect.bottom, containerRect.bottom - 8) - insetTop) }
      : { parent, left: insetLeft - bounds.left, top: Math.max(containerRect.top + 8, Math.min(after ? rect.bottom : rect.top, containerRect.bottom - 11)) - bounds.top, width: Math.max(0, Math.min(rect.right, containerRect.right - 8) - insetLeft), height: 3 } };
  }
  function dropZone(parent: string | null, index: number) {
    return <div className="drop-zone" key={`drop-${index}`} data-drop-parent={parent ?? ''} data-drop-index={index}/>;
  }
  function canvasNode(n: EmailNode, containerWidth = doc.width, fluidColumn = false, inheritedFont = doc.fontFamily ?? 'Arial,Helvetica,sans-serif') {
    const s = n.style;
    const container = isContainer(n);
    const style: CSSProperties = { padding: insetsCss(paddingInsets(s)), margin: s.marginSides ? insetsCss(s.marginSides) : undefined, opacity: s.opacity, fontFamily: s.fontFamily ?? doc.fontFamily, lineHeight: s.lineHeight, minHeight: s.minHeight, backgroundColor: s.background, backgroundImage: s.backgroundImage ? `url("${s.backgroundImage.url}")` : undefined, backgroundSize: s.backgroundImage?.size, backgroundPosition: s.backgroundImage?.position, backgroundRepeat: s.backgroundImage?.repeat, color: s.color, fontSize: s.fontSize, textAlign: s.align, border: `${s.border}px solid ${s.borderColor}`, borderRadius: s.corners ? insetsCss(s.corners) : s.radius };
    if (s.borderSides) for (const [side, b] of Object.entries(s.borderSides)) if (b) Object.assign(style, { [`border${side[0].toUpperCase()}${side.slice(1)}`]: `${b.width}px ${b.style} ${b.color}` });
    const available = contentWidth(s, containerWidth);
    const widths = n.kind === 'row' ? columnWidths(n, available - (s.stack ? s.gap : 0)) : [];
    if (n.kind === 'row' && s.stack) {
      const padding = paddingInsets(s);
      style.padding = insetsCss([padding[0], padding[1] + s.gap / 2, padding[2], padding[3] + s.gap / 2]);
    }
    style.fontFamily = s.fontFamily ?? inheritedFont;
    style.lineHeight = s.lineHeight ?? 1.5;
    if (container) Object.assign(style, { display: 'flex', flexDirection: n.kind === 'row' ? 'row' : 'column', flexWrap: n.kind === 'row' && s.stack ? 'wrap' : undefined, gap: s.gap, rowGap: n.kind === 'row' && s.stack ? 0 : s.gap, alignItems: n.kind === 'row' ? 'flex-start' : undefined, justifyContent: s.distribution === 'between' && !s.stack ? 'space-between' : s.distribution === 'center' || (n.kind === 'row' && s.stack && s.align === 'center') ? 'center' : s.distribution === 'end' || (n.kind === 'row' && s.stack && s.align === 'right') ? 'flex-end' : 'flex-start' });
    if (previewWidth <= (s.mobileBreakpoint ?? 480) && s.hiddenOnMobile) style.display = 'none';
    if (n.kind === 'column') Object.assign(style, { flex: fluidColumn ? '0 0 auto' : `${s.width} 1 0`, width: fluidColumn ? '100%' : undefined, maxWidth: fluidColumn ? containerWidth : undefined, minWidth: 0, alignSelf: s.vertical === 'middle' ? 'center' : s.vertical === 'bottom' ? 'flex-end' : 'flex-start' });
    return <div key={n.id} data-node-id={n.id} className={`canvas-node ${container ? 'container-node' : ''} ${selection === n.id ? 'selected' : ''} ${dropPreview?.parent === n.id ? 'drop-container' : ''} kind-${n.kind}`} style={style} onClick={e => { e.stopPropagation(); setSelection(n.id); }}>
      <button className="node-handle" draggable onDragStart={e => { e.dataTransfer.setData('application/mail-studio-node', n.id); }} aria-label={`${t('moveTo')} ${t(n.kind)}`} onClick={() => setSelection(n.id)}><GripVertical size={13}/>{t(n.kind)}</button>
      {container ? (n.children.length ? n.children.map((child, i) => n.kind === 'row' ? canvasNode(child, widths[i], s.stack, style.fontFamily) : <div className="canvas-slot" key={child.id} style={child.style.hiddenOnMobile && previewWidth <= (child.style.mobileBreakpoint ?? 480) ? { display: 'none' } : undefined}>{dropZone(n.id, i)}{canvasNode(child, available, false, style.fontFamily)}</div>) : <div className="empty-container">{t('dropHere')}<button className="icon-button" aria-label={t('addBlock')} onClick={e => { e.stopPropagation(); add('text', n.id); }}><Plus size={18}/></button></div>) :
        n.kind === 'image' ? (n.assetId || n.remoteSrc ? <img draggable={false} onError={() => setImageLoadFailed(true)} src={n.assetId ? `/api/assets/${n.assetId}/content` : n.remoteSrc} alt={n.alt} style={{ width: s.imageWidth ? Math.max(1, Math.floor(Math.min(s.imageWidth, available))) : `${s.width}%`, height: s.imageHeight ?? 'auto', borderRadius: s.corners ? insetsCss(s.corners) : s.radius, maxWidth: '100%', display: 'block', margin: s.align === 'center' ? '0 auto' : s.align === 'right' ? '0 0 0 auto' : 0 }}/> : <button className="image-placeholder" onClick={() => setModal('images')}><Image size={25}/>{t('chooseImage')}</button>) :
        n.kind === 'divider' ? <hr style={{ border: 0, borderTop: `${s.dividerHeight ?? 1}px solid ${s.borderColor}` }}/> :
        n.kind === 'spacer' ? <div style={{ height: s.height }}/> :
        <div className={`editable-text ${n.kind}`} contentEditable suppressContentEditableWarning role="textbox" aria-label={t(n.kind)} onBlur={e => {
          if (n.rich) {
            const html = formattedText(e.currentTarget.innerHTML, s.paragraphSpacing, false);
            if (html !== formattedText(n.text, s.paragraphSpacing, false)) change(n.id, item => { item.text = html; });
          } else {
            const text = e.currentTarget.innerText;
            if (text !== plainText(n.text)) change(n.id, item => { item.text = text; });
          }
        }} onPaste={e => { e.preventDefault(); const text = e.clipboardData.getData('text/plain'); document.execCommand('insertText', false, text); }} dangerouslySetInnerHTML={{ __html: richText(n.text, n.rich, s.paragraphSpacing) }}/>}
      {container && n.kind !== 'row' && dropZone(n.id, n.children.length)}
    </div>;
  }
  function layer(n: EmailNode, depth = 0): React.ReactNode {
    const Icon = icons[n.kind];
    return <div key={n.id}><button className={selection === n.id ? 'layer active' : 'layer'} style={{ paddingLeft: 12 + depth * 12 }} onClick={() => setSelection(n.id)} draggable onDragStart={e => e.dataTransfer.setData('application/mail-studio-node', n.id)} onDragOver={e => { if (isContainer(n)) e.preventDefault(); }} onDrop={e => { if (isContainer(n)) drop(e, n.id, n.children.length); }}><Icon size={15}/><span>{n.text ? plainText(n.text, n.rich).slice(0, 28) : t(n.kind)}</span></button>{n.children.map(c => layer(c, depth + 1))}</div>;
  }
  const styleNumber = (key: 'padding' | 'gap' | 'fontSize' | 'width' | 'height' | 'border' | 'radius', min: number, max: number) => selected && <Field key={key} label={t(key)}><div className="number-field"><input type="number" min={min} max={max} value={selected.style[key]} onChange={e => change(selected.id, n => { n.style[key] = Math.max(min, Math.min(max, Number(e.target.value))); if (key === 'padding') delete n.style.paddingSides; if (key === 'radius') delete n.style.corners; if (key === 'width' && n.kind === 'image') delete n.style.imageWidth; if (key === 'border') delete n.style.borderSides; })}/><span>{key === 'width' ? '%' : 'px'}</span></div></Field>;
  const styleColor = (key: 'color' | 'background' | 'borderColor') => selected && <Field key={key} label={t(key)}><div className="color-field"><input aria-label={t(key)} type="color" value={selected.style[key]} onChange={e => change(selected.id, n => { n.style[key] = e.target.value; })}/><span>{selected.style[key]}</span></div></Field>;
  const selectStyle = (key: 'align' | 'vertical' | 'distribution', options: string[]) => selected && <Field label={t(key)}><select value={selected.style[key]} onChange={e => change(selected.id, n => { (n.style as unknown as Record<string, unknown>)[key] = e.target.value; })}>{options.map(o => <option value={o} key={o}>{t(o)}</option>)}</select></Field>;
  return <div className="editor-shell" onDragStart={e => {
    const id = e.dataTransfer.getData('application/mail-studio-node');
    const kind = id ? walk(doc.nodes).find(n => n.id === id)?.kind : e.dataTransfer.getData('application/mail-studio-kind') as Kind;
    dragSource.current = kind && kinds.includes(kind) ? { id, kind } : null;
  }} onDragEnd={() => { dragSource.current = null; setDropPreview(null); }}>
    <header className="editor-header"><button className="icon-button" aria-label={t('back')} onClick={() => void run(async () => { if (await save()) onClose(); })}><ArrowLeft size={20}/></button><div className="editor-title"><input aria-label={t('name')} maxLength={150} value={name} onChange={e => setName(e.target.value)}/><small className={status === 'offline' || status === 'conflict' ? 'danger' : ''} role="status">{status === 'saved' && <Check size={12}/>} {t(status)}</small></div>
      <div className="editor-actions"><button className="icon-button" aria-label={t('undo')} disabled={!past.length} onClick={undo}><Undo2 size={18}/></button><button className="icon-button" aria-label={t('redo')} disabled={!future.length} onClick={redo}><Redo2 size={18}/></button><span className="separator"/><button aria-label={t('preview')} onClick={() => setModal('preview')}><Eye size={17}/><span>{t('preview')}</span></button><button className="primary" aria-label={t('export')} onClick={() => setModal('export')}><span>{t('export')}</span><ArrowUpRight size={17}/></button></div>
    </header>
    {(error || recovery || status === 'conflict' || status === 'offline') && <div className="editor-notices"><ErrorNotice error={error} t={t}/>{recovery && <div className="notice">{t('recovery')}<button onClick={() => { conflicted.current = recovery.revision !== record.revision; revision.current = recovery.revision; setDoc(recovery.document); setName(recovery.name); setKind(recovery.kind); setCollection(recovery.collectionId); setRecovery(null); }}>{t('restore')}</button><button onClick={() => { localStorage.removeItem(`mail-studio-recovery:${record.id}`); setRecovery(null); }}>{t('discard')}</button></div>}{status === 'offline' && <button onClick={() => void save()}>{t('retry')}</button>}{status === 'conflict' && <button onClick={() => void run(async () => { const r = await api<TemplateRecord>('/templates', { method: 'POST', body: JSON.stringify(current.current) }); onSave(r); localStorage.removeItem(`mail-studio-recovery:${record.id}`); onClose(); })}>{t('saveCopy')}</button>}</div>}
    {(!imageWarningDismissed && (imageLoadFailed || record.importWarnings?.length)) && <div className="editor-notices"><p className="notice" role="alert">{t('mysigmail_images_unavailable')} <button onClick={() => setImageWarningDismissed(true)}>{t('dismissWarning')}</button></p></div>}
    <div className="editor-body">
      <aside className="palette"><div className="tabs">{(['blocks', 'layers', 'sections'] as const).map(key => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{t(key)}</button>)}</div>
      {tab === 'blocks' && <><p className="palette-hint">{t('blocksHint')}</p><div className="block-grid">{kinds.filter(k => k !== 'column').map(k => { const Icon = icons[k]; return <button key={k} draggable onDragStart={e => e.dataTransfer.setData('application/mail-studio-kind', k)} onClick={() => add(k)}><Icon size={23}/><span>{t(k)}</span></button>; })}</div></>}
      {tab === 'layers' && <div className="layers">{doc.nodes.map(n => layer(n))}</div>}
      {tab === 'sections' && <div className="saved-sections">{!sections.length && <p>{t('noSections')}</p>}{sections.map(s => <button key={s.id} onClick={() => void run(async () => {
        const copy = s.shared ? await duplicate(s) : s;
        const next = structuredClone(doc); const target = selected && isContainer(selected) && selected.kind !== 'row' ? walk(next.nodes).find(n => n.id === selection)!.children : next.nodes;
        target.push(...copy.document.nodes.map(cloneNode)); commit(next);
      })}><Layers size={18}/>{s.name}<Plus size={15}/></button>)}</div>}
      <button className="document-settings" onClick={() => setSelection(null)}><SettingsIcon/>{t('document')}</button>
      </aside>
      <main className="workspace" onClick={() => setSelection(null)}>
        <div className="canvas-toolbar"><PreviewSizeControls width={previewWidth} desktopWidth={desktopPreviewWidth} onChange={setPreviewWidth} t={t}/></div>
        <PreviewViewport width={previewWidth} onChange={setPreviewWidth} t={t}>
        <div className="email-canvas" style={{ width: previewWidth, backgroundColor: doc.background, padding: doc.paddingSides ? insetsCss(doc.paddingSides) : '16px', fontFamily: doc.fontFamily ?? 'Arial,Helvetica,sans-serif', backgroundImage: doc.backgroundImage ? `url("${doc.backgroundImage.url}")` : undefined, backgroundRepeat: doc.backgroundImage?.repeat, backgroundSize: doc.backgroundImage?.size, backgroundPosition: doc.backgroundImage?.position }} onDragOver={e => {
          const destination = canvasDestination(e);
          e.preventDefault(); e.stopPropagation();
          e.dataTransfer.dropEffect = destination ? (dragSource.current?.id ? 'move' : 'copy') : 'none';
          setDropPreview(destination?.preview ?? null);
        }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropPreview(null); }} onDrop={e => {
          const destination = canvasDestination(e);
          e.preventDefault(); e.stopPropagation(); setDropPreview(null);
          if (destination) drop(e, destination.parent, destination.index);
        }}>
          {dropPreview && <div className="drop-indicator" data-drop-parent={dropPreview.parent ?? ''} aria-hidden="true" style={{ left: dropPreview.left, top: dropPreview.top, width: dropPreview.width, height: dropPreview.height }}/>}
          <div style={{ position: 'relative', maxWidth: doc.width, margin: '0 auto' }}>{doc.nodes.map((n, i) => <div key={n.id} style={{ position: 'relative' }}>{dropZone(null, i)}{canvasNode(n)}</div>)}{dropZone(null, doc.nodes.length)}</div>
          {!doc.nodes.length && <button className="empty-canvas" onClick={() => add('section')}><Plus size={22}/>{t('addBlock')}</button>}
        </div>
        </PreviewViewport>
      </main>
      <aside className="inspector"><div className="inspector-title"><h2>{t(selected ? selected.kind : 'document')}</h2>{selected && <button className="icon-button" aria-label={t('delete')} onClick={() => { try { commit(deleteNode(doc, selected.id)); setSelection(null); } catch (e) { setError((e as Error).message); } }}><Trash2 size={16}/></button>}</div>
        {selected ? <>
          <div className="node-actions"><button aria-label={t('moveUp')} onClick={() => move(selected.id, -1)}><ChevronUp size={16}/></button><button aria-label={t('moveDown')} onClick={() => move(selected.id, 1)}><ChevronDown size={16}/></button><button aria-label={t('duplicate')} onClick={copyNode}><Copy size={16}/></button><button aria-label={t('saveSection')} onClick={() => void run(async () => {
            const sectionName = prompt(t('name'), t(selected.kind)); if (!sectionName) return;
            const n = cloneNode(selected); const document = { ...doc, nodes: n.kind === 'column' ? [{ ...node('row'), children: [n] }] : [n] };
            onSave(await api<TemplateRecord>('/templates', { method: 'POST', body: JSON.stringify({ name: sectionName, kind: 'section', document }) }));
            setNotice('saved');
          })}><Save size={16}/></button></div>
          <div className="breadcrumbs"><button onClick={() => setSelection(null)}>{t('document')}</button><span>/</span><span>{t(selected.kind)}</span></div>
          {['text', 'heading', 'button'].includes(selected.kind) && <><Field label={t(selected.rich ? 'formattedContent' : 'content')}><textarea ref={textInput} rows={5} value={selected.text} onChange={e => change(selected.id, n => { n.text = e.target.value; })}/></Field><div className="format-controls">{(['strong', 'em', 'u'] as const).map((tag, i) => <button key={tag} title={t(['bold', 'italic', 'underline'][i])} onClick={() => { const area = textInput.current; if (!area) return; const a = area.selectionStart, b = area.selectionEnd; change(selected.id, n => { n.text = `${n.text.slice(0, a)}<${tag}>${n.text.slice(a, b)}</${tag}>${n.text.slice(b)}`; }); }}><span style={{ fontWeight: i === 0 ? 700 : undefined, fontStyle: i === 1 ? 'italic' : undefined, textDecoration: i === 2 ? 'underline' : undefined }}>{t(['bold', 'italic', 'underline'][i])}</span></button>)}</div></>}
          {['image', 'button'].includes(selected.kind) && <LinkField key={selected.id} label={t('link')} value={selected.href} apply={href => change(selected.id, n => { n.href = href; })}/>}
          {selected.kind === 'image' && <><button onClick={() => setModal('images')}><Image size={16}/>{t('chooseImage')}</button><Field label={t('alt')}><input value={selected.alt} onChange={e => change(selected.id, n => { n.alt = e.target.value; })}/></Field>{styleNumber('width', 5, 100)}</>}
          {selected.kind === 'row' && <><button onClick={() => add('column', selected.id)}><Plus size={15}/>{t('addColumn')}</button><label className="checkbox"><input type="checkbox" checked={selected.style.stack} onChange={e => change(selected.id, n => { n.style.stack = e.target.checked; })}/>{t('stack')}</label>{selectStyle('distribution', ['start', 'center', 'end', 'between'])}</>}
          {selected.kind === 'column' && <><Field label={`${t('width')} (%)`}><input type="range" min={5} max={100} value={selected.style.width} onChange={e => change(selected.id, n => { n.style.width = Number(e.target.value); })}/></Field>{styleNumber('width', 5, 100)}</>}
          {selectStyle('align', ['left', 'center', 'right'])}{isContainer(selected) && selectStyle('vertical', ['top', 'middle', 'bottom'])}
          <div className="field-grid">{styleNumber('padding', 0, 100)}{isContainer(selected) ? styleNumber('gap', 0, 80) : selected.kind === 'spacer' ? styleNumber('height', 0, 400) : styleNumber('fontSize', 10, 72)}{styleNumber('border', 0, 8)}{styleNumber('radius', 0, 40)}</div>
          {styleColor('background')}{styleColor('color')}{styleColor('borderColor')}
          <details><summary>{t('advancedFormatting')}</summary>
            <Field label={t('fontFamily')}><input value={selected.style.fontFamily ?? doc.fontFamily ?? 'Arial'} maxLength={200} onChange={e => { if (/^[\w\s,'"-]{1,200}$/.test(e.target.value)) change(selected.id, n => { n.style.fontFamily = e.target.value; }); }}/></Field>
            <Field label={t('paragraphSpacing')}><input type="number" min={0} max={100} value={selected.style.paragraphSpacing ?? 16} onChange={e => change(selected.id, n => { n.style.paragraphSpacing = Math.max(0, Math.min(100, Number(e.target.value))); })}/></Field>
            {(['paddingSides', 'marginSides', 'corners'] as const).map(key => <fieldset key={key}><legend>{t(key)}</legend><div className="field-grid">{[0, 1, 2, 3].map(i => <Field key={i} label={t(key === 'corners' ? ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'][i] : ['top', 'right', 'bottom', 'left'][i])}><input type="number" min={0} max={1000} value={(selected.style[key] ?? (key === 'paddingSides' ? paddingInsets(selected.style) : key === 'corners' ? Array(4).fill(selected.style.radius) : [0, 0, 0, 0]))[i]} onChange={e => change(selected.id, n => { const values = [...(n.style[key] ?? (key === 'paddingSides' ? paddingInsets(n.style) : key === 'corners' ? Array(4).fill(n.style.radius) : [0, 0, 0, 0]))] as [number, number, number, number]; values[i] = Math.max(0, Math.min(1000, Number(e.target.value))); n.style[key] = values; })}/></Field>)}</div></fieldset>)}
            <label className="checkbox"><input type="checkbox" checked={selected.style.background === 'transparent'} onChange={e => change(selected.id, n => { n.style.background = e.target.checked ? 'transparent' : '#ffffff'; })}/>{t('transparentBackground')}</label>
            <label className="checkbox"><input type="checkbox" checked={selected.style.hiddenOnMobile ?? false} onChange={e => change(selected.id, n => { n.style.hiddenOnMobile = e.target.checked; })}/>{t('hiddenOnMobile')}</label>
            <Field label={t('opacity')}><input type="range" min={0} max={1} step={0.05} value={selected.style.opacity ?? 1} onChange={e => change(selected.id, n => { n.style.opacity = Number(e.target.value); })}/></Field>
            {selected.kind === 'image' && <Field label={t('imagePixelWidth')}><input type="number" min={1} max={2000} value={selected.style.imageWidth ?? ''} onChange={e => change(selected.id, n => { n.style.imageWidth = e.target.value ? Math.max(1, Math.min(2000, Number(e.target.value))) : undefined; })}/></Field>}
          </details>
          <Field label={t('moveTo')}><select value="" onChange={e => { if (e.target.value) { try { const id = e.target.value === 'root' ? null : e.target.value; const target = id ? walk(doc.nodes).find(n => n.id === id)!.children : doc.nodes; commit(moveNode(doc, selected.id, id, target.length)); } catch (e) { setError((e as Error).message); } } }}><option value="">{t('moveTo')}</option>{selected.kind !== 'column' && <option value="root">{t('root')}</option>}{walk(doc.nodes).filter(n => isContainer(n) && !walk([selected]).some(c => c.id === n.id) && (selected.kind === 'column' ? n.kind === 'row' : n.kind !== 'row')).map((n, i) => <option key={n.id} value={n.id}>{t(n.kind)} {i + 1}</option>)}</select></Field>
        </> : <>
          <Field label={t('subject')}><input value={doc.subject} maxLength={200} onChange={e => commit({ ...doc, subject: e.target.value })}/></Field>
          <Field label={t('preheader')}><textarea rows={3} maxLength={300} value={doc.preheader} onChange={e => commit({ ...doc, preheader: e.target.value })}/></Field>
          <Field label={t('width')}><input type="number" min={320} max={1000} value={doc.width} onChange={e => commit({ ...doc, width: Math.max(320, Math.min(1000, Number(e.target.value))) })}/></Field>
          <Field label={t('background')}><input type="color" value={doc.background} onChange={e => commit({ ...doc, background: e.target.value })}/></Field>
          <Field label={t('kind')}><select value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="draft">{t('draft')}</option><option value="template">{t('template')}</option><option value="section">{t('section')}</option></select></Field>
          <Field label={t('collection')}><select value={collectionId ?? ''} onChange={e => setCollection(e.target.value || null)}><option value="">{t('none')}</option>{collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <p className="muted">{t('selectHint')}</p><button onClick={() => void save()}><Save size={16}/>{t('save')}</button>
        </>}
      </aside>
    </div>
    {notice && <div className="toast" role="status" onClick={() => setNotice('')}>{t(notice)}</div>}
    {modal && <Dialog t={t} title={t(modal === 'images' ? 'assets' : modal)} wide close={() => { if (!busy) { setModal(null); setManual(''); } }}>
      {modal === 'images' ? <ImageLibrary t={t} notify={setError} select={id => { if (selected?.kind === 'image') change(selected.id, n => { n.assetId = id; delete n.remoteSrc; }); setModal(null); }}/> : <>
        <div className="preview-toolbar"><strong>{t('clipboardPreview')}</strong><PreviewSizeControls width={previewWidth} desktopWidth={desktopPreviewWidth} onChange={setPreviewWidth} t={t}/></div>
        <p className="muted">{t('previewHint')}</p>
        {warnings.map(w => <p key={w} className="notice">{t(w)}</p>)}
        <ErrorNotice error={error} t={t}/>
        <div className="export-options"><div><button className="primary" disabled={busy} onClick={() => void run(() => exportEmail('copy'))}><Clipboard size={17}/>{t(busy ? 'busy' : 'copyEmail')}</button><p>{t('copyHint')}</p></div><details><summary>{t('otherFormats')}</summary><button disabled={busy} onClick={() => void run(() => exportEmail('eml'))}><Download size={17}/>{t('downloadEml')}</button><p>{t('emlHint')}</p><div className="export-links"><button disabled={busy} onClick={() => void run(() => exportEmail('html'))}>{t('downloadHtml')}</button><button disabled={busy} onClick={() => void run(() => exportEmail('archive'))}>{t('downloadArchive')}</button></div></details></div>
        {manual && <div className="notice"><p>{t('manualCopy')}</p><button onClick={() => { const body = manualFrame.current?.contentDocument?.body; if (!body) return; const range = document.createRange(); range.selectNodeContents(body); const sel = manualFrame.current?.contentWindow?.getSelection(); sel?.removeAllRanges(); sel?.addRange(range); manualFrame.current?.focus(); }}>{t('selectAll')}</button></div>}
        <div className="preview-stage"><PreviewViewport width={previewWidth} onChange={setPreviewWidth} t={t}><iframe ref={manualFrame} title={t('preview')} sandbox="allow-same-origin" style={{ width: '100%' }} srcDoc={manual ? `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0">${manual}</body></html>` : preview}/></PreviewViewport></div>
      </>}
    </Dialog>}
  </div>;
}
function SettingsIcon() { return <Square size={16}/>; }
function LinkField({ label, value, apply }: { label: string; value: string; apply: (s: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <Field label={label}><input type="text" value={draft} placeholder="https://" onChange={e => setDraft(e.target.value)} onBlur={() => apply(draft.trim())}/></Field>;
}
