import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q');

  if (!query) {
    return NextResponse.json({ error: 'Query parameter required' }, { status: 400 });
  }

  try {
    // When following a wiki link we already have the exact page title, so try
    // a DIRECT page parse first. Only fall back to fuzzy search if the direct
    // fetch misses (typo, redirect, or a free-text query rather than a title).
    // This is what fixes 404s on valid /wiki/ links: the old code always ran a
    // full-text search and took search[0], which missed or mis-resolved many
    // exact titles.
    const directUrl = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(query)}&format=json&origin=*&prop=text&redirects=1`;
    const directResponse = await fetch(directUrl);
    const directData = await directResponse.json();

    if (directData.parse?.text?.['*']) {
      const articleTitle = directData.parse.title as string;
      return NextResponse.json({
        title: articleTitle,
        content: directData.parse.text['*'],
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(articleTitle.replace(/ /g, '_'))}`,
      });
    }

    // Fallback: fuzzy full-text search, then parse the top hit.
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
    const searchResponse = await fetch(searchUrl);
    const searchData = await searchResponse.json();

    if (!searchData.query?.search?.[0]) {
      return NextResponse.json({ error: 'No results found' }, { status: 404 });
    }

    const pageTitle = searchData.query.search[0].title;

    const contentUrl = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&format=json&origin=*&prop=text&redirects=1`;
    const contentResponse = await fetch(contentUrl);
    const contentData = await contentResponse.json();

    if (!contentData.parse) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    }

    const articleTitle = contentData.parse.title as string;
    return NextResponse.json({
      title: articleTitle,
      content: contentData.parse.text['*'],
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(articleTitle.replace(/ /g, '_'))}`,
    });
  } catch (error) {
    console.error('Wikipedia API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Wikipedia article' },
      { status: 500 }
    );
  }
}
