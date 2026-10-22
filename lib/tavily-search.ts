/**
 * Tavily Web Search Service
 * 
 * Provides real-time web search for the LLM via Tavily's search API.
 * Tavily returns clean, LLM-ready content (not raw HTML), with relevance
 * scoring and source attribution — purpose-built for AI agents.
 * 
 * Free tier: 1,000 API credits/month. Basic search = 1 credit, advanced = 2.
 * Get your key at: https://app.tavily.com
 */

import { tavily } from '@tavily/core';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';

function getClient() {
  if (!TAVILY_API_KEY) {
    throw new Error('TAVILY_API_KEY is not set. Get a free key at https://app.tavily.com');
  }
  return tavily({ apiKey: TAVILY_API_KEY });
}

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export interface TavilySearchResponse {
  query: string;
  results: TavilySearchResult[];
  answer?: string;
  responseTime: number;
}

/**
 * Search the web using Tavily. Returns clean, relevant content snippets
 * with source URLs — ready to be consumed by the LLM.
 */
export async function tavilySearch(
  query: string,
  options: {
    searchDepth?: 'basic' | 'advanced';
    topic?: 'general' | 'news';
    maxResults?: number;
    includeAnswer?: boolean;
    includeDomains?: string[];
    excludeDomains?: string[];
    timeRange?: 'day' | 'week' | 'month' | 'year';
  } = {}
): Promise<TavilySearchResponse> {
  const client = getClient();

  const response = await client.search(query, {
    searchDepth: options.searchDepth || 'advanced',
    topic: options.topic || 'general',
    maxResults: options.maxResults || 5,
    includeAnswer: options.includeAnswer ?? true,
    includeDomains: options.includeDomains || [],
    excludeDomains: options.excludeDomains || [],
    ...(options.timeRange ? { timeRange: options.timeRange } : {}),
  });

  return {
    query: response.query,
    results: (response.results || []).map((r: { title: string; url: string; content: string; score: number }) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score,
    })),
    answer: response.answer || undefined,
    responseTime: response.responseTime,
  };
}

/**
 * Format Tavily search results into a clean string for the LLM.
 * Includes the AI-generated answer (if available) plus individual sources.
 */
export function formatSearchResults(response: TavilySearchResponse): string {
  let output = '';

  if (response.answer) {
    output += `Answer: ${response.answer}\n\n`;
  }

  output += `Sources (${response.results.length} results, ${response.responseTime.toFixed(1)}s):\n\n`;

  for (const result of response.results) {
    output += `[${result.title}](${result.url})\n`;
    output += `${result.content}\n\n`;
  }

  return output.trim();
}
