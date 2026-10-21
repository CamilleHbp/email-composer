import { useEffect, useRef, useState } from 'react';
import { assetIds, type EmailDocument } from '../shared/model';
import { renderEmail } from '../shared/render';
export function Thumbnail({ document }: { document: EmailDocument }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(180);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const html = renderEmail(document, { assets: Object.fromEntries(assetIds(document).map(id => [id, `/api/assets/${id}/content`])) }).fragment;
  return <div ref={ref} className="thumbnail" aria-hidden="true" style={{ background: document.background }}>
    <div style={{ width: document.width, transform: `scale(${width / document.width})`, transformOrigin: 'top left', textAlign: 'initial' }} dangerouslySetInnerHTML={{ __html: html }}/>
  </div>;
}
