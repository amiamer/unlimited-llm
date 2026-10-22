'use client';

import { useState, useEffect } from 'react';
import { ArticleReader, ArticleReaderConfig } from './ArticleReader';

function WikiSuggestions({ query, show, onSelect }: { query: string; show: boolean; onSelect: (value: string) => void }) {
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    if (!query.trim()) { setSuggestions([]); return; }
    let cancelled = false;
    fetch(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=8&format=json&origin=*`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setSuggestions(data[1] || []); })
      .catch(() => { if (!cancelled) setSuggestions([]); });
    return () => { cancelled = true; };
  }, [query]);

  if (!show || suggestions.length === 0) return null;

  return (
    <div className="absolute z-10 w-full mt-1 bg-[#1d1f21] border border-[#3a3f47] rounded shadow-lg max-h-80 overflow-y-auto">
      {suggestions.map((suggestion, idx) => (
        <div
          key={idx}
          onClick={() => onSelect(suggestion)}
          className="px-4 py-2.5 hover:bg-[#2a2d31] cursor-pointer text-[#c8ccd1] text-base border-b border-[#2a2d31] last:border-b-0"
        >
          {suggestion}
        </div>
      ))}
    </div>
  );
}

/* Wikipedia dark mode — large text */
const WIKIPEDIA_STYLES = `
  .wikipedia-content {
    font-family: 'Linux Libertine', 'Georgia', 'Times', 'Source Serif Pro', serif;
    font-size: 20px;
    line-height: 1.7;
    color: #c8ccd1;
    word-wrap: break-word;
  }
  .wikipedia-content * { background-color: transparent !important; }
  .wikipedia-content p { margin: 0.5em 0; color: #c8ccd1; }

  .wikipedia-content h1, .wikipedia-content h2, .wikipedia-content h3,
  .wikipedia-content h4, .wikipedia-content h5, .wikipedia-content h6 {
    color: #e3e3e3; font-weight: 400;
    font-family: 'Linux Libertine', 'Georgia', 'Times', serif;
    border-bottom: 1px solid #3a3f47; padding-bottom: 0.2em;
    margin: 1em 0 0.25em;
  }
  .wikipedia-content h2 { font-size: 1.5em; }
  .wikipedia-content h3 { font-size: 1.2em; border-bottom: none; }
  .wikipedia-content h4 { font-size: 1.05em; border-bottom: none; }

  /* Wikipedia blue links — dark mode variant */
  .wikipedia-content a { color: #6b9eff; text-decoration: none; cursor: pointer; }
  .wikipedia-content a:hover { text-decoration: underline; color: #8ab4ff; }
  .wikipedia-content a:visited { color: #b695c0; }

  .wikipedia-content ul, .wikipedia-content ol { margin: 0.3em 0 0 1.6em; padding: 0; }
  .wikipedia-content li { margin-bottom: 0.15em; color: #c8ccd1; }

  /* Tables */
  .wikipedia-content table { border-collapse: collapse; margin: 1em 0; background: #1d1f21 !important; border: 1px solid #3a3f47; color: #c8ccd1; font-size: 0.9em; }
  .wikipedia-content th, .wikipedia-content td { border: 1px solid #3a3f47; padding: 0.3em 0.5em; text-align: left; background: transparent !important; color: #c8ccd1; }
  .wikipedia-content th { background: #25282d !important; font-weight: 700; color: #e3e3e3; }

  .wikipedia-content blockquote { border-left: 3px solid #3a3f47; padding-left: 1em; margin: 1em 0; color: #a0a4a8; font-style: italic; }
  .wikipedia-content code { background: #25282d !important; padding: 2px 5px; font-family: monospace, monospace; font-size: 0.88em; color: #c8ccd1; border-radius: 2px; }
  .wikipedia-content pre { background: #25282d !important; padding: 1em; border: 1px solid #3a3f47; overflow-x: auto; border-radius: 2px; }
  .wikipedia-content img { max-width: 100%; height: auto; border-radius: 2px; }

  /* Infobox */
  .wikipedia-content .infobox, .wikipedia-content .infobox_v2, .wikipedia-content .sidebar {
    float: right; clear: right; margin: 0.5em 0 0.5em 1.4em;
    background: #1d1f21 !important; border: 1px solid #3a3f47;
    padding: 0.3em; width: 22em; font-size: 0.88em;
  }
  .wikipedia-content .infobox th, .wikipedia-content .infobox_v2 th { background: #25282d !important; text-align: center; padding: 0.4em; color: #e3e3e3; }
  .wikipedia-content .thumbinner { background: #1d1f21 !important; border: 1px solid #3a3f47; padding: 4px; margin: 0.5em 0; }
  .wikipedia-content .thumbcaption { color: #a0a4a8; font-size: 0.88em; padding: 4px; line-height: 1.4; }
  .wikipedia-content .mw-editsection { display: none; }
  .wikipedia-content sup.reference { font-size: 0.7em; line-height: 1; }
  .wikipedia-content .reference a { color: #6b9eff; }
  .wikipedia-content dl { margin: 0.2em 0; }
  .wikipedia-content dt { font-weight: 700; color: #e3e3e3; }
  .wikipedia-content dd { margin-left: 1.6em; color: #c8ccd1; }
  .wikipedia-content .navbox, .wikipedia-content .vertical-navbox { background: #1d1f21 !important; border: 1px solid #3a3f47; margin: 1em 0; }
  .wikipedia-content .navbox th { background: #25282d !important; color: #e3e3e3; }
  .wikipedia-content .hatnote { font-style: italic; padding-left: 1.6em; color: #a0a4a8; margin-bottom: 0.5em; }
  .wikipedia-content .toc { background: #1d1f21 !important; border: 1px solid #3a3f47; padding: 8px; display: inline-block; font-size: 0.88em; }
`;

const wikipediaConfig: ArticleReaderConfig = {
  title: 'Wikipedia',
  hideHeader: true, // unified Navbar is provided by AppShell on the page
  storageKey: 'wikipedia-sessions',
  currentSessionKey: 'wikipedia-current-session',
  searchPlaceholder: 'Search Wikipedia',
  emptyStateMessage: 'Search for a Wikipedia article to get started',
  contentClassName: 'wikipedia-content',
  apiEndpoint: '/api/wikipedia/search',
  lightContent: false,
  unwantedSelectors: [
    'style', 'script', 'noscript', '.hatnote',
    '.navbox', '.metadata', '.reference', 'sup.reference', '.mw-editsection',
  ],
  parseLinkClick: (href: string) => {
    const match = href.match(/\/wiki\/([^#?]+)/);
    return match ? decodeURIComponent(match[1].replace(/_/g, ' ')) : null;
  },
  renderSuggestions: (props) => <WikiSuggestions {...props} />,
  contentStyles: WIKIPEDIA_STYLES,
};

export function WikipediaReader() {
  return <ArticleReader config={wikipediaConfig} />;
}
