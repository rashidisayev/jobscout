const ALLOWED_TAGS = new Set(['p', 'br', 'ul', 'ol', 'li', 'strong', 'em', 'a', 'span']);
const SELF_CLOSING_TAGS = new Set(['br']);
const URL_SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:'];

/**
 * Sanitize HTML content, allowing only a limited set of safe tags/attributes.
 * @param {string} html
 * @returns {string}
 */
export function sanitizeHtml(html = '') {
  if (!html || typeof html !== 'string') {
    return '';
  }

  if (typeof DOMParser === 'undefined') {
    return stripTags(html);
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const container = doc.body || doc;

  const elements = Array.from(container.querySelectorAll('*'));

  for (const el of elements) {
    const tagName = el.tagName?.toLowerCase();

    if (!tagName || !ALLOWED_TAGS.has(tagName)) {
      unwrapNode(el);
      continue;
    }

    sanitizeAttributes(el, tagName);
  }

  return container.innerHTML.trim();
  return container.innerHTML.trim();
}

function unwrapNode(node) {
  const parent = node.parentNode;
  if (!parent) {
    node.remove();
    return;
  }

  while (node.firstChild) {
    parent.insertBefore(node.firstChild, node);
  }
  parent.removeChild(node);
}

function sanitizeAttributes(element, tagName) {
  const attributes = Array.from(element.attributes);

  for (const attr of attributes) {
    if (tagName === 'a' && attr.name === 'href') {
      const trimmed = attr.value?.trim() || '';
      if (!trimmed) {
        element.removeAttribute(attr.name);
        continue;
      }
      if (trimmed.startsWith('#') || trimmed.startsWith('/')) {
        element.setAttribute('href', trimmed);
        element.setAttribute('target', '_blank');
        element.setAttribute('rel', 'nofollow noopener noreferrer');
        continue;
      }
      try {
        const url = new URL(trimmed, 'https://www.linkedin.com');
        if (!URL_SAFE_PROTOCOLS.includes(url.protocol)) {
          element.removeAttribute(attr.name);
        } else {
          element.setAttribute('href', url.href);
          element.setAttribute('target', '_blank');
          element.setAttribute('rel', 'nofollow noopener noreferrer');
        }
      } catch (err) {
        element.removeAttribute(attr.name);
      }
    } else if (!SELF_CLOSING_TAGS.has(tagName)) {
      element.removeAttribute(attr.name);
    } else {
      element.removeAttribute(attr.name);
    }
  }

  if (tagName !== 'a' && tagName !== 'span') {
    while (element.attributes.length > 0) {
      element.removeAttribute(element.attributes[0].name);
    }
  }
}

function stripTags(html) {
  const tmp = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '');
  return tmp.replace(/<\/?[^>]+>/g, '').trim();
}

