import { describe, it, expect } from 'vitest';
import { simpleParser } from 'mailparser';
import { renderEmail } from '../shared/render';
import { blank, node, assetIds } from '../shared/model';
import { archive, readArchive, remapAssets, compile, embeddedEmail } from '../server/email';
import { MemoryStorage } from './helpers';
import { zipSync, strToU8 } from 'fflate';
const id = 'f3c4663c-1e70-4126-ae01-38db2aaef83f';
function fixture() {
  const doc = blank();
  const outer = node('row'), inner = node('row'), image = node('image');
  image.assetId = id; image.alt = 'A photograph';
  inner.children[0].children = [image]; inner.children[1].children = [node('text', '<strong>Hello</strong>')];
  outer.children[0].children = [inner]; outer.children[1].children = [node('button', 'Read more')];
  doc.nodes[0].children = [node('heading', 'Nested newsletter'), outer]; doc.subject = 'Hello';
  return doc;
}
describe('email pipeline', () => {
  it('keeps column gaps in copyable layouts without requiring stylesheet rules', () => {
    const doc = blank();
    doc.width = 640;
    const row = node('row');
    row.style.padding = 0;
    row.style.gap = 24;
    row.style.stack = true;
    doc.nodes = [row];
    const { fragment } = renderEmail(doc, { assets: {}, clipboard: true });
    expect(fragment).toContain('max-width:320px;');
    expect(fragment).toContain('<td style="padding:0 12px;">');
    expect(fragment).not.toContain('margin:0 -');
    expect(fragment).not.toMatch(/<style|@media|display:flex/);
  });
  it('renders local development image exports without accepting arbitrary HTTP image sources', async () => {
    const local = `http://localhost:5173/api/dev-assets/published/${id}/${id}.png`;
    expect((await compile(fixture(), { [id]: local }, true)).fragment).toContain(local);
    for (const invalid of [local.replace('localhost', 'example.com'), local.replace('5173', '8080'), 'javascript:alert(1)']) {
      expect((await compile(fixture(), { [id]: invalid }, true)).fragment).not.toContain(invalid);
    }
  });
  it('compiles nested presentation tables with mobile stacking and no flexbox', async () => {
    const r = await compile(fixture(), { [id]: 'https://assets.example.test/published/photo.png' });
    expect(r.html).toContain('Nested newsletter');
    expect(r.html).toContain('role="presentation"');
    expect(r.html).toContain('max-width:480px');
    expect(r.html).not.toContain('display:flex');
    expect(r.html).not.toContain('javascript:');
    const copy = await compile(fixture(), { [id]: 'https://assets.example.test/published/photo.png' }, true);
    expect(copy.fragment).toContain('https://assets.example.test/published/photo.png');
    expect(copy.fragment).not.toMatch(/blob:|file:|<style/);
  });
  it('embeds every CID without publishing or leaving external image URLs', async () => {
    const store = new MemoryStorage(); await store.put('private/photo', new Uint8Array([1, 2, 3]));
    const eml = await embeddedEmail(fixture(), [{ id, key: 'private/photo', mime: 'image/png', name: 'photo.png' }], store);
    const parsed = await simpleParser(eml, { skipImageLinks: true });
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0].contentId).toContain(id);
    expect(parsed.html).toContain(`cid:${id}@mail-studio`);
    expect(parsed.html).not.toContain('https://assets');
    expect(store.publications).toBe(0);
  });
  it('round trips a portable archive and remaps imported asset IDs', async () => {
    const store = new MemoryStorage(); await store.put('private/photo', new Uint8Array([1, 2, 3]));
    const original = fixture();
    const bytes = await archive(original, [{ id, key: 'private/photo', mime: 'image/png', name: 'photo.png' }], store);
    const result = readArchive(bytes);
    expect(result.doc).toEqual(original);
    expect(result.images[0].data).toEqual(new Uint8Array([1, 2, 3]));
    const mapped = remapAssets(result.doc, { [id]: 'a9c4663c-1e70-4126-ae01-38db2aaef83f' });
    expect(assetIds(mapped)).toEqual(['a9c4663c-1e70-4126-ae01-38db2aaef83f']);
    expect(assetIds(result.doc)).toEqual([id]);
  });
  it('rejects archive traversal and missing embedded images', async () => {
    expect(() => readArchive(zipSync({ '../escape': strToU8('bad') }))).toThrow('invalid_archive');
    await expect(embeddedEmail(fixture(), [], new MemoryStorage())).rejects.toThrow('missing_image');
  });
  it('bounds binary exports before assembly and rejects archives that cannot be reimported', async () => {
    const store = new MemoryStorage();
    const assets = [{ id, key: 'private/photo', mime: 'image/png', name: 'photo.png' }];
    await store.put('private/photo', new Uint8Array(10 * 1024 * 1024 + 1));
    await expect(archive(fixture(), assets, store)).rejects.toThrow('export_too_large');
    await expect(embeddedEmail(fixture(), assets, store)).rejects.toThrow('export_too_large');
    const doc = blank();
    doc.nodes[0].children = Array.from({ length: 101 }, () => ({ ...node('image'), assetId: crypto.randomUUID() }));
    await expect(archive(doc, [], store)).rejects.toThrow('export_too_large');
  });
});
