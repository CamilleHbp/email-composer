import { describe, expect, it } from 'vitest';
import { importMySigmail } from '../server/mysigmail';
import { validateDocument, walk } from '../shared/model';
import { renderEmail } from '../shared/render';
import { archive, readArchive, embeddedEmail } from '../server/email';
import { MemoryStorage } from './helpers';
import { simpleParser } from 'mailparser';

export const mySigmailFixture = () => ({
  version: 1, meta: { title: 'Imported newsletter' },
  editor: { general: { background: { color: '#eee' }, previewText: 'Preview' } },
  canvas: { components: [{ version: 1, block: { settings: { backgroundColor: '#fff9e8', spacing: { padding: [24, 24, 24, 24] } }, rows: [{ settings: { gap: 16, collapseOnMobile: false }, cells: [
    { settings: { width: 40 }, children: [{ type: 'image', src: 'https://example.org/poster.jpg', alt: 'Poster', link: 'https://example.org/film', width: 160 }] },
    { settings: { width: 60 }, children: [
      { type: 'text', value: '<p><span style="font-size:25px;color:#123456"><strong>Bonjour &amp; bienvenue</strong></span></p><p>Cinéma<br>Demain <a href="https://example.org">Book</a><script>bad()</script></p>' },
      { type: 'button', value: 'Tickets', link: 'https://example.org/tickets', backgroundColor: '#abcdef' },
      { type: 'divider', color: '#123456', height: 1 },
    ] },
  ] }] } }] },
});
const convert = (value: unknown) => importMySigmail(Buffer.from(JSON.stringify(value)));
describe('Card source compatibility', () => {
  it('continues importing with placeholders and a warning for unusable image sources', () => {
    const fixture = mySigmailFixture();
    Object.assign(fixture.canvas.components[0].block.rows[0].cells[0].children[0], { src: 'img/catalog/poster.png' });
    Object.assign(fixture.canvas.components[0].block.settings, { backgroundImage: { url: 'missing/background.png', size: 'cover', repeat: 'no-repeat', position: 'center' } });
    const result = convert(fixture);
    expect(result.importWarnings).toEqual(['mysigmail_images_unavailable']);
    expect(walk(result.document.nodes).find(n => n.kind === 'image')).toMatchObject({ alt: 'Poster', kind: 'image' });
    expect(walk(result.document.nodes).find(n => n.kind === 'image')?.remoteSrc).toBeUndefined();
    expect(result.document.nodes[0].style.backgroundImage).toBeUndefined();
    expect(walk(result.document.nodes).some(n => n.kind === 'text')).toBe(true);
  });
  it('distinguishes legacy paragraphs from text-box spacing', () => {
    const fixture = mySigmailFixture();
    const children = fixture.canvas.components[0].block.rows[0].cells[1].children;
    children.splice(0, children.length, { type: 'text', value: '<p>First</p><p>Last</p>' });
    expect(renderEmail(convert(fixture).document, { assets: {} }).fragment).toContain('<p style="margin:1em 0;">First</p>');
    Object.assign(children[0], { widthMode: 'fill', paragraphSpacing: 12 });
    expect(renderEmail(convert(fixture).document, { assets: {} }).fragment).toContain('<p style="margin:0 0 12px;">First</p><p style="margin:0 0 0px;">Last</p>');
    Object.assign(children[0], { paragraphSpacing: undefined });
    expect(renderEmail(convert(fixture).document, { assets: {} }).fragment).toContain('<p style="margin:0 0 0px;">First</p>');
  });
  it('retains headings, lists, code, superscripts, letter spacing and alpha colours', () => {
    const fixture = mySigmailFixture();
    const children = fixture.canvas.components[0].block.rows[0].cells[1].children;
    children.splice(0, children.length, { type: 'text', value: '<h3>Heading</h3><ul><li>First</li><li>Second</li></ul><p style="margin-top:8px"><code>x</code><sup>2</sup><span style="letter-spacing:1.5px;color:#abcd;font-style:oblique">Spaced</span></p>' });
    const output = renderEmail(convert(fixture).document, { assets: {} });
    for (const html of ['<h3>Heading</h3>', '<ul><li>First</li><li>Second</li></ul>', '<code>x</code><sup>2</sup>', 'margin-top:8px', 'letter-spacing:1.5px;color:#abcd;font-style:oblique']) expect(output.fragment).toContain(html);
    expect(output.text).toContain('First\nSecond');
  });
  it('prefers spacing.padding and applies button opacity once', () => {
    const fixture = mySigmailFixture();
    Object.assign(fixture.canvas.components[0].block.rows[0].cells[1].children[1], { padding: [20, 20, 20, 20], spacing: { padding: [1, 2, 3, 4] }, opacity: 0.5 });
    const doc = convert(fixture).document;
    expect(walk(doc.nodes).find(n => n.kind === 'button')?.style.paddingSides).toEqual([1, 2, 3, 4]);
    expect(walk(doc.nodes).find(n => n.kind === 'text')?.style.background).toBe('transparent');
    expect(renderEmail(doc, { assets: {} }).fragment.match(/opacity:0\.5/g)).toHaveLength(1);
  });
});
describe('MySigmail Card import', () => {
  it('converts editable layout, formatting, entities, links and HTTPS images with fresh IDs', () => {
    const result = convert(mySigmailFixture());
    expect(result.name).toBe('Imported newsletter');
    expect(validateDocument(result.document)).toEqual(result.document);
    expect(result.document).toMatchObject({ width: 600, background: '#eee', preheader: 'Preview' });
    const nodes = walk(result.document.nodes);
    expect(nodes.find(n => n.kind === 'row')?.style.stack).toBe(false);
    expect(nodes.filter(n => n.kind === 'column').map(n => n.style.width)).toEqual([40, 60]);
    expect(nodes.find(n => n.kind === 'text')).toMatchObject({ rich: true });
    expect(nodes.find(n => n.kind === 'text')?.text).toContain('font-size:25px;color:#123456');
    const output = renderEmail(result.document, { assets: {} });
    expect(output.fragment).toContain('https://example.org/poster.jpg');
    expect(output.text).toContain('Book (https://example.org)');
    expect(output.text).not.toContain('bad()');
    expect(output.warnings).toEqual(['external_images']);
    expect(walk(convert(mySigmailFixture()).document.nodes).some(n => nodes.some(old => old.id === n.id))).toBe(false);
  });
  it('supports nested rows and rejects unsupported versions, atom types and malformed files', () => {
    const fixture = mySigmailFixture();
    const cells = fixture.canvas.components[0].block.rows[0].cells;
    (cells[1].children as unknown[]).push({ type: 'row', settings: {}, cells: [{ settings: {}, children: [{ type: 'text', value: 'Nested' }] }] });
    expect(walk(convert(fixture).document.nodes).some(n => n.text === 'Nested')).toBe(true);
    expect(() => convert({ ...fixture, version: 2 })).toThrow('invalid_mysigmail');
    (cells[1].children as unknown[]).push({ type: 'unknown' });
    expect(() => convert(fixture)).toThrow('invalid_mysigmail');
    for (const value of [null, {}, { version: 1 }]) expect(() => convert(value)).toThrow('invalid_mysigmail');
    expect(() => importMySigmail(Buffer.from('{'))).toThrow('invalid_mysigmail');
    expect(() => importMySigmail(new Uint8Array(2 * 1024 * 1024 + 1))).toThrow('mysigmail_too_large');
  });
  it('skips unsafe image sources and strips unsafe links and markup', () => {
    const fixture = mySigmailFixture();
    const image = fixture.canvas.components[0].block.rows[0].cells[0].children[0] as { src: string; link: string };
    image.src = 'javascript:alert(1)';
    expect(convert(fixture).importWarnings).toContain('mysigmail_images_unavailable');
    image.src = 'https://example.org/safe.png'; image.link = 'javascript:alert(1)';
    const doc = convert(fixture).document;
    expect(walk(doc.nodes).find(n => n.kind === 'image')?.href).toBe('');
    const malicious = structuredClone(doc); malicious.nodes[0].remoteSrc = 'data:image/svg+xml,bad';
    expect(() => validateDocument(malicious)).toThrow();
  });
  it('retains external image references across ZIP and EML without fetching them', async () => {
    const doc = convert(mySigmailFixture()).document;
    const store = new MemoryStorage();
    const zip = await archive(doc, [], store);
    expect(readArchive(zip).doc).toEqual(doc);
    const mail = await simpleParser(await embeddedEmail(doc, [], store));
    expect(mail.html).toContain('https://example.org/poster.jpg');
    expect(mail.attachments).toHaveLength(0);
  });
});

describe('imported formatting', () => {
  it('preserves per-side spacing, transparent colours, corners, borders and mobile styles', () => {
    const fixture = mySigmailFixture();
    Object.assign(fixture.canvas.components[0].block.settings, {
      spacing: { padding: [34, 32, 34, 32], margin: [1, 2, 3, 4] },
      backgroundColor: 'rgba(255,243,230,0)', borderRadius: { topLeft: 1, topRight: 2, bottomRight: 3, bottomLeft: 4 },
      border: { top: { width: 3, style: 'dashed', color: '#123456' } }, hiddenOnMobile: true,
      backgroundImage: { url: 'https://example.org/background.png', size: 'cover', repeat: 'no-repeat', position: 'center' }, opacity: 0.5,
    });
    const doc = convert(fixture).document;
    const output = renderEmail(doc, { assets: {} });
    for (const style of ['padding:34px 32px 34px 32px', 'padding:1px 2px 3px 4px', 'background-color:rgba(255,243,230,0)', 'border-radius:1px 2px 3px 4px', 'border-top:3px dashed #123456', 'opacity:0.5', 'max-width:600px', 'display:none!important', 'background.png', 'background-size:cover']) expect(output.fragment).toContain(style);
    expect(output.fragment).toContain('href="https://example.org"');
    expect(output.fragment).toContain('font-size:25px;color:#123456');
  });
  it('removes active markup and unsafe CSS while retaining formatting and escaped literal text', () => {
    const fixture = mySigmailFixture();
    fixture.canvas.components[0].block.rows[0].cells[1].children = [{ type: 'text', value: '<p><span style="color:#123456;position:fixed;background-image:url(https://evil.test);font-size:20px" onclick="alert(1)">Safe &lt;img src=x&gt;</span><a href="javascript:alert(1)">bad link</a><svg onload="alert(1)">bad</svg></p>' }];
    const output = renderEmail(convert(fixture).document, { assets: {} });
    expect(output.fragment).toContain('color:#123456;font-size:20px');
    expect(output.fragment).toContain('&lt;img src=x&gt;');
    expect(output.fragment).not.toMatch(/onclick|javascript:|<svg|position:fixed|evil.test/);
  });
});
