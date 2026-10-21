import { z } from 'zod';
import { cssColorPattern, fontPattern } from './formatting';

export const kinds = ['section', 'row', 'column', 'heading', 'text', 'image', 'button', 'divider', 'spacer'] as const;
export type Kind = typeof kinds[number];
const color = z.string().regex(cssColorPattern);
const insets = z.tuple([z.number().min(0).max(1000), z.number().min(0).max(1000), z.number().min(0).max(1000), z.number().min(0).max(1000)]);
export const backgroundImageSchema = z.object({ url: z.url().max(2048).refine(v => v.startsWith('https://') && !/[\s"'()<>\\]/.test(v)), repeat: z.enum(['repeat', 'no-repeat']), size: z.enum(['unset', 'cover', 'contain']), position: z.enum(['top', 'center', 'bottom', 'left', 'right']) });
const borderSide = z.object({ width: z.number().min(0).max(20), style: z.enum(['solid', 'dashed', 'dotted']), color });
export const styleSchema = z.object({
  paddingSides: insets.optional(), marginSides: insets.optional(), corners: insets.optional(),
  fontFamily: z.string().regex(fontPattern).optional(), lineHeight: z.number().min(0.5).max(5).optional(),
  paragraphSpacing: z.number().min(0).max(100).optional(), hiddenOnMobile: z.boolean().optional(),
  opacity: z.number().min(0).max(1).optional(), backgroundImage: backgroundImageSchema.optional(),
  borderSides: z.object({ top: borderSide.optional(), right: borderSide.optional(), bottom: borderSide.optional(), left: borderSide.optional() }).optional(),
  imageWidth: z.number().min(1).max(2000).optional(), imageHeight: z.number().min(1).max(2000).optional(),
  dividerHeight: z.number().min(0).max(20).optional(), minHeight: z.number().min(0).max(2000).optional(),
  hug: z.boolean().optional(), mobileBreakpoint: z.number().min(320).max(1000).optional(),
  padding: z.number().min(0).max(100).default(16),
  gap: z.number().min(0).max(80).default(16),
  background: color.default('#ffffff'),
  color: color.default('#243d35'),
  fontSize: z.number().min(10).max(72).default(16),
  align: z.enum(['left', 'center', 'right']).default('left'),
  vertical: z.enum(['top', 'middle', 'bottom']).default('top'),
  distribution: z.enum(['start', 'center', 'end', 'between']).default('start'),
  width: z.number().min(5).max(100).default(50),
  height: z.number().min(0).max(400).default(24),
  border: z.number().min(0).max(8).default(0),
  borderColor: color.default('#dce4df'),
  radius: z.number().min(0).max(40).default(0),
  stack: z.boolean().default(true),
});
export type NodeStyle = z.infer<typeof styleSchema>;
export interface EmailNode {
  id: string;
  kind: Kind;
  text: string;
  href: string;
  assetId?: string;
  remoteSrc?: string;
  rich?: boolean;
  alt: string;
  style: NodeStyle;
  children: EmailNode[];
}
export const nodeSchema: z.ZodType<EmailNode> = z.lazy(() => z.object({
  id: z.string().uuid(),
  kind: z.enum(kinds),
  rich: z.boolean().optional(),
  text: z.string().max(50000),
  href: z.string().max(2048).refine(v => !v || /^(https?:\/\/|mailto:|tel:)/i.test(v), 'unsafe_link'),
  assetId: z.string().uuid().optional(),
  remoteSrc: z.url().max(2048).refine(v => v.startsWith('https://'), 'unsafe_image').optional(),
  alt: z.string().max(500),
  style: styleSchema,
  children: z.array(nodeSchema).max(100),
}));
export const documentSchema = z.object({
  version: z.literal(1),
  paddingSides: insets.optional(),
  fontFamily: z.string().regex(fontPattern).optional(),
  backgroundImage: backgroundImageSchema.optional(),
  subject: z.string().max(200),
  preheader: z.string().max(300),
  width: z.number().int().min(320).max(1000),
  background: color,
  nodes: z.array(nodeSchema).max(100),
});
export type EmailDocument = z.infer<typeof documentSchema>;
export const isContainer = (n: EmailNode) => ['section', 'row', 'column'].includes(n.kind);
export function walk(nodes: EmailNode[]): EmailNode[] {
  return nodes.flatMap(n => [n, ...walk(n.children)]);
}
export function validateDocument(input: unknown): EmailDocument {
  // Bound recursion before parsing untrusted recursive input.
  const seenObjects = new Set<object>();
  function guard(v: unknown, depth = 0) {
    if (depth > 35) throw new Error('document_too_deep');
    if (v && typeof v === 'object') {
      if (seenObjects.has(v)) throw new Error('invalid_document');
      seenObjects.add(v);
      for (const child of Object.values(v)) guard(child, depth + 1);
    }
  }
  guard(input);
  const doc = documentSchema.parse(input);
  const nodes = walk(doc.nodes);
  if (nodes.length > 500 || new Set(nodes.map(n => n.id)).size !== nodes.length) throw new Error('invalid_document');
  function check(list: EmailNode[], depth: number, parent?: Kind) {
    if (depth > 8) throw new Error('document_too_deep');
    for (const n of list) {
      if (!isContainer(n) && n.children.length) throw new Error('invalid_document');
      if (n.kind === 'row' && (!n.children.length || n.children.some(c => c.kind !== 'column'))) throw new Error('invalid_document');
      if (n.kind === 'column' && parent !== 'row') throw new Error('invalid_document');
      if (parent === 'row' && n.kind !== 'column') throw new Error('invalid_document');
      check(n.children, depth + 1, n.kind);
    }
  }
  check(doc.nodes, 0);
  return doc;
}
export function node(kind: Kind, text = ''): EmailNode {
  const n: EmailNode = {
    id: crypto.randomUUID(), kind, text, href: '', alt: '', style: styleSchema.parse({}), children: [],
  };
  if (kind === 'heading') n.style.fontSize = 30;
  if (kind === 'image') n.style.width = 100;
  if (kind === 'button') { n.style.background = '#264f43'; n.style.color = '#ffffff'; n.href = 'https://example.com'; }
  if (kind === 'row') { n.style.padding = 0; n.children = [node('column'), node('column')]; }
  if (kind === 'column') n.style.padding = 12;
  return n;
}
export function blank(): EmailDocument {
  return { version: 1, subject: '', preheader: '', width: 640, background: '#eef0ec', nodes: [node('section')] };
}
export function locate(nodes: EmailNode[], id: string): { list: EmailNode[]; index: number; parent?: EmailNode } | undefined {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return { list: nodes, index: i };
    const found = locate(nodes[i].children, id);
    if (found) return { ...found, parent: found.parent ?? nodes[i] };
  }
}
export function cloneNode(n: EmailNode): EmailNode {
  return { ...structuredClone(n), id: crypto.randomUUID(), children: n.children.map(cloneNode) };
}
export function moveNode(doc: EmailDocument, id: string, targetId: string | null, index: number): EmailDocument {
  const next = structuredClone(doc);
  const source = locate(next.nodes, id);
  const moving = source?.list[source.index];
  const target = targetId ? walk(next.nodes).find(n => n.id === targetId) : undefined;
  if (!source || !moving || (targetId && (!target || !isContainer(target)))) throw new Error('invalid_move');
  if (targetId && walk([moving]).some(n => n.id === targetId)) throw new Error('invalid_move');
  if (moving.kind === 'column' ? target?.kind !== 'row' : target?.kind === 'row') throw new Error('invalid_move');
  const destination = target ? target.children : next.nodes;
  const adjusted = source.list === destination && source.index < index ? index - 1 : index;
  source.list.splice(source.index, 1);
  destination.splice(Math.max(0, Math.min(adjusted, destination.length)), 0, moving);
  if (source.parent?.kind === 'row' && source.list.length === 0) {
    const emptyRow = locate(next.nodes, source.parent.id)!;
    emptyRow.list.splice(emptyRow.index, 1);
  }
  return validateDocument(next);
}
export function deleteNode(doc: EmailDocument, id: string): EmailDocument {
  const next = structuredClone(doc);
  const found = locate(next.nodes, id);
  if (!found) return next;
  if (found.parent?.kind === 'row' && found.list.length === 1) throw new Error('last_column');
  const item = found.list[found.index];
  // Removing a populated column preserves its contents in a neighbor.
  if (item.kind === 'column' && item.children.length) {
    found.list[found.index === 0 ? 1 : found.index - 1].children.push(...item.children);
  }
  found.list.splice(found.index, 1);
  return validateDocument(next);
}
export function assetIds(doc: EmailDocument): string[] {
  return [...new Set(walk(doc.nodes).flatMap(n => n.assetId ? [n.assetId] : []))];
}
export type TemplateKind = 'draft' | 'template' | 'section';
export interface TemplateRecord {
  importWarnings?: string[];
  id: string; name: string; kind: TemplateKind; document: EmailDocument;
  revision: number; shared: boolean; collectionId: string | null; updatedAt: string;
}
