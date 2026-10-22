declare module 'sbd' {
  interface SentenceOptions {
    newline_boundaries?: boolean;
    html_boundaries?: boolean;
    sanitize?: boolean;
    allowed_tags?: boolean;
    preserve_whitespace?: boolean;
    abbreviations?: string[];
  }

  function sentences(text: string, options?: SentenceOptions): string[];
  
  export { sentences };
}
