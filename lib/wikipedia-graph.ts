/**
 * Wikipedia Graph utilities — ported from controversial/wikipedia-map
 * Fetches first-paragraph links from Wikipedia articles to build a connection graph.
 * Source: https://github.com/controversial/wikipedia-map (MIT-style, client-side JS)
 */

const WIKI_API = 'https://en.wikipedia.org/w/api.php';

interface WikiApiParams {
  [key: string]: string;
}

async function queryApi(query: WikiApiParams) {
  const url = new URL(WIKI_API);
  const params = { format: 'json', origin: '*', ...query };
  Object.entries(params).forEach(([key, val]) => url.searchParams.append(key, val));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Wikipedia API error: ${res.status}`);
  return res.json();
}

/** Check if a page name is a real article (not a namespace like WP:, Talk:, etc.) */
const isArticle = (name: string) =>
  !(name.endsWith(':') ? name.slice(0, -1) : name).includes(':');

/** Normalize a page name into a stable ID for deduplication */
export function getNormalizedId(id: string): string {
  return id
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z\d% ]/g, '')
    .replace(/s$/, '');
}

/** Fetch the HTML of a Wikipedia page's first section, following redirects */
async function getPageHtml(pageName: string) {
  const res = await queryApi({
    action: 'parse',
    page: pageName,
    prop: 'text',
    section: '0',
    redirects: '1',
  });
  return {
    html: res.parse.text['*'] as string,
    redirectedTo: res.parse.redirects?.[0]?.to ?? pageName,
  };
}

/** Extract first-paragraph wiki links from page HTML string */
function extractLinks(html: string): string[] {
  // Use a regex-based approach that works in both browser and Node
  // Find the first <p> that isn't mw-empty-elt and doesn't contain #coordinates
  const paragraphs = html.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];
  let firstP = '';
  for (const p of paragraphs) {
    if (p.includes('mw-empty-elt')) continue;
    if (p.includes('id="coordinates"')) continue;
    firstP = p;
    break;
  }
  if (!firstP) return [];

  // Extract all <a href="/wiki/..."> links
  const linkRegex = /<a[^>]+href="\/wiki\/([^"#]+)"[^>]*>/gi;
  const titles: string[] = [];
  const seenIds = new Set<string>();
  let match;
  while ((match = linkRegex.exec(firstP)) !== null) {
    const title = decodeURIComponent(match[1].replace(/_/g, ' '));
    if (!isArticle(title)) continue;
    const id = getNormalizedId(title);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    titles.push(title);
  }
  return titles;
}

/** Main function: get first-paragraph links for a Wikipedia article */
export async function getSubPages(pageName: string): Promise<{
  redirectedTo: string;
  links: string[];
}> {
  const { html, redirectedTo } = await getPageHtml(pageName);
  return { redirectedTo, links: extractLinks(html) };
}

/** Get a random Wikipedia article title */
export async function getRandomArticle(): Promise<string> {
  const res = await queryApi({
    action: 'query',
    list: 'random',
    rnlimit: '1',
    rnnamespace: '0',
  });
  return res.query.random[0].title;
}

/** Get autocomplete suggestions */
export async function getSuggestions(search: string): Promise<string[]> {
  const res = await queryApi({
    action: 'opensearch',
    search,
    limit: '10',
    namespace: '0',
  });
  return res[1] ?? [];
}
