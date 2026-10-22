/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

interface MarkdownMessageProps {
  content: string;
}

// Hoist static plugin arrays so they're not recreated on every render
const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

// Hoist static component overrides — these never change between renders.
// Exported so other markdown views (the vault preview) share the styling.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const markdownComponents: Record<string, React.ComponentType<any>> = {
  code: ({ inline, className, children, ...props }: any) => {
    const isInline = inline || !className;
    return isInline ? (
      <code className="bg-gray-800 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
        {children}
      </code>
    ) : (
      <code className={`block bg-gray-800 p-3 rounded-lg overflow-x-auto text-sm ${className || ''}`} {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }: any) => (
    <pre className="my-4 rounded-lg overflow-hidden">{children}</pre>
  ),
  h1: ({ children }: any) => <h1 className="text-2xl font-bold mt-4 mb-2">{children}</h1>,
  h2: ({ children }: any) => <h2 className="text-xl font-bold mt-3 mb-2">{children}</h2>,
  h3: ({ children }: any) => <h3 className="text-lg font-bold mt-2 mb-1">{children}</h3>,
  ul: ({ children }: any) => <ul className="list-disc list-inside my-2 space-y-1">{children}</ul>,
  ol: ({ children }: any) => <ol className="list-decimal list-inside my-2 space-y-1">{children}</ol>,
  a: ({ children, href }: any) => (
    <a href={href} className="text-navy-red-300 hover:text-navy-red-200 underline" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  table: ({ children }: any) => (
    <div className="overflow-x-auto my-4">
      <table className="min-w-full border-collapse border border-gray-600">{children}</table>
    </div>
  ),
  th: ({ children }: any) => (
    <th className="border border-gray-600 px-4 py-2 bg-gray-800 font-bold text-left">{children}</th>
  ),
  td: ({ children }: any) => (
    <td className="border border-gray-600 px-4 py-2">{children}</td>
  ),
  p: ({ children }: any) => <p className="my-2">{children}</p>,
  blockquote: ({ children }: any) => (
    <blockquote className="border-l-4 border-gray-600 pl-4 italic my-2">{children}</blockquote>
  ),
};

export const MarkdownMessage = React.memo(function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <div className="prose prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
