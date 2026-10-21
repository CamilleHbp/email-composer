import { useEffect, useRef, useState } from 'react';
import { Mail, LayoutGrid, FileText, Layers, Folder, Plus, Search, ArrowUpRight, Copy, Trash2, Settings, LogOut, Upload, Users, Image, BookOpen, Pencil, Share2 } from 'lucide-react';
import { useLanguage } from './i18n';
import { api } from './api';
import { Dialog, Field, ErrorNotice, ImageLibrary } from './components';
import { starter, starterNames } from '../shared/starters';
import type { TemplateRecord } from '../shared/model';
import { Editor } from './Editor';
import { Thumbnail } from './Thumbnail';

type Identity = { id: string; name: string; email: string; role: string };
type Collection = { id: string; name: string };
export function App() {
  const { t, lang, choice, setChoice } = useLanguage();
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [records, setRecords] = useState<TemplateRecord[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [active, setActive] = useState<TemplateRecord | null>(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<'settings' | 'admin' | 'collection' | 'import' | null>(null);
  const [busy, setBusy] = useState(false);
  const [importSource, setImportSource] = useState<'archive' | 'mysigmail'>('archive');
  const fileInput = useRef<HTMLInputElement>(null);
  const token = new URLSearchParams(location.search).get('token');
  const [redeeming, setRedeeming] = useState(!!token);
  const [accessLink, setAccessLink] = useState('');
  async function load() {
    const [r, c] = await Promise.all([api<TemplateRecord[]>('/templates'), api<Collection[]>('/collections')]);
    setRecords(r); setCollections(c);
  }
  useEffect(() => {
    api<Identity>('/me').then(setIdentity).catch(e => { if (e.message !== 'unauthorized') setError(e.message); }).finally(() => setLoading(false));
  }, []);
  useEffect(() => { if (identity) void load().catch(e => setError(e.message)); }, [identity]);
  useEffect(() => { if (notice) { const id = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(id); } }, [notice]);
  async function action(fn: () => Promise<void>) {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function updated(record: TemplateRecord) {
    setRecords(prev => [record, ...prev.filter(r => r.id !== record.id)]);
  }
  async function duplicate(record: TemplateRecord) {
    const copy = await api<TemplateRecord>(`/templates/${record.id}/duplicate`, { method: 'POST', body: '{}' });
    updated(copy); return copy;
  }
  const language = <Field label={t('language')}><select value={choice} onChange={e => setChoice(e.target.value)}><option value="auto">{t('automatic')}</option><option value="en">English</option><option value="fr">Français</option></select></Field>;
  if (loading) return <main className="loading"><Mail size={32}/><p>{t('busy')}</p></main>;
  if (!identity) return <main className="auth-page">
    <div className="auth-story"><a className="brand" href="/"><Mail size={25}/>Mail Studio<span className="brand-dot"/></a><div><h1>{t('welcome')}</h1><p>{t('welcomeText')}</p><div className="paper-stack" aria-hidden="true"><div className="paper"><span/><b/><i/><i/><div/><em/></div></div></div><p className="auth-foot">mail-studio.camille.studio</p></div>
    <section className="auth-form"><div className="auth-form-inner"><h2>{t(redeeming ? 'redeemTitle' : 'signIn')}</h2><p>{t(redeeming ? 'passwordHint' : 'inviteOnly')}</p>
      <form onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void action(async () => {
        if (redeeming) {
          await api('/redeem', { method: 'POST', body: JSON.stringify({ token, name: data.get('name'), password: data.get('password') }) });
          history.replaceState(null, '', '/'); setRedeeming(false); setNotice('redeemed');
        } else {
          const response = await fetch('/api/auth/sign-in/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: data.get('email'), password: data.get('password') }) });
          if (!response.ok) throw new Error('loginError');
          setIdentity(await api<Identity>('/me'));
        }
      }); }}>
        {redeeming ? <Field label={t('name')}><input name="name" autoComplete="name" required maxLength={100}/></Field> : <Field label={t('email')}><input name="email" type="email" autoComplete="username" required/></Field>}
        <Field label={t('password')}><input name="password" type="password" autoComplete={redeeming ? 'new-password' : 'current-password'} minLength={redeeming ? 12 : undefined} maxLength={128} required/></Field>
        <ErrorNotice error={error} t={t}/>{notice && <p role="status" className="notice">{t(notice)}</p>}
        <button className="primary full" disabled={busy}>{t(busy ? 'busy' : redeeming ? 'redeem' : 'signIn')}<ArrowUpRight size={18}/></button>
      </form>{language}</div></section>
  </main>;
  if (active) return <Editor key={active.id} record={active} collections={collections} sections={records.filter(r => r.kind === 'section')} t={t} lang={lang} onSave={updated} onClose={() => { setActive(null); void load().catch(e => setError(e.message)); }} duplicate={duplicate}/>;
  const filtered = records.filter(r => (filter === 'curated' ? r.shared : !r.shared || (r as unknown as { ownerId: string }).ownerId === identity.id))
    .filter(r => filter === 'all' || filter === 'curated' || filter === 'drafts' && r.kind === 'draft' || filter === 'templates' && r.kind === 'template' || filter === 'sections' && r.kind === 'section' || r.collectionId === filter)
    .filter(r => r.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const isAsset = filter === 'assets';
  const nav = [['all', LayoutGrid], ['drafts', FileText], ['templates', BookOpen], ['sections', Layers], ['curated', Users], ['assets', Image]] as const;
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="/"><Mail size={24}/>Mail Studio<span className="brand-dot"/></a>
      <nav aria-label={t('library')}>{nav.map(([key, Icon]) => <button className={filter === key ? 'nav-item active' : 'nav-item'} onClick={() => setFilter(key)} key={key}><Icon size={18}/>{t(key)}</button>)}</nav>
      <div className="sidebar-label"><span>{t('collections')}</span><button className="icon-button" onClick={() => setModal('collection')} aria-label={t('newCollection')}><Plus size={16}/></button></div>
      <nav>{collections.map(c => <div className="collection-nav" key={c.id}><button className={filter === c.id ? 'nav-item active' : 'nav-item'} onClick={() => setFilter(c.id)}><Folder size={17}/><span>{c.name}</span></button><button className="icon-button" aria-label={`${t('rename')} ${c.name}`} onClick={() => { const name = prompt(t('name'), c.name); if (name) void action(async () => { await api(`/collections/${c.id}`, { method: 'PUT', body: JSON.stringify({ name }) }); await load(); }); }}><Pencil size={13}/></button><button className="icon-button" aria-label={`${t('delete')} ${c.name}`} onClick={() => void action(async () => { await api(`/collections/${c.id}`, { method: 'DELETE' }); setFilter('all'); await load(); })}><Trash2 size={13}/></button></div>)}</nav>
      <div className="sidebar-bottom">{identity.role === 'admin' && <button className="nav-item" onClick={() => setModal('admin')}><Users size={18}/>{t('admin')}</button>}
      <button className="nav-item" onClick={() => setModal('settings')}><Settings size={18}/>{t('settings')}</button><div className="user-row"><span className="avatar">{identity.name[0]?.toUpperCase()}</span><span>{identity.name}</span><button className="icon-button" aria-label={t('signOut')} onClick={() => void action(async () => { await api('/auth/sign-out', { method: 'POST', body: '{}' }); setIdentity(null); })}><LogOut size={17}/></button></div></div>
    </aside>
    <main className="library-main"><header className="library-top"><span>{t(isAsset ? 'assets' : 'library')}</span><div><button disabled={busy} onClick={() => setModal('import')}><Upload size={16}/>{t('import')}</button><button className="primary" disabled={busy} onClick={() => void action(async () => {
      const r = await api<TemplateRecord>('/templates', { method: 'POST', body: JSON.stringify({ name: t('designName'), kind: 'draft', document: starter('blank', lang) }) }); updated(r); setActive(r);
    })}><Plus size={17}/>{t('newDesign')}</button></div></header>
      <input ref={fileInput} type="file" accept={importSource === 'mysigmail' ? '.json,application/json' : '.zip'} hidden onChange={e => { const f = e.target.files?.[0]; if (f) void action(async () => { const form = new FormData(); form.append('file', f); const r = await api<TemplateRecord>(`/imports?source=${importSource}`, { method: 'POST', body: form }); updated(r); setModal(null); setActive(r); }); e.target.value = ''; }}/>
      <ErrorNotice error={error} t={t}/>
      {isAsset ? <><h1>{t('assets')}</h1><ImageLibrary t={t} notify={setError}/></> : <>
      <div className="library-intro"><h1>{t('libraryTitle')}</h1><p>{t('libraryDescription')}</p></div>
      <section className="starters"><h2>{t('startWith')}</h2><div className="starter-grid">{starterNames.map((name, i) => <button className="starter" disabled={busy} key={name} onClick={() => void action(async () => {
        const r = await api<TemplateRecord>('/templates', { method: 'POST', body: JSON.stringify({ name: t(name), kind: 'draft', document: starter(name, lang) }) }); updated(r); setActive(r);
      })}><div className={`starter-preview tone-${i}`}><Thumbnail document={starter(name, lang)}/>{name === 'blank' && <Plus className="blank-plus" size={25}/>}</div><span>{t(name)}<ArrowUpRight size={14}/></span></button>)}</div></section>
      <section className="designs"><div className="section-heading"><h2>{t(filter === 'curated' ? 'curated' : filter === 'sections' ? 'sections' : 'yourDesigns')}</h2><label className="search"><Search size={17}/><input aria-label={t('search')} placeholder={t('search')} value={search} onChange={e => setSearch(e.target.value)}/></label></div>
      {!filtered.length ? <div className="empty-state"><Mail size={30}/><p>{t(search ? 'noResults' : 'empty')}</p></div> : <div className="design-grid">{filtered.map(r => <article className="design-card" key={r.id}>
        <button className="design-preview" aria-label={`${t(r.shared ? 'useTemplate' : 'open')} ${r.name}`} onClick={() => void action(async () => setActive(r.shared ? await duplicate(r) : r))}><Thumbnail document={r.document}/></button>
        <div className="design-meta"><div><h3>{r.name}</h3><small>{t(r.shared ? 'shared' : r.kind)} · {new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(new Date(r.updatedAt))}</small></div>
        <div className="card-actions"><button className="icon-button" disabled={busy} aria-label={t('duplicate')} onClick={() => void action(async () => { await duplicate(r); })}><Copy size={16}/></button>
          {!r.shared && <><button className="icon-button" aria-label={t('rename')} onClick={() => { const name = prompt(t('name'), r.name); if (name) void action(async () => updated(await api(`/templates/${r.id}`, { method: 'PUT', body: JSON.stringify({ ...r, name }) }))); }}><Pencil size={16}/></button><button className="icon-button" aria-label={t('delete')} onClick={() => { if (confirm(t('deleteConfirm'))) void action(async () => { await api(`/templates/${r.id}`, { method: 'DELETE' }); await load(); }); }}><Trash2 size={16}/></button></>}
          {identity.role === 'admin' && (r as unknown as { ownerId: string }).ownerId === identity.id && <button className="icon-button" aria-label={t(r.shared ? 'unshare' : 'share')} onClick={() => void action(async () => updated(await api(`/templates/${r.id}/share`, { method: 'POST', body: JSON.stringify({ shared: !r.shared }) }))) }><Share2 size={16}/></button>}
        </div></div>
      </article>)}</div>}</section></>}
    </main>
    {notice && <div role="status" className="toast">{t(notice)}</div>}
    {modal && <Dialog title={t(modal === 'collection' ? 'newCollection' : modal)} close={() => { setModal(null); setAccessLink(''); }} t={t}>
      {modal === 'import' && <><Field label={t('importSource')}><select value={importSource} disabled={busy} onChange={e => setImportSource(e.target.value as typeof importSource)}><option value="archive">{t('archiveSource')}</option><option value="mysigmail">{t('mysigmailSource')}</option></select></Field>{importSource === 'mysigmail' && <><p className="notice">{t('mysigmailHint')}</p></>}<button className="primary" disabled={busy} onClick={() => fileInput.current?.click()}>{t(busy ? 'busy' : 'chooseImportFile')}</button></>}
      {modal === 'settings' && language}
      {modal === 'collection' && <form onSubmit={e => { e.preventDefault(); const name = new FormData(e.currentTarget).get('name'); void action(async () => { await api('/collections', { method: 'POST', body: JSON.stringify({ name }) }); await load(); setModal(null); }); }}><Field label={t('name')}><input name="name" required autoFocus maxLength={100}/></Field><button className="primary" disabled={busy}>{t('save')}</button></form>}
      {modal === 'admin' && <form onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void action(async () => { const r = await api<{ url: string }>('/admin/links', { method: 'POST', body: JSON.stringify({ email: data.get('email'), purpose: data.get('purpose') }) }); setAccessLink(r.url); }); }}>
        <Field label={t('email')}><input name="email" type="email" required/></Field><Field label={t('admin')}><select name="purpose"><option value="invite">{t('invite')}</option><option value="recover">{t('recover')}</option></select></Field><button className="primary" disabled={busy}>{t('save')}</button>
        {accessLink && <div className="notice"><p>{t('linkReady')}</p><input readOnly value={accessLink} onFocus={e => e.target.select()} aria-label={t('link')}/></div>}
      </form>}
      <ErrorNotice error={error} t={t}/>
    </Dialog>}
  </div>;
}
