import { blank, node, type EmailDocument, type EmailNode } from './model';
export const starterNames = ['blank', 'personal', 'announcement', 'newsletter', 'invitation', 'product'] as const;
export type StarterName = typeof starterNames[number];
export function starter(name: StarterName, lang: 'en' | 'fr'): EmailDocument {
  const doc = blank();
  const fr = lang === 'fr';
  if (name === 'blank') return doc;
  const content: Record<Exclude<StarterName, 'blank'>, [string, string, string]> = fr ? {
    personal: ['Un petit mot pour vous', 'Bonjour,\n\nJe souhaitais partager quelques nouvelles avec vous.\n\nÀ très bientôt,', 'Restons en contact'],
    announcement: ['Une nouvelle étape commence', 'Nous avons une nouvelle à partager avec vous. Voici ce qui change et pourquoi cela compte.', 'Découvrir'],
    newsletter: ['Les nouvelles du mois', 'Des idées à partager, des projets qui avancent et un peu d’inspiration pour la suite.', 'Lire la suite'],
    invitation: ['Vous êtes invité·e', 'Retrouvons-nous pour un moment d’échange.\n\nAjoutez ici la date, le lieu et les informations pratiques.', 'Réserver ma place'],
    product: ['Pensé pour votre quotidien', 'Découvrez notre dernière nouveauté et ce qu’elle peut vous apporter.', 'En savoir plus'],
  } : {
    personal: ['A little note for you', 'Hello,\n\nI wanted to share a few updates with you.\n\nSpeak soon,', 'Keep in touch'],
    announcement: ['Something new begins', 'We have some news to share. Here is what is changing, and why it matters.', 'Take a look'],
    newsletter: ['Good things, this month', 'Ideas worth sharing, projects moving forward, and a little inspiration for what comes next.', 'Read the story'],
    invitation: ["You're invited", "Let's get together for a conversation.\n\nAdd the date, location, and practical details here.", 'Save my place'],
    product: ['Made for your everyday', 'Meet our latest addition and discover what it can do for you.', 'Explore the details'],
  };
  const [heading, body, cta] = content[name];
  doc.subject = heading;
  const section = doc.nodes[0];
  section.style.padding = 36;
  section.children = [node('heading', heading), node('text', body)];
  if (name === 'newsletter' || name === 'product') {
    const row = node('row');
    row.children.forEach((col, i) => {
      col.style.background = '#f0f3ed';
      col.children = [node('heading', fr ? `À découvrir ${i + 1}` : `Worth a look ${i + 1}`), node('text', fr ? 'Votre prochaine histoire commence ici.' : 'Your next story starts here.')];
      col.children[0].style.fontSize = 20;
    });
    section.children.push(row);
  }
  if (name !== 'personal') section.children.push(node('button', cta));
  const footer: EmailNode = node('text', fr ? 'Votre nom · Vos coordonnées' : 'Your name · Your contact details');
  footer.style.fontSize = 12;
  footer.style.color = '#58665d';
  section.children.push(node('divider'), footer);
  return doc;
}
