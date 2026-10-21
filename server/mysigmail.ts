import { z } from 'zod';
import { formattedText, cssColorPattern, fontPattern } from '../shared/formatting';
import { backgroundImageSchema } from '../shared/model';
import { node, validateDocument, type EmailNode, type EmailDocument } from '../shared/model';

// Format reference: mysigmail/card src/entities/{template,block}/types.ts.
// Convert data only; never execute imported markup or fetch its URLs.
const settings = z.record(z.string(), z.unknown()).default({});
const text = z.string().max(50000);
const atom = z.object({
  type: z.enum(['text', 'button', 'image', 'divider']), value: text.optional(),
  src: z.string().optional(), link: z.string().max(2048).optional(),
  alt: z.string().max(500).optional(), width: z.number().optional(),
}).passthrough();
type Row = { settings: Record<string, unknown>; cells: { settings: Record<string, unknown>; children: (z.infer<typeof atom> | Row)[] }[] };
const row: z.ZodType<Row> = z.lazy(() => z.object({
  type: z.literal('row').optional(), settings,
  cells: z.array(z.object({ settings, children: z.array(z.union([atom, row])).max(100) })).min(1).max(20),
}));
const format = z.object({
  version: z.literal(1), meta: z.object({ title: z.string().max(500) }),
  editor: z.object({ general: z.object({ background: z.object({ color: z.string() }).passthrough(), previewText: z.string().max(300).default('') }).passthrough() }),
  canvas: z.object({ components: z.array(z.object({ version: z.literal(1), block: z.object({ settings, rows: z.array(row).max(100) }) })).max(100) }),
});
const number = (v: unknown, fallback: number, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
function color(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  if (cssColorPattern.test(v)) return v;
  return fallback;
}
function link(v: unknown) {
  return typeof v === 'string' && /^(https?:\/\/|mailto:|tel:)/i.test(v.trim()) ? v.trim() : '';
}
function style(n: EmailNode, s: Record<string, unknown>, background: string, align: EmailNode['style']['align'] = 'left') {
  const spacing = s.spacing as { padding?: unknown[] } | undefined;
  const padding = spacing?.padding ?? (Array.isArray(s.padding) ? s.padding : undefined);
  n.style.padding = 0;
  if (padding?.length === 4) n.style.paddingSides = padding.map(v => number(v, 0, 0, 1000)) as [number, number, number, number];
  const margin = (s.spacing as { margin?: unknown[] } | undefined)?.margin;
  if (margin?.length === 4) n.style.marginSides = margin.map(v => number(v, 0, 0, 1000)) as [number, number, number, number];
  const corners = s.borderRadius as Record<string, unknown> | undefined;
  if (corners) n.style.corners = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'].map(k => number(corners[k], 0, 0, 1000)) as [number, number, number, number];
  n.style.mobileBreakpoint = 600;
  n.style.hiddenOnMobile = s.hiddenOnMobile === true;
  n.style.opacity = number(s.opacity, 1, 0, 1);
  n.style.paragraphSpacing = s.paragraphSpacing !== undefined ? number(s.paragraphSpacing, 0, 0, 100) : n.kind === 'text' && ['widthMode', 'borderRadius', 'border'].some(key => s[key] !== undefined) ? 0 : undefined;
  n.style.minHeight = number(s.height, 0, 0, 2000);
  n.style.hug = s.widthMode === 'hug';
  if (s.backgroundImage && (s.backgroundImage as { url?: string }).url) n.style.backgroundImage = backgroundImageSchema.parse(s.backgroundImage);
  if (s.border && typeof s.border === 'object') {
    const sides: NonNullable<EmailNode['style']['borderSides']> = {};
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const b = (s.border as Record<string, { width?: number; style?: string; color?: string }>)[side];
      if (b) sides[side] = { width: number(b.width, 0, 0, 20), style: b.style === 'dotted' || b.style === 'dashed' ? b.style : 'solid', color: color(b.color, '#000000') };
    }
    n.style.borderSides = sides;
  }
  n.style.gap = number(s.gap, 0, 0, 80);
  n.style.background = color(s.backgroundColor, 'transparent');
  n.style.align = ['left', 'center', 'right'].includes(String(s.horizontalAlign)) ? s.horizontalAlign as typeof align : align;
  n.style.vertical = ['top', 'middle', 'bottom'].includes(String(s.verticalAlign)) ? s.verticalAlign as EmailNode['style']['vertical'] : 'top';
  n.style.radius = number((s.borderRadius as { topLeft?: number } | undefined)?.topLeft, 0, 0, 40);
  n.style.stack = s.collapseOnMobile !== false;
}
export function importMySigmail(bytes: Uint8Array): { name: string; document: EmailDocument; importWarnings: string[] } {
  if (bytes.byteLength > 2 * 1024 * 1024) throw new Error('mysigmail_too_large');
  try {
    const input: unknown = JSON.parse(new TextDecoder().decode(bytes).replace(/^\uFEFF/, ''));
    // Check before the recursive schema to avoid stack exhaustion.
    let count = 0;
    function guard(value: unknown, depth = 0) {
      if (depth > 28 || ++count > 30000) throw new Error('invalid_mysigmail');
      if (value && typeof value === 'object') Object.values(value).forEach(v => guard(v, depth + 1));
    }
    guard(input);
    const source = format.parse(input);
    const importWarnings = new Set<string>();
    function resolveImage(value: string): string | undefined {
      try {
        const url = new URL(value);
        if (url.href.length <= 2048 && url.protocol === 'https:' && !url.username && !url.password) return url.href;
      } catch { /* Relative, missing and malformed sources become placeholders. */ }
      importWarnings.add('mysigmail_images_unavailable');
      return undefined;
    }
    function resolveBackground(s: Record<string, unknown>) {
      const bg = s.backgroundImage as { url?: unknown } | undefined;
      if (!bg || !bg.url) return;
      const url = typeof bg.url === 'string' ? resolveImage(bg.url) : undefined;
      const parsed = backgroundImageSchema.safeParse({ ...bg, url });
      if (parsed.success) s.backgroundImage = parsed.data;
      else { delete s.backgroundImage; importWarnings.add('mysigmail_images_unavailable'); }
    }
    function resolveRows(rows: Row[]) {
      for (const r of rows) {
        resolveBackground(r.settings);
        for (const c of r.cells) {
          resolveBackground(c.settings);
          for (const child of c.children) if ('cells' in child) resolveRows([child as Row]);
        }
      }
    }
    for (const component of source.canvas.components) { resolveBackground(component.block.settings); resolveRows(component.block.rows); }
    function convertRow(r: Row, align: EmailNode['style']['align'] = 'left'): EmailNode {
      const result = node('row'); style(result, r.settings, 'transparent', align);
      const weights = r.cells.map(c => number(c.settings.width, 100 / r.cells.length, 1, 100));
      const sum = weights.reduce((a, b) => a + b, 0);
      result.children = r.cells.map((c, index) => {
        const column = node('column'); style(column, c.settings, result.style.background);
        column.style.width = Math.max(5, weights[index] / sum * 100);
        column.children = c.children.flatMap(child => {
          if ('cells' in child) return [convertRow(child as Row, column.style.align)];
          const a = child as z.infer<typeof atom>;
          const n = node(a.type); style(n, a, column.style.background, column.style.align);
          n.href = link(a.link);
          if (a.type === 'text' || a.type === 'button') {
            if (a.value === undefined) throw new Error('invalid_mysigmail');
            n.rich = true;
            n.text = formattedText(a.value, n.style.paragraphSpacing, false);
            return [n];
          }
          if (a.type === 'image') {
            n.remoteSrc = resolveImage(a.src ?? ''); n.alt = a.alt ?? '';
            n.style.width = 100;
            if (a.width) n.style.imageWidth = number(a.width, 100, 1, 2000);
            if (a.height) n.style.imageHeight = number(a.height, 100, 1, 2000);
          }
          if (a.type === 'divider') { n.style.borderColor = color(a.color, '#dce4df'); n.style.dividerHeight = number(a.height, 1, 0, 20); }
          return [n];
        });
        return column;
      });
      return result;
    }
    const document: EmailDocument = {
      version: 1, subject: '',
      fontFamily: typeof source.editor.general.font === 'string' && fontPattern.test(source.editor.general.font) ? source.editor.general.font : 'Arial',
      paddingSides: Array.isArray(source.editor.general.padding) && source.editor.general.padding.length === 4 ? source.editor.general.padding.map(v => number(v, 0, 0, 1000)) as [number, number, number, number] : undefined,
      preheader: source.editor.general.previewText, width: 600,
      background: color(source.editor.general.background.color, '#ffffff'),
      nodes: source.canvas.components.map(c => {
        const section = node('section'); style(section, c.block.settings, '#ffffff');
        section.children = c.block.rows.map(r => convertRow(r));
        return section;
      }),
    };
    const bg = source.editor.general.background as { image?: string; repeat?: string; size?: string; position?: string };
    if (bg.image) {
      const parsed = backgroundImageSchema.safeParse({ url: resolveImage(bg.image), repeat: bg.repeat, size: bg.size, position: bg.position });
      if (parsed.success) document.backgroundImage = parsed.data;
      else importWarnings.add('mysigmail_images_unavailable');
    }
    return { name: source.meta.title.trim().slice(0, 150) || 'MySigmail template', document: validateDocument(document), importWarnings: [...importWarnings] };
  } catch (error) {
    throw new Error('invalid_mysigmail');
  }
}
