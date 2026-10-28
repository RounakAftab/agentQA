// Identifier helpers for generated code: "Log in" -> logIn / LogIn.

const RESERVED = new Set(['page', 'constructor', 'goto', 'expect', 'test', 'await', 'class', 'new', 'this', 'super']);

// "Add to cart", "addToCart", "add_to-cart" -> ['add', 'to', 'cart'].
export function words(text) {
  return String(text ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

const cap = (w) => w[0].toUpperCase() + w.slice(1);
export const pascal = (list) => list.map(cap).join('');
export const camel = (list) => (list.length ? list[0] + pascal(list.slice(1)) : '');

// Joins words and a suffix without repeating it: ['search', 'input'] + 'Input' -> searchInput.
export function memberName(list, suffix = '') {
  const parts = [...list];
  if (suffix && parts.at(-1) !== suffix.toLowerCase()) parts.push(...words(suffix));
  let name = camel(parts) || 'element';
  if (/^\d/.test(name)) name = `el${cap(name)}`;
  return RESERVED.has(name) ? `${name}Element` : name;
}

// Any user text -> a class name ending in "Page": "checkout step 2" -> CheckoutStep2Page.
export function className(text) {
  const list = words(text);
  if (list.at(-1) === 'page') list.pop();
  let name = pascal(list) || 'Home';
  if (/^\d/.test(name)) name = `P${name}`;
  return `${name}Page`;
}

// "https://shop.test/web/index.php/auth/login" -> LoginPage. Ids and index files are skipped.
export function classNameFromUrl(url, base) {
  let parsed;
  try {
    parsed = new URL(url, base || 'http://localhost');
  } catch {
    return 'HomePage';
  }
  const segmentsOf = (route) =>
    route
      .split('/')
      .map((s) => safeDecode(s).replace(/\.(html?|php|aspx?|jsp)$/i, ''))
      .filter((s) => s && s !== 'index' && !/^\d+$/.test(s) && !/^[0-9a-f-]{16,}$/i.test(s));
  // Single-page apps route in the hash (#/completed); an empty hash route falls back to the path.
  const hashRoute = parsed.hash.startsWith('#/') ? segmentsOf(parsed.hash.slice(1)) : [];
  const segments = hashRoute.length ? hashRoute : segmentsOf(parsed.pathname);
  return className(segments.at(-1) ?? 'home');
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// Returns `name`, or name2, name3... when it is already taken. Records the result in `taken`.
export function unique(name, taken) {
  let candidate = name;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${name}${n}`;
  taken.add(candidate);
  return candidate;
}

// '...' with quotes and backslashes escaped.
export const quote = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

export function slug(text) {
  return words(text).slice(0, 6).join('-') || 'recorded-flow';
}
