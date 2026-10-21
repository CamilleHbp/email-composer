import { describe, it, expect } from 'vitest';
import { blank, node, moveNode, cloneNode, deleteNode, validateDocument, walk } from '../shared/model';
import { starter, starterNames } from '../shared/starters';
import { renderEmail } from '../shared/render';
describe('document operations', () => {
  it('moves text across nested containers without mutating the previous document', () => {
    const doc = blank(); const row = node('row'); const text = node('text', 'Keep me');
    doc.nodes[0].children = [text, row];
    const moved = moveNode(doc, text.id, row.children[1].id, 0);
    expect(moved.nodes[0].children[0].children[1].children[0].text).toBe('Keep me');
    expect(doc.nodes[0].children[0].id).toBe(text.id);
  });
  it('rejects cycles, invalid parents and removing the last column', () => {
    const doc = blank(); const row = node('row'); doc.nodes[0].children = [row];
    expect(() => moveNode(doc, doc.nodes[0].id, row.children[0].id, 0)).toThrow('invalid_move');
    expect(() => moveNode(doc, row.children[0].id, null, 0)).toThrow('invalid_move');
    row.children.pop();
    expect(() => deleteNode(doc, row.children[0].id)).toThrow('last_column');
  });
  it.each([false, true])('moves a last column and removes its empty row (nested: %s)', nested => {
    const doc = blank(); const source = node('row'); const target = node('row');
    source.children = [source.children[0]];
    source.children[0].children = [node('text', 'Keep all content')];
    if (nested) doc.nodes[0].children = [source, target];
    else doc.nodes = [source, target];
    const column = source.children[0];
    const moved = moveNode(doc, column.id, target.id, 1);
    expect(walk(moved.nodes).some(n => n.id === source.id)).toBe(false);
    expect(walk(moved.nodes).find(n => n.id === target.id)?.children.map(n => n.id))
      .toEqual([target.children[0].id, column.id, target.children[1].id]);
    expect(walk(moved.nodes).find(n => n.id === column.id)).toEqual(column);
    expect(source.children).toEqual([column]);
    expect(validateDocument(moved)).toEqual(moved);
  });
  it('keeps a nonempty source row and allows reordering its last column', () => {
    const doc = blank(); const source = node('row'); const target = node('row');
    doc.nodes = [source, target];
    const moved = moveNode(doc, source.children[0].id, target.id, 0);
    expect(moved.nodes[0].children).toEqual([source.children[1]]);
    expect(moveNode(moved, source.children[1].id, source.id, 1)).toEqual(moved);
  });
  it('rejects moving a last column into a row inside itself', () => {
    const doc = blank(); const source = node('row'); const nested = node('row');
    source.children = [source.children[0]];
    source.children[0].children = [nested]; doc.nodes = [source];
    expect(() => moveNode(doc, source.children[0].id, nested.id, 0)).toThrow('invalid_move');
  });
  it('preserves content when removing a populated column', () => {
    const doc = blank(); const row = node('row'); row.children[0].children = [node('text', 'Important')]; doc.nodes[0].children = [row];
    expect(walk(deleteNode(doc, row.children[0].id).nodes).find(n => n.kind === 'text')?.text).toBe('Important');
  });
  it('clones IDs recursively and validates depth and asset links', () => {
    const row = node('row'); const copy = cloneNode(row);
    expect(walk([copy]).some(n => walk([row]).some(x => x.id === n.id))).toBe(false);
    const doc = blank(); doc.nodes.push(node('button')); doc.nodes[1].href = 'javascript:alert(1)';
    expect(() => validateDocument(doc)).toThrow();
  });
  it('validates all six starters in both languages', () => {
    for (const lang of ['en', 'fr'] as const) for (const name of starterNames) expect(validateDocument(starter(name, lang)).version).toBe(1);
  });
  it('escapes user HTML and keeps only supported inline marks', () => {
    const doc = blank(); doc.nodes[0].children = [node('text', '<strong>Safe</strong><script>alert(1)</script><img src=x onerror=alert(1)>')];
    const r = renderEmail(doc, { assets: {} });
    expect(r.fragment).toContain('<strong>Safe</strong>');
    expect(r.fragment).not.toContain('<script>');
    expect(r.fragment).not.toContain('<img src=x');
  });
});
