import mjml from 'mjml';
import nodemailer from 'nodemailer';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { assetIds, validateDocument, walk, type EmailDocument } from '../shared/model';
import { renderEmail } from '../shared/render';
import type { ObjectStore } from './storage';

export interface ExportAsset { id: string; key: string; mime: string; name: string }
async function exportImages(doc: EmailDocument, assets: ExportAsset[], store: ObjectStore) {
  const ids = assetIds(doc);
  if (ids.length > 100) throw new Error('export_too_large');
  let total = 0;
  const images = [];
  for (const id of ids) {
    const asset = assets.find(a => a.id === id);
    if (!asset) throw new Error('missing_image');
    const content = await store.get(asset.key);
    total += content.byteLength;
    // Bound MIME/ZIP assembly and keep every exported archive importable.
    if (content.byteLength > 10 * 1024 * 1024 || total > 40 * 1024 * 1024) throw new Error('export_too_large');
    images.push({ asset, content });
  }
  return images;
}
export async function compile(doc: EmailDocument, assets: Record<string, string>, clipboard = false) {
  const result = renderEmail(doc, { assets, clipboard });
  const rendered = await mjml(result.mjml, { validationLevel: 'strict' });
  return { ...result, html: rendered.html, warnings: [...result.warnings, ...(Buffer.byteLength(rendered.html) > 102 * 1024 ? ['large_email'] : [])] };
}
export async function embeddedEmail(doc: EmailDocument, assets: ExportAsset[], store: ObjectStore) {
  const urls: Record<string, string> = {};
  const attachments = [];
  for (const { asset: a, content } of await exportImages(doc, assets, store)) {
    urls[a.id] = `cid:${a.id}@mail-studio`;
    attachments.push({ filename: a.name, content: Buffer.from(content), contentType: a.mime, cid: `${a.id}@mail-studio`, contentDisposition: 'inline' as const });
  }
  const output = await compile(doc, urls);
  if (output.warnings.includes('missing_image')) throw new Error('missing_image');
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
  const message = await transport.sendMail({
    subject: doc.subject, html: output.html, text: output.text,
    headers: { 'X-Unsent': '1' }, attachments,
  });
  return message.message as Buffer;
}
export async function archive(doc: EmailDocument, assets: ExportAsset[], store: ObjectStore): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const manifest = [];
  for (const { asset: a, content } of await exportImages(doc, assets, store)) {
    const path = `assets/${a.id}`;
    files[path] = content;
    manifest.push({ id: a.id, path, name: a.name });
  }
  files['template.json'] = strToU8(JSON.stringify({ version: 1, document: doc, assets: manifest }));
  return zipSync(files);
}
export function readArchive(bytes: Uint8Array) {
  let total = 0;
  const files = unzipSync(bytes, { filter: f => {
    total += f.originalSize;
    if (total > 50 * 1024 * 1024 || f.originalSize > 12 * 1024 * 1024) throw new Error('archive_too_large');
    if (f.name !== 'template.json' && !/^assets\/[a-f0-9-]{36}$/.test(f.name)) throw new Error('invalid_archive');
    return true;
  } });
  if (!files['template.json']) throw new Error('invalid_archive');
  const manifest = JSON.parse(strFromU8(files['template.json']));
  if (manifest.version !== 1 || !Array.isArray(manifest.assets) || manifest.assets.length > 100) throw new Error('invalid_archive');
  const doc = validateDocument(manifest.document);
  const images: { oldId: string; name: string; data: Uint8Array }[] = [];
  for (const id of assetIds(doc)) {
    const a = manifest.assets.find((a: { id: string }) => a.id === id);
    if (!a || a.path !== `assets/${id}` || !files[a.path] || typeof a.name !== 'string') throw new Error('invalid_archive');
    images.push({ oldId: id, name: a.name.slice(0, 150), data: files[a.path] });
  }
  return { doc, images };
}
export function remapAssets(doc: EmailDocument, mapping: Record<string, string>) {
  const next = structuredClone(doc);
  for (const n of walk(next.nodes)) if (n.assetId) n.assetId = mapping[n.assetId] ?? n.assetId;
  return next;
}
