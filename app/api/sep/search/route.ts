import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q');

  if (!query) {
    return NextResponse.json({ error: 'Query parameter required' }, { status: 400 });
  }

  try {
    // Search SEP
    const searchUrl = `https://plato.stanford.edu/search/searcher.py?query=${encodeURIComponent(query)}`;
    const searchResponse = await fetch(searchUrl);
    const searchHtml = await searchResponse.text();
    
    const $ = cheerio.load(searchHtml);
    const firstResult = $('div.result_url a').first();
    
    if (!firstResult.length) {
      return NextResponse.json({ error: 'No results found' }, { status: 404 });
    }

    const articleUrl = firstResult.attr('href');
    if (!articleUrl) {
      return NextResponse.json({ error: 'Invalid result' }, { status: 404 });
    }

    // Fetch the article
    const articleResponse = await fetch(articleUrl);
    const articleHtml = await articleResponse.text();
    
    const article$ = cheerio.load(articleHtml);
    
    // Extract title and content
    const title = article$('#aueditable h1').first().text() || article$('title').text();
    
    // Get main content
    const content = article$('#aueditable').html() || article$('#main-text').html() || '';

    return NextResponse.json({
      title: title.trim(),
      content,
      url: articleUrl,
    });
  } catch (error) {
    console.error('SEP API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SEP article' },
      { status: 500 }
    );
  }
}
