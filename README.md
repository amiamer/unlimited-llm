# unlimited-llm

A self-hosted reading and thinking workspace: a reader for books and reference
articles, an LLM chat that can work with my notes, and an editor for my Obsidian
vaults. It runs on my PC during the day and on a small cloud server everywhere
else, with both copies kept in sync through git.

> A personal tool shared as a portfolio piece, not a turnkey product. It expects
> your own API keys, Obsidian vaults and books.

## What it does

| Surface | Route | Summary |
|---|---|---|
| **Reader** | `/reader` | One reader over EPUB, PDF, Wikipedia, the Stanford Encyclopedia of Philosophy and the Internet Encyclopedia of Philosophy. Sentence-level highlights and margin comments, AI replies on a highlight, chapter summaries, read-along, and annotations written back to Obsidian as notes. |
| **Chat** | `/chat` | Streaming chat through OpenRouter (any model) with tool calling: vault search and edits, web search, file and git tools, and a curated context layer that retrieves notes as evidence instead of stuffing the whole vault into the prompt. |
| **Vault** | `/vault` | In-browser editor for two Obsidian vaults: file tree, full-text search, wikilinks, live preview, autosave with conflict detection against edits made in Obsidian. |
| **Knowledge map** | `/knowledge-map` | Graph of what I'm reading and how it connects, with a two-way bridge to Obsidian canvas files. |
| **Habits, reading list** | `/habit-tracker`, `/reading-list` | Small trackers backed by vault files. |

## How it's built

- **Next.js 14** (App Router), React 18, TypeScript, Tailwind
- **LLMs:** OpenRouter (OpenAI-compatible API) as the single provider, so the model is a config value
- **Auth:** Clerk with an email allowlist
- **Storage:** plain files. Notes are Markdown in Obsidian vaults; annotations, chat sessions and saved articles are JSON files; the browser's IndexedDB is only a cache. No database.
- **Sync:** every vault and data folder is a private git repo. A small script commits, rebases and pushes on a timer on each machine; on a conflict it keeps both versions rather than picking one.
- **Hosting:** a single Linux VM running `next start` behind nginx, reached through a Cloudflare Tunnel with Cloudflare Access in front, so no ports are open to the internet.
- **Tests:** Vitest, React Testing Library and fast-check property tests

## Things I'd point at

- **Annotation durability.** Highlights are anchored to sentences and survive re-rendering; the store refuses to overwrite a non-empty set with an empty one and keeps rotating backups, after a bug once wiped a book's notes.
- **Reader AI without personal context.** Replies in the reader use a focused prompt with no memory or vault access, so side features don't inherit the assistant's personal context.
- **Edit conflicts.** The vault editor saves against the file's last-seen modification time and asks before overwriting a note changed in Obsidian or on the other machine.

## Running it

```bash
npm install
cp .env.example .env   # fill in the keys for the features you want
npm run dev            # http://localhost:3000
npm test
```

Minimum to boot: a Clerk key pair, `ALLOWED_EMAILS`, `OPENROUTER_API_KEY`, and
`OBSIDIAN_VAULT_PATH`. Everything else is optional and switches off when its
variables are missing. See
[`.env.example`](.env.example).
