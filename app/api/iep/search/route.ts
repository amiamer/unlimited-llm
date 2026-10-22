import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

/**
 * Internet Encyclopedia of Philosophy (iep.utm.edu) search + article fetch.
 *
 * Mirrors the SEP route: run IEP's search, resolve the first real article,
 * fetch it, and return { title, content, url }. IEP is a WordPress site, so we
 * key result resolution on the article URL SHAPE (a single lowercase slug path
 * segment) rather than brittle theme markup, and extract content with a chain
 * of fallback selectors.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Path segments that are NOT articles (WordPress plumbing + IEP meta pages).
const NON_ARTICLE = new Set([
  'category', 'tag', 'author', 'page', 'search', 'wp-content', 'wp-admin',
  'wp-login', 'feed', 'sitemap', 'about', 'sample-page', 'home',
  'editor-list', 'editors', 'editorial-board', 'submissions', 'masthead',
  'contact', 'donate', 'privacy-policy', 'terms', 'staff', 'the-iep',
]);

/** True if href points at an IEP article page (iep.utm.edu/<slug>/). */
function articleSlug(href: string): string | null {
  try {
    const u = new URL(href, 'https://iep.utm.edu');
    if (!/(^|\.)iep\.utm\.edu$/i.test(u.hostname)) return null;
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs.length !== 1) return null; // articles are a single slug
    const slug = segs[0].toLowerCase();
    if (NON_ARTICLE.has(slug)) return null;
    // Single-character slugs are IEP's A–Z browse index (/a/, /b/, …), not
    // articles — exclude them (this is what made a raw search grab "/a/").
    if (slug.length < 2) return null;
    if (!/^[a-z0-9-]+$/.test(slug)) return null;
    return slug;
  } catch {
    return null;
  }
}

/** Article URL from the first valid candidate anchor in a set of scoped cheerio elements. */
function firstArticleUrl($: cheerio.CheerioAPI, selector: string): string | null {
  let found: string | null = null;
  $(selector).each((_, el) => {
    if (found) return;
    const href = $(el).attr('href');
    if (href && articleSlug(href)) found = new URL(href, 'https://iep.utm.edu').toString();
  });
  return found;
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q');
  if (!query) {
    return NextResponse.json({ error: 'Query parameter required' }, { status: 400 });
  }

  try {
    let articleUrl: string | null = null;

    // 1. Preferred: WordPress REST search — returns clean result permalinks with
    // no markup scraping. Covers all IEP post types; take the first real article.
    try {
      const restUrl = `https://iep.utm.edu/wp-json/wp/v2/search?search=${encodeURIComponent(query)}&per_page=8`;
      const restRes = await fetch(restUrl, { headers: { 'User-Agent': UA } });
      if (restRes.ok) {
        const hits = (await restRes.json()) as Array<{ url?: string }>;
        for (const hit of Array.isArray(hits) ? hits : []) {
          if (hit.url && articleSlug(hit.url)) { articleUrl = hit.url; break; }
        }
      }
    } catch { /* REST disabled or offline — fall back to scraping */ }

    // 2. Fallback: scrape the ?s= results page, preferring result <article> links
    // over chrome (single-letter A–Z index links are rejected by articleSlug).
    if (!articleUrl) {
      const searchRes = await fetch(`https://iep.utm.edu/?s=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': UA },
      });
      const $ = cheerio.load(await searchRes.text());
      const scopes = [
        'main article a', '#content article a', '.site-main article a', 'article a',
      ];
      for (const scope of scopes) {
        articleUrl = firstArticleUrl($, scope);
        if (articleUrl) break;
      }
    }

    // 3. Fallback: guess the direct article URL from the query slug (IEP articles
    // are the lowercased name, e.g. Spinoza → /spinoza/). Try a couple of shapes.
    if (!articleUrl) {
      const base = query.trim().toLowerCase();
      const guesses = [
        base.replace(/[^a-z0-9]+/g, ''),        // "free will" → freewill
        base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''), // → free-will
      ].filter((g, i, a) => g && a.indexOf(g) === i);
      for (const g of guesses) {
        const guessUrl = `https://iep.utm.edu/${g}/`;
        const head = await fetch(guessUrl, { method: 'HEAD', headers: { 'User-Agent': UA } });
        if (head.ok) { articleUrl = guessUrl; break; }
      }
    }

    if (!articleUrl) {
      return NextResponse.json({ error: 'No results found' }, { status: 404 });
    }

    // 2. Fetch the article and extract title + content.
    const articleRes = await fetch(articleUrl, { headers: { 'User-Agent': UA } });
    const article$ = cheerio.load(await articleRes.text());

    const rawTitle =
      article$('h1.entry-title').first().text() ||
      article$('h1.page-title').first().text() ||
      article$('article h1').first().text() ||
      article$('h1').first().text() ||
      article$('title').text().replace(/\s*\|\s*Internet Encyclopedia of Philosophy.*$/i, '');

    const container =
      article$('.entry-content').first().length ? article$('.entry-content').first()
      : article$('#content .post').first().length ? article$('#content .post').first()
      : article$('article .post-content').first().length ? article$('article .post-content').first()
      : article$('article').first().length ? article$('article').first()
      : article$('#main').first();

    // Normalize images so they render in the reader: WordPress lazy-loads via
    // data-src/data-lazy-src (the real src is a placeholder), and some srcs are
    // relative or protocol-relative. Promote the real source and make it absolute.
    container.find('img').each((_, img) => {
      const el = article$(img);
      const real = el.attr('data-src') || el.attr('data-lazy-src') || el.attr('src') || '';
      if (real) {
        try { el.attr('src', new URL(real, articleUrl).toString()); } catch { /* leave as-is */ }
      }
      // srcset with relative/lazy entries confuses the browser once src is fixed.
      el.removeAttr('srcset');
      el.removeAttr('data-srcset');
      el.removeAttr('loading');
    });

    const content = container.html() || '';

    if (!content.trim()) {
      return NextResponse.json({ error: 'Could not extract article content' }, { status: 502 });
    }

    return NextResponse.json({
      title: rawTitle.trim(),
      content,
      url: articleUrl,
    });
  } catch (error) {
    console.error('IEP API error:', error);
    return NextResponse.json({ error: 'Failed to fetch IEP article' }, { status: 500 });
  }
}
