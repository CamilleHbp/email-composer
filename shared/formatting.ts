import { parseDocument } from 'htmlparser2';
import type { NodeStyle } from './model';

export const cssColorPattern = /^(?:(?:#[\da-f]{3}|#[\da-f]{4}|#[\da-f]{6}|#[\da-f]{8})|transparent|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0(?:\.\d+)?|1(?:\.0+)?))?\s*\))$/i;
export const fontPattern = /^[\w\s,'"-]{1,200}$/;
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const safeLink = (s: string) => /^(https?:\/\/|mailto:|tel:)/i.test(s.trim()) && !/[\u0000-\u001f]/.test(s) ? s.trim() : '';
const inlineRules: Record<string, RegExp> = {
  color: cssColorPattern, 'background-color': cssColorPattern,
  'font-size': /^(?:\d{1,3}(?:\.\d+)?)(?:px|pt|em|rem|%)$/,
  'font-family': fontPattern, 'font-weight': /^(normal|bold|[1-9]00)$/,
  'font-style': /^(normal|italic|oblique)$/, 'text-decoration': /^(none|underline|line-through)(?: (?:underline|line-through))?$/,
  'letter-spacing': /^-?\d{1,2}(?:\.\d+)?(?:px|em|rem)?$/,
  'margin': /^(?:-?\d{1,4}(?:\.\d+)?(?:px|em|rem|%)?)(?:\s+-?\d{1,4}(?:\.\d+)?(?:px|em|rem|%)?){0,3}$/,
  'padding': /^(?:\d{1,4}(?:\.\d+)?(?:px|em|rem|%)?)(?:\s+\d{1,4}(?:\.\d+)?(?:px|em|rem|%)?){0,3}$/,
  'text-align': /^(left|center|right|justify)$/, 'line-height': /^\d{1,3}(?:\.\d+)?(?:px|em|%)?$/,
};
for (const side of ['top', 'right', 'bottom', 'left']) {
  inlineRules[`margin-${side}`] = /^-?\d{1,4}(?:\.\d+)?(?:px|em|rem|%)?$/;
  inlineRules[`padding-${side}`] = /^\d{1,4}(?:\.\d+)?(?:px|em|rem|%)?$/;
}
export function safeInlineStyle(value: string): string {
  return value.split(';').flatMap(declaration => {
    const at = declaration.indexOf(':'); const key = declaration.slice(0, at).trim().toLowerCase(); const val = declaration.slice(at + 1).trim();
    return inlineRules[key]?.test(val) ? [`${key}:${val}`] : [];
  }).join(';');
}
// Rebuild a small, inert HTML vocabulary. No imported elements/attributes are copied wholesale.
export function formattedText(input: string, paragraphSpacing?: number, applyParagraphLayout = true): string {
  const dom = parseDocument(input.slice(0, 50000));
  function render(n: typeof dom.children[number], depth = 0): string {
    if (depth > 40) return '';
    if (n.type === 'text') return escapeHtml(n.data);
    if (!('children' in n)) return '';
    const tag = 'name' in n ? n.name.toLowerCase() : '';
    if (['script', 'style', 'iframe', 'object', 'svg', 'math', 'template'].includes(tag)) return '';
    const body = n.children.map(c => render(c, depth + 1)).join('');
    if (!['p', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'br', 'a', 'blockquote', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'li', 'ol', 'ul', 'sub', 'sup'].includes(tag)) return body;
    if (tag === 'br' || tag === 'hr') return `<${tag}/>`;
    const attrs = 'attribs' in n ? n.attribs : {};
    const style = safeInlineStyle(attrs.style ?? '');
    // Old Card text uses browser paragraph margins; text boxes specify gaps only
    // between adjacent paragraphs, not after the final paragraph.
    let next = n.next;
    while (next?.type === 'text' && !next.data.trim()) next = next.next;
    const adjacent = next && 'name' in next && next.name === 'p';
    const block = /^(p|h[1-6]|blockquote|ul|ol)$/.test(tag);
    const explicitMargin = /(?:^|;)margin(?:-[a-z]+)?:/.test(style);
    const paragraph = applyParagraphLayout && block && !explicitMargin
      ? paragraphSpacing === undefined ? (tag === 'p' ? 'margin:1em 0;' : '')
        : `margin:0 0 ${tag === 'p' && adjacent ? paragraphSpacing : 0}px;` : '';
    const href = tag === 'a' ? safeLink(attrs.href ?? '') : '';
    return `<${tag}${style || paragraph ? ` style="${escapeHtml(paragraph + style)}"` : ''}${href ? ` href="${escapeHtml(href)}"` : ''}>${body || (tag === 'p' ? '<br/>' : '')}</${tag}>`;
  }
  return dom.children.map(n => render(n)).join('');
}
export function formattedPlainText(input: string): string {
  const dom = parseDocument(formattedText(input));
  function read(n: typeof dom.children[number]): string {
    if (n.type === 'text') return n.data;
    if (!('children' in n)) return '';
    const tag = 'name' in n ? n.name : '';
    const body = n.children.map(read).join('');
    if (tag === 'br') return '\n';
    if (tag === 'a' && 'attribs' in n && n.attribs.href && n.attribs.href !== body) return `${body} (${n.attribs.href})`;
    return body + (/^(p|div|h[1-6]|li|blockquote)$/.test(tag) ? '\n' : '');
  }
  return dom.children.map(read).join('').trim();
}
export const insetsCss = (v: number[]) => v.map(x => `${x}px`).join(' ');
export const paddingInsets = (s: NodeStyle) => s.paddingSides ?? [s.padding, s.padding, s.padding, s.padding];
export function nodeCss(s: NodeStyle): string {
  const background = s.backgroundImage ? `background-image:url(&quot;${escapeHtml(s.backgroundImage.url)}&quot;);background-repeat:${s.backgroundImage.repeat};background-size:${s.backgroundImage.size};background-position:${s.backgroundImage.position};` : '';
  const borders = s.borderSides ? Object.entries(s.borderSides).map(([side, b]) => `border-${side}:${b!.width}px ${b!.style} ${b!.color};`).join('') : '';
  return `padding:${insetsCss(paddingInsets(s))};background-color:${s.background};${background}color:${s.color};font-size:${s.fontSize}px;font-family:${escapeHtml(s.fontFamily ?? 'Arial,Helvetica,sans-serif')};line-height:${s.lineHeight ?? 1.5};text-align:${s.align};vertical-align:${s.vertical};border:${s.border}px solid ${s.borderColor};${borders}border-radius:${s.corners ? insetsCss(s.corners) : `${s.radius}px`};opacity:${s.opacity ?? 1};`;
}
