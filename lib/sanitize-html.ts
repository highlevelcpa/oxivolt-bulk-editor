// Allowlist sanitizer for AI-generated product descriptions.
//
// The AI is asked for simple HTML (<p>, <ul>, <li>, <strong>), but its output is
// untrusted text that is written straight into the merchant's storefront via
// productUpdate.descriptionHtml. This keeps only a small set of formatting tags,
// strips every attribute (no on* handlers, style, href/src) and removes
// dangerous elements together with their content.
//
// Invariant: the only "<" characters in the output belong to canonical allowed
// tags (e.g. "<p>", "</li>", "<br>"); every other "<" / ">" is escaped.

const ALLOWED_TAGS = new Set(['p', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'br']);
const VOID_TAGS = new Set(['br']);

// Elements whose *content* must be dropped too, not just the tags.
const DROP_WITH_CONTENT = [
  'script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript',
  'textarea', 'title', 'svg', 'math', 'head', 'xmp', 'noembed', 'noframes',
];

export function sanitizeDescriptionHtml(input: string | null | undefined): string {
  if (!input) return '';
  let s = String(input);

  // Comments and CDATA / processing instructions (also unterminated ones).
  s = s.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  s = s.replace(/<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/gi, '');
  s = s.replace(/<[!?][^>]*>?/g, '');

  for (const tag of DROP_WITH_CONTENT) {
    const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi');
    s = s.replace(paired, '');
    // Unclosed dangerous element: drop everything after it.
    const open = new RegExp(`<${tag}\\b[\\s\\S]*$`, 'i');
    s = s.replace(open, '');
  }

  const out: string[] = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(s)) !== null) {
    out.push(escapeText(s.slice(last, m.index)));
    last = m.index + m[0].length;
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    if (!ALLOWED_TAGS.has(name)) continue; // drop tag, keep surrounding text
    if (VOID_TAGS.has(name)) {
      if (!closing) out.push(`<${name}>`);
      continue;
    }
    out.push(closing ? `</${name}>` : `<${name}>`);
  }
  out.push(escapeText(s.slice(last)));
  return out.join('').trim();
}

// True when the sanitized HTML has no visible text left (e.g. "<p></p>").
export function isEffectivelyEmptyHtml(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim().length === 0;
}

function escapeText(t: string): string {
  return t.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
