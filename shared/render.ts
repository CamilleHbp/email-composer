import type { EmailDocument, EmailNode } from './model';
import { walk } from './model';
import { formattedText, formattedPlainText, nodeCss, paddingInsets, insetsCss } from './formatting';

export const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
// A deliberately small rich-text vocabulary, shared by editor and email compiler.
export function richText(text: string, rich = false, paragraphSpacing?: number): string {
  if (rich) return formattedText(text, paragraphSpacing);
  return escape(text).replace(/\n/g, '<br/>')
    .replace(/&lt;(\/?)(strong|em|u)&gt;/g, '<$1$2>');
}
export function plainText(text: string, rich = false): string { if (rich) return formattedPlainText(text); return text.replace(/<\/?(strong|em|u)>/g, ''); }
const table = (content: string, extra = '') => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ${extra}><tbody>${content}</tbody></table>`;
export interface RenderOptions { assets: Record<string, string>; clipboard?: boolean; containerWidth?: number }
function imageUrl(url: string | undefined): string {
  // The standalone development server publishes images on its loopback origin.
  const localAsset = /^http:\/\/localhost:5173\/api\/dev-assets\/published\/[a-f0-9-]+\/[a-f0-9-]+\.png$/;
  return url && (/^(https:\/\/|cid:)/.test(url) || /^\/api\/assets\/[a-f0-9-]+\/content$/.test(url) || localAsset.test(url)) ? escape(url) : '';
}
export function renderNode(n: EmailNode, options: RenderOptions, css: string[]): string {
  const s = n.style;
  const common = n.kind === 'button' && n.rich ? nodeCss({ ...s, paddingSides: [0, 0, 0, 0], background: 'transparent', border: 0, borderSides: undefined, backgroundImage: undefined, opacity: 1, corners: [0, 0, 0, 0] }) : nodeCss(s);
  const mobileClass = `hidden-${n.id}`;
  if (s.hiddenOnMobile) css.push(`@media only screen and (max-width:${s.mobileBreakpoint ?? 480}px){.${mobileClass}{display:none!important;max-height:0!important;overflow:hidden!important;mso-hide:all!important}}`);
  let body = '';
  const padding = paddingInsets(s);
  const available = Math.max(40, (options.containerWidth ?? 640) - padding[1] - padding[3]);
  if (n.kind === 'row') {
    const sum = Math.max(100, n.children.reduce((a, c) => a + c.style.width, 0));
    const unused = Math.max(0, 100 - n.children.reduce((a, c) => a + c.style.width / sum * 100, 0));
    const klass = `col-${n.id}`;
    if (s.stack && !options.clipboard) css.push(`@media only screen and (max-width:${s.mobileBreakpoint ?? 480}px){.${klass}{display:block!important;width:100%!important;box-sizing:border-box!important}.${klass}-gap{display:none!important}}`);
    const gap = s.gap;
    const columnSpace = Math.max(0, available - gap * Math.max(0, n.children.length - 1));
    const fill = (percent: number) => percent > 0 ? `<td width="${percent}%" style="width:${percent}%;font-size:0;">&nbsp;</td>` : '';
    const leading = s.distribution === 'end' ? unused : s.distribution === 'center' ? unused / 2 : 0;
    const trailing = s.distribution === 'start' ? unused : s.distribution === 'center' ? unused / 2 : 0;
    const cells = n.children.map((c, i) => {
      const content = renderNode({ ...c, style: { ...c.style, fontFamily: c.style.fontFamily ?? s.fontFamily } }, { ...options, containerWidth: columnSpace * c.style.width / sum }, css);
      // Clipboard output uses fluid inline-block columns: wrapping does not need head CSS.
      if (options.clipboard && s.stack) return `<div${c.style.hiddenOnMobile ? ` class="hidden-${c.id}"` : ''} style="display:inline-block;vertical-align:${c.style.vertical};width:100%;max-width:${Math.floor(columnSpace * c.style.width / sum) + gap}px;padding:0 ${gap / 2}px;box-sizing:border-box;">${content}</div>`;
      const between = i && s.distribution === 'between' ? fill(unused / Math.max(1, n.children.length - 1)) : '';
      return `${between}${i && gap ? `<td class="${klass}-gap" width="${gap}" style="width:${gap}px;font-size:0;">&nbsp;</td>` : ''}<td class="${klass}${c.style.hiddenOnMobile ? ` hidden-${c.id}` : ''}" width="${c.style.width / sum * 100}%" valign="${c.style.vertical}" style="vertical-align:${c.style.vertical};">${content}</td>`;
    }).join('');
    body = options.clipboard && s.stack ? `<div style="font-size:0;margin:0 -${gap / 2}px;text-align:${s.distribution === 'center' ? 'center' : s.distribution === 'end' ? 'right' : s.align};">${cells}</div>` : table(`<tr>${fill(leading)}${cells}${fill(trailing)}</tr>`);
  } else if (n.kind === 'section' || n.kind === 'column') {
    body = table(n.children.map((c, i) => `${i && s.gap ? `<tr><td height="${s.gap}" style="height:${s.gap}px;font-size:0;">&nbsp;</td></tr>` : ''}<tr><td>${renderNode({ ...c, style: { ...c.style, fontFamily: c.style.fontFamily ?? s.fontFamily } }, { ...options, containerWidth: available }, css)}</td></tr>`).join(''));
  } else if (n.kind === 'image') {
    const url = imageUrl(n.assetId ? options.assets[n.assetId] : n.remoteSrc);
    body = url ? `<img src="${url}" alt="${escape(n.alt)}" width="${Math.round(Math.min(available, s.imageWidth ?? available * s.width / 100))}" style="display:block;width:${s.imageWidth ? `${s.imageWidth}px` : `${s.width}%`};max-width:100%;height:${s.imageHeight ? `${s.imageHeight}px` : 'auto'};border:0;border-radius:${s.corners ? insetsCss(s.corners) : `${s.radius}px`};margin:${s.align === 'center' ? '0 auto' : s.align === 'right' ? '0 0 0 auto' : '0'};"/>` : `<span>${escape(n.alt)}</span>`;
    if (url && /^https?:\/\//i.test(n.href)) body = `<a href="${escape(n.href)}">${body}</a>`;
  } else if (n.kind === 'heading') body = `<h2 style="margin:0;font-size:${s.fontSize}px;line-height:1.2;font-weight:700;">${richText(n.text, n.rich, s.paragraphSpacing)}</h2>`;
  else if (n.kind === 'text') body = `<div>${richText(n.text, n.rich, s.paragraphSpacing)}</div>`;
  else if (n.kind === 'button') body = `<a href="${escape(n.href)}" style="display:inline-block;${n.rich ? nodeCss(s) : `color:${s.color};`}text-decoration:none;font-weight:700;">${richText(n.text, n.rich, s.paragraphSpacing)}</a>`;
  else if (n.kind === 'divider') body = `<div style="border-top:${s.dividerHeight ?? 1}px solid ${s.borderColor};font-size:0;line-height:0;">&nbsp;</div>`;
  else body = `<div style="height:${s.height}px;line-height:${s.height}px;">&nbsp;</div>`;
  let result = table(`<tr><td${s.minHeight ? ` height="${s.minHeight}"` : ''} style="${common}">${body}</td></tr>`, `${s.hiddenOnMobile ? `class="${mobileClass}"` : ''}${s.hug ? ` style="width:auto;max-width:100%;" align="${s.align}"` : ''}`);
  if (s.marginSides) result = table(`<tr><td style="padding:${insetsCss(s.marginSides)}">${result}</td></tr>`, s.hiddenOnMobile ? `class="${mobileClass}"` : '');
  return result;
}
export function renderEmail(doc: EmailDocument, options: RenderOptions) {
  const css: string[] = [];
  const contents = doc.nodes.map(n => renderNode({ ...n, style: { ...n.style, fontFamily: n.style.fontFamily ?? doc.fontFamily } }, { ...options, containerWidth: doc.width }, css)).join('');
  const outerPadding = doc.paddingSides ? insetsCss(doc.paddingSides) : '16px';
  const outerBackground = doc.backgroundImage ? `background-image:url(&quot;${escape(doc.backgroundImage.url)}&quot;);background-size:${doc.backgroundImage.size};background-repeat:${doc.backgroundImage.repeat};background-position:${doc.backgroundImage.position};` : '';
  const fragment = `${css.length ? `<style>${css.join('\n')}</style>` : ''}<div style="background-color:${doc.background};${outerBackground}padding:${outerPadding};"><div style="max-width:${doc.width}px;margin:0 auto;">${contents}</div></div>`;
  // MJML owns the outer responsive shell. Nested layouts are valid presentation
  // tables inside an ending component, never invalid nested mj-section elements.
  const mjml = `<mjml><mj-head><mj-title>${escape(doc.subject)}</mj-title><mj-preview>${escape(doc.preheader)}</mj-preview><mj-style>${css.join('\n')}</mj-style></mj-head><mj-body width="${doc.width}px" background-color="${doc.background}"><mj-section padding="${doc.paddingSides ? insetsCss(doc.paddingSides) : '16px 0'}"${doc.backgroundImage ? ` background-url="${escape(doc.backgroundImage.url)}" background-size="${doc.backgroundImage.size}" background-repeat="${doc.backgroundImage.repeat}" background-position="${doc.backgroundImage.position}"` : ''}><mj-column padding="0"><mj-table padding="0"><tr><td>${contents}</td></tr></mj-table></mj-column></mj-section></mj-body></mjml>`;
  const text = [doc.subject, ...walk(doc.nodes).filter(n => ['heading', 'text', 'button'].includes(n.kind)).map(n => plainText(n.text, n.rich) + (n.kind === 'button' ? `\n${n.href}` : ''))].filter(Boolean).join('\n\n');
  const warnings = [...new Set(walk(doc.nodes).flatMap(n => n.kind === 'image' ? [...(!(n.assetId ? options.assets[n.assetId] : n.remoteSrc) ? ['missing_image'] : []), ...(!n.assetId && n.remoteSrc ? ['external_images'] : []), ...(!n.alt.trim() ? ['missing_alt'] : [])] : []))];
  if ((doc.backgroundImage || walk(doc.nodes).some(n => n.style.backgroundImage)) && !warnings.includes('external_images')) warnings.push('external_images');
  return { mjml, fragment, text, warnings };
}
