'use client';

import { ArticleReader, ArticleReaderConfig, ArticleSession } from './ArticleReader';

const SEP_STYLES = `
  .sep-content {
    font-family: Georgia, 'Times New Roman', Times, serif;
    font-size: 33px;
    line-height: 1.9;
    color: #e5e7eb;
  }
  .sep-content * { background-color: transparent !important; }
  .sep-content p { margin-bottom: 1em; color: #e5e7eb; text-align: justify; }
  .sep-content h1, .sep-content h2, .sep-content h3,
  .sep-content h4, .sep-content h5, .sep-content h6 {
    color: #f9fafb; font-weight: 600; margin-top: 2em; margin-bottom: 0.8em;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .sep-content h2 { font-size: 1.9em; border-bottom: 2px solid #2a2a2a; padding-bottom: 0.4em; }
  .sep-content h3 { font-size: 1.5em; border-bottom: 1px solid #2a2a2a; padding-bottom: 0.3em; }
  .sep-content h4 { font-size: 1.25em; }
  .sep-content a { color: #b83030; text-decoration: none; border-bottom: 1px dotted #b83030; cursor: pointer; }
  .sep-content a:hover { color: #d84848; border-bottom: 1px solid #d84848; }
  .sep-content a:visited { color: #8b2020; }
  .sep-content ul, .sep-content ol { margin: 0.5em 0 1em 2em; padding: 0; }
  .sep-content li { margin-bottom: 0.5em; color: #e5e7eb; }
  .sep-content blockquote { border-left: 4px solid #b83030; padding: 1.5em 2em; margin: 1.5em 0; color: #d1d5db; font-style: italic; background: #050505 !important; border-radius: 0.3em; }
  .sep-content em { font-style: italic; color: #f3f4f6; }
  .sep-content strong { font-weight: 600; color: #f9fafb; }
  .sep-content code { background: #000000 !important; padding: 0.2em 0.4em; border-radius: 0.2em; font-family: 'Courier New', monospace; font-size: 0.9em; color: #f9fafb; border: 1px solid #1a1a1a; }
  .sep-content pre { background: #000000 !important; padding: 1em; border-radius: 0.3em; overflow-x: auto; border: 1px solid #1a1a1a; }
  .sep-content table { border-collapse: collapse; margin: 1.5em 0; background: #0a0a0a !important; border: 1px solid #2a2a2a; width: 100%; color: #e5e7eb; }
  .sep-content th, .sep-content td { border: 1px solid #2a2a2a; padding: 0.6em 0.8em; text-align: left; background: #0a0a0a !important; color: #e5e7eb; }
  .sep-content th { background: #1a1a1a !important; font-weight: 600; color: #f9fafb; }
  .sep-content tbody tr:nth-child(even) { background: #050505 !important; }
  .sep-content sup { font-size: 0.75em; vertical-align: super; }
  .sep-content sub { font-size: 0.75em; vertical-align: sub; }
  .sep-content dl { margin: 0.5em 0; }
  .sep-content dt { font-weight: 600; color: #f9fafb; margin-top: 0.5em; }
  .sep-content dd { margin-left: 2em; margin-bottom: 0.5em; color: #e5e7eb; }
`;

const sepConfig: ArticleReaderConfig = {
  title: 'Stanford Encyclopedia',
  hideHeader: true, // unified Navbar is provided by AppShell on the page
  storageKey: 'sep-sessions',
  currentSessionKey: 'sep-current-session',
  searchPlaceholder: 'Search Stanford Encyclopedia of Philosophy...',
  emptyStateMessage: 'Search for a philosophy article to get started',
  contentClassName: 'sep-content',
  apiEndpoint: '/api/sep/search',
  unwantedSelectors: [
    'style', 'script', 'noscript', '.reference', 'sup.reference',
    '.mw-editsection', '.toc', '.navbox',
  ],
  parseLinkClick: (href: string) => {
    const match = href.match(/plato\.stanford\.edu\/entries\/([^/]+)/);
    return match ? match[1] : null;
  },
  renderTitleExtra: (session: ArticleSession) => session.url ? (
    <a
      href={session.url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[#b83030] hover:text-[#d84848] hover:underline text-sm mb-8 inline-block"
    >
      View original on Stanford Encyclopedia of Philosophy →
    </a>
  ) : null,
  contentStyles: SEP_STYLES,
};

export function SEPReader() {
  return <ArticleReader config={sepConfig} />;
}
