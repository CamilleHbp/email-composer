import type { EmailDocument, EmailNode } from './model';
import { walk } from './model';

export const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
// A deliberately small rich-text vocabulary, shared by editor and email compiler.
export function richText(text: string): string {
  return escape(text).replace(/\n/g, '<br/>')
    .replace(/&lt;(\/?)(strong|em|u)&gt;/g, '<$1$2>');
}
export function plainText(text: string): string { return text.replace(/<\/?(strong|em|u)>/g, ''); }
const table = (content: string, extra = '') => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ${extra}><tbody>${content}</tbody></table>`;
export interface RenderOptions { assets: Record<string, string>; clipboard?: boolean; containerWidth?: number }
function imageUrl(url: string | undefined): string {
  // The standalone development server publishes images on its loopback origin.
  const localAsset = /^http:\/\/localhost:5173\/api\/dev-assets\/published\/[a-f0-9-]+\/[a-f0-9-]+\.png$/;
  return url && (/^(https:\/\/|cid:)/.test(url) || /^\/api\/assets\/[a-f0-9-]+\/content$/.test(url) || localAsset.test(url)) ? escape(url) : '';
}
export function renderNode(n: EmailNode, options: RenderOptions, css: string[]): string {
  const s = n.style;
  const common = `padding:${s.padding}px;background-color:${s.background};color:${s.color};font-size:${s.fontSize}px;font-family:Arial,Helvetica,sans-serif;line-height:1.5;text-align:${s.align};vertical-align:${s.vertical};border:${s.border}px solid ${s.borderColor};border-radius:${s.radius}px;`;
  let body = '';
  const available = Math.max(40, (options.containerWidth ?? 640) - s.padding * 2);
  if (n.kind === 'row') {
    const sum = Math.max(100, n.children.reduce((a, c) => a + c.style.width, 0));
    const unused = Math.max(0, 100 - n.children.reduce((a, c) => a + c.style.width / sum * 100, 0));
    const klass = `col-${n.id}`;
    if (s.stack && !options.clipboard) css.push(`@media only screen and (max-width:480px){.${klass}{display:block!important;width:100%!important;box-sizing:border-box!important}.${klass}-gap{display:none!important}}`);
    const gap = s.gap;
    const columnSpace = Math.max(0, available - gap * Math.max(0, n.children.length - 1));
    const fill = (percent: number) => percent > 0 ? `<td width="${percent}%" style="width:${percent}%;font-size:0;">&nbsp;</td>` : '';
    const leading = s.distribution === 'end' ? unused : s.distribution === 'center' ? unused / 2 : 0;
    const trailing = s.distribution === 'start' ? unused : s.distribution === 'center' ? unused / 2 : 0;
    const cells = n.children.map((c, i) => {
      const content = renderNode(c, { ...options, containerWidth: columnSpace * c.style.width / sum }, css);
      // Clipboard output uses fluid inline-block columns: wrapping does not need head CSS.
      if (options.clipboard && s.stack) return `<div style="display:inline-block;vertical-align:${c.style.vertical};width:100%;max-width:${Math.floor(columnSpace * c.style.width / sum)}px;margin-right:${i < n.children.length - 1 ? gap : 0}px;">${content}</div>`;
      const between = i && s.distribution === 'between' ? fill(unused / Math.max(1, n.children.length - 1)) : '';
      return `${between}${i && gap ? `<td class="${klass}-gap" width="${gap}" style="width:${gap}px;font-size:0;">&nbsp;</td>` : ''}<td class="${klass}" width="${c.style.width / sum * 100}%" valign="${c.style.vertical}" style="vertical-align:${c.style.vertical};">${content}</td>`;
    }).join('');
    body = options.clipboard && s.stack ? `<div style="font-size:0;text-align:${s.distribution === 'center' ? 'center' : s.distribution === 'end' ? 'right' : 'left'};">${cells}</div>` : table(`<tr>${fill(leading)}${cells}${fill(trailing)}</tr>`);
  } else if (n.kind === 'section' || n.kind === 'column') {
    body = table(n.children.map((c, i) => `${i && s.gap ? `<tr><td height="${s.gap}" style="height:${s.gap}px;font-size:0;">&nbsp;</td></tr>` : ''}<tr><td>${renderNode(c, { ...options, containerWidth: available }, css)}</td></tr>`).join(''));
  } else if (n.kind === 'image') {
    const url = imageUrl(n.assetId ? options.assets[n.assetId] : undefined);
    body = url ? `<img src="${url}" alt="${escape(n.alt)}" width="${Math.round(available * s.width / 100)}" style="display:block;width:${s.width}%;max-width:100%;height:auto;border:0;margin:${s.align === 'center' ? '0 auto' : s.align === 'right' ? '0 0 0 auto' : '0'};"/>` : `<span>${escape(n.alt)}</span>`;
    if (url && /^https?:\/\//i.test(n.href)) body = `<a href="${escape(n.href)}">${body}</a>`;
  } else if (n.kind === 'heading') body = `<h2 style="margin:0;font-size:${s.fontSize}px;line-height:1.2;font-weight:700;">${richText(n.text)}</h2>`;
  else if (n.kind === 'text') body = `<div>${richText(n.text)}</div>`;
  else if (n.kind === 'button') body = `<a href="${escape(n.href)}" style="display:inline-block;color:${s.color};text-decoration:none;font-weight:700;">${richText(n.text)}</a>`;
  else if (n.kind === 'divider') body = `<div style="border-top:1px solid ${s.borderColor};font-size:0;line-height:0;">&nbsp;</div>`;
  else body = `<div style="height:${s.height}px;line-height:${s.height}px;">&nbsp;</div>`;
  return table(`<tr><td style="${common}">${body}</td></tr>`);
}
export function renderEmail(doc: EmailDocument, options: RenderOptions) {
  const css: string[] = [];
  const contents = doc.nodes.map(n => renderNode(n, { ...options, containerWidth: doc.width }, css)).join('');
  const fragment = `<div style="background-color:${doc.background};padding:16px;"><div style="max-width:${doc.width}px;margin:0 auto;">${contents}</div></div>`;
  // MJML owns the outer responsive shell. Nested layouts are valid presentation
  // tables inside an ending component, never invalid nested mj-section elements.
  const mjml = `<mjml><mj-head><mj-title>${escape(doc.subject)}</mj-title><mj-preview>${escape(doc.preheader)}</mj-preview><mj-style>${css.join('\n')}</mj-style></mj-head><mj-body width="${doc.width}px" background-color="${doc.background}"><mj-section padding="16px 0"><mj-column padding="0"><mj-table padding="0"><tr><td>${contents}</td></tr></mj-table></mj-column></mj-section></mj-body></mjml>`;
  const text = [doc.subject, ...walk(doc.nodes).filter(n => ['heading', 'text', 'button'].includes(n.kind)).map(n => plainText(n.text) + (n.kind === 'button' ? `\n${n.href}` : ''))].filter(Boolean).join('\n\n');
  const warnings = [...new Set(walk(doc.nodes).flatMap(n => n.kind === 'image' ? [...(!n.assetId || !options.assets[n.assetId] ? ['missing_image'] : []), ...(!n.alt.trim() ? ['missing_alt'] : [])] : []))];
  return { mjml, fragment, text, warnings };
}
