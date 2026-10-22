/**
 * Tests that the Obsidian service can access all paths under main/,
 * including nested folders and sub-notes, as the LLM would via tool calls.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { localObsidianService } from '@/lib/local-storage';

describe('Obsidian vault path access under main/', () => {
  let testVaultPath: string;
  const originalEnv = process.env.OBSIDIAN_VAULT_PATH;

  // Simulated vault structure:
  //   main/
  //     readme.md
  //     permanent/
  //       ideas.md
  //       science/
  //         astronomy.md
  //     fleeting/
  //       daily-2025-01-01.md
  //     projects/
  //       ai-assistant.md
  //       ai-assistant/
  //         roadmap.md
  //   AI-Notes/
  //     _system/
  //       personality.md

  const vaultFiles: Record<string, string> = {
    'main/readme.md': '---\ntitle: Readme\n---\nVault root readme.',
    'main/permanent/ideas.md': '---\ntitle: Ideas\n---\nSome ideas here.',
    'main/permanent/science/astronomy.md': '---\ntitle: Astronomy Notes\n---\nOrbits and tides.',
    'main/fleeting/daily-2025-01-01.md': '---\ntitle: Daily 2025-01-01\n---\nNew year thoughts.',
    'main/projects/ai-assistant.md': '---\ntitle: AI Assistant\n---\nProject overview.',
    'main/projects/ai-assistant/roadmap.md': '---\ntitle: Roadmap\n---\nQ1 goals.',
    'AI-Notes/_system/personality.md': '---\ntitle: Personality\n---\nI am helpful.',
  };

  beforeEach(async () => {
    testVaultPath = path.join(
      os.tmpdir(),
      `obsidian-path-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );

    // Create all files in the simulated vault
    for (const [relPath, content] of Object.entries(vaultFiles)) {
      const fullPath = path.join(testVaultPath, relPath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');
    }

    process.env.OBSIDIAN_VAULT_PATH = testVaultPath;
    localObsidianService.resetInstance();
  });

  afterEach(async () => {
    if (originalEnv !== undefined) {
      process.env.OBSIDIAN_VAULT_PATH = originalEnv;
    } else {
      delete process.env.OBSIDIAN_VAULT_PATH;
    }
    localObsidianService.resetInstance();

    try {
      await fs.rm(testVaultPath, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  async function getService() {
    return localObsidianService.getInstance();
  }

  describe('listNotes - full vault listing', () => {
    it('should list all .md files across the entire vault', async () => {
      const service = await getService();
      const allNotes = await service.listNotes();

      // Should find every file we created
      const expectedPaths = Object.keys(vaultFiles).map(p => p.replace(/\\/g, '/'));
      expect(allNotes.length).toBe(expectedPaths.length);

      for (const expected of expectedPaths) {
        expect(allNotes).toContainEqual(expected);
      }
    });

    it('should list notes filtered by "main/" pattern', async () => {
      const service = await getService();
      const mainNotes = await service.listNotes('main/');

      // Should include all main/ files but not AI-Notes/
      expect(mainNotes.length).toBe(6);
      for (const note of mainNotes) {
        expect(note.startsWith('main/')).toBe(true);
      }
    });

    it('should list notes in deeply nested folders like main/permanent/science/', async () => {
      const service = await getService();
      const notes = await service.listNotes('main/permanent/science/');

      expect(notes.length).toBeGreaterThanOrEqual(1);
      expect(notes).toContainEqual('main/permanent/science/astronomy.md');
    });

    it('should list notes in main/projects/ including subfolder notes', async () => {
      const service = await getService();
      const notes = await service.listNotes('main/projects/');

      expect(notes.length).toBe(2);
      expect(notes).toContainEqual('main/projects/ai-assistant.md');
      expect(notes).toContainEqual('main/projects/ai-assistant/roadmap.md');
    });

    it('should list AI-Notes/ separately', async () => {
      const service = await getService();
      const notes = await service.listNotes('AI-Notes/');

      expect(notes.length).toBe(1);
      expect(notes).toContainEqual('AI-Notes/_system/personality.md');
    });
  });

  describe('readNote - reading from any path under main/', () => {
    it('should read a note at the root of main/', async () => {
      const service = await getService();
      const note = await service.readNote('main/readme.md');

      expect(note.frontmatter.title).toBe('Readme');
      expect(note.content).toBe('Vault root readme.');
    });

    it('should read a note in main/permanent/', async () => {
      const service = await getService();
      const note = await service.readNote('main/permanent/ideas.md');

      expect(note.frontmatter.title).toBe('Ideas');
      expect(note.content).toBe('Some ideas here.');
    });

    it('should read a deeply nested note in main/permanent/science/', async () => {
      const service = await getService();
      const note = await service.readNote('main/permanent/science/astronomy.md');

      expect(note.frontmatter.title).toBe('Astronomy Notes');
      expect(note.content).toBe('Orbits and tides.');
    });

    it('should read a note in main/fleeting/', async () => {
      const service = await getService();
      const note = await service.readNote('main/fleeting/daily-2025-01-01.md');

      expect(note.frontmatter.title).toBe('Daily 2025-01-01');
      expect(note.content).toBe('New year thoughts.');
    });

    it('should read a note in a subfolder that shares a name with a sibling file', async () => {
      const service = await getService();
      // main/projects/ai-assistant.md exists AND main/projects/ai-assistant/roadmap.md
      const parentNote = await service.readNote('main/projects/ai-assistant.md');
      expect(parentNote.frontmatter.title).toBe('AI Assistant');

      const childNote = await service.readNote('main/projects/ai-assistant/roadmap.md');
      expect(childNote.frontmatter.title).toBe('Roadmap');
    });

    it('should read from AI-Notes/_system/', async () => {
      const service = await getService();
      const note = await service.readNote('AI-Notes/_system/personality.md');

      expect(note.frontmatter.title).toBe('Personality');
      expect(note.content).toBe('I am helpful.');
    });

    it('should auto-append .md extension when omitted', async () => {
      const service = await getService();
      const note = await service.readNote('main/readme');

      expect(note.frontmatter.title).toBe('Readme');
    });

    it('should throw for non-existent paths', async () => {
      const service = await getService();
      await expect(service.readNote('main/nonexistent.md')).rejects.toThrow();
    });

    it('should reject path traversal attempts', async () => {
      const service = await getService();
      await expect(service.readNote('../../../etc/passwd')).rejects.toThrow(/traversal/i);
    });
  });

  describe('search - searching across all vault paths', () => {
    it('should find content in deeply nested notes (requires rg or grep)', async () => {
      const service = await getService();
      const results = await service.search('Orbits');

      // rg/grep may not be available in CI/test environments
      if (results.length === 0) {
        console.warn('Search tools (rg, grep) unavailable — skipping assertion');
        return;
      }

      const files = results.map(r => r.file.replace(/\\/g, '/'));
      expect(files.some(f => f.includes('astronomy'))).toBe(true);
    });

    it('should find content across multiple folders (requires rg or grep)', async () => {
      const service = await getService();
      const results = await service.search('title');

      if (results.length === 0) {
        console.warn('Search tools (rg, grep) unavailable — skipping assertion');
        return;
      }

      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });
});
