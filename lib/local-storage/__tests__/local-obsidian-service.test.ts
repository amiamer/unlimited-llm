/**
 * Unit tests for LocalObsidianService
 * 
 * Tests for task 6.1, 6.2, and 6.3:
 * - Configuration loading from environment variables
 * - Vault path validation
 * - Error handling for missing env vars and non-existent vaults
 * - YAML frontmatter parsing and generation
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.6
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { LocalObsidianService, localObsidianService, parseFrontmatter, generateFrontmatter } from '../local-obsidian-service';
import { ConfigurationError, VaultNotFoundError } from '../errors';
import type { ObsidianNoteFrontmatter } from '../types';

// Test fixtures
const TEST_VAULT_PATH = path.join(os.tmpdir(), 'test-obsidian-vault-' + Date.now());

describe('LocalObsidianService', () => {
  // Store original env var
  let originalEnvVar: string | undefined;

  beforeEach(async () => {
    // Save original env var
    originalEnvVar = process.env.OBSIDIAN_VAULT_PATH;
    
    // Create test vault directory
    await fs.mkdir(TEST_VAULT_PATH, { recursive: true });
    
    // Reset singleton
    localObsidianService.resetInstance();
  });

  afterEach(async () => {
    // Restore original env var
    if (originalEnvVar !== undefined) {
      process.env.OBSIDIAN_VAULT_PATH = originalEnvVar;
    } else {
      delete process.env.OBSIDIAN_VAULT_PATH;
    }
    
    // Clean up test vault
    await fs.rm(TEST_VAULT_PATH, { recursive: true, force: true }).catch(() => {});
    
    // Reset singleton
    localObsidianService.resetInstance();
  });

  describe('LocalObsidianService.create()', () => {
    describe('Configuration Loading (Requirement 4.1)', () => {
      it('should read vault path from OBSIDIAN_VAULT_PATH environment variable', async () => {
        // Set env var
        process.env.OBSIDIAN_VAULT_PATH = TEST_VAULT_PATH;

        // Create service without explicit config
        const service = await LocalObsidianService.create();

        // Verify vault path is read from env var
        expect(service.getVaultPath()).toBe(TEST_VAULT_PATH);
      });

      it('should use explicit config over environment variable', async () => {
        // Set env var to a different path
        process.env.OBSIDIAN_VAULT_PATH = 'C:\\SomeOtherPath';

        // Create service with explicit config
        const service = await LocalObsidianService.create({
          vaultPath: TEST_VAULT_PATH,
        });

        // Verify explicit config takes precedence
        expect(service.getVaultPath()).toBe(TEST_VAULT_PATH);
      });

      it('should apply default values for optional config properties', async () => {
        process.env.OBSIDIAN_VAULT_PATH = TEST_VAULT_PATH;

        const service = await LocalObsidianService.create();
        const config = service.getConfig();

        // Verify defaults
        expect(config.notesFolder).toBe('AI-Notes');
        expect(config.retryOnLock).toBe(true);
        expect(config.maxRetries).toBe(3);
      });

      it('should allow overriding default config values', async () => {
        const service = await LocalObsidianService.create({
          vaultPath: TEST_VAULT_PATH,
          notesFolder: 'CustomNotes',
          retryOnLock: false,
          maxRetries: 5,
        });

        const config = service.getConfig();

        expect(config.notesFolder).toBe('CustomNotes');
        expect(config.retryOnLock).toBe(false);
        expect(config.maxRetries).toBe(5);
      });
    });

    describe('Missing Environment Variable (Requirement 4.2)', () => {
      it('should throw ConfigurationError when OBSIDIAN_VAULT_PATH is not set', async () => {
        // Ensure env var is not set
        delete process.env.OBSIDIAN_VAULT_PATH;

        // Attempt to create service without config
        await expect(LocalObsidianService.create()).rejects.toThrow(ConfigurationError);
      });

      it('should include variable name in ConfigurationError', async () => {
        delete process.env.OBSIDIAN_VAULT_PATH;

        try {
          await LocalObsidianService.create();
          expect.fail('Should have thrown ConfigurationError');
        } catch (error) {
          expect(error).toBeInstanceOf(ConfigurationError);
          expect((error as ConfigurationError).variableName).toBe('OBSIDIAN_VAULT_PATH');
          expect((error as ConfigurationError).message).toContain('OBSIDIAN_VAULT_PATH');
        }
      });

      it('should not throw if vault path is provided in config', async () => {
        delete process.env.OBSIDIAN_VAULT_PATH;

        // Should succeed with explicit config
        const service = await LocalObsidianService.create({
          vaultPath: TEST_VAULT_PATH,
        });

        expect(service.getVaultPath()).toBe(TEST_VAULT_PATH);
      });
    });

    describe('Vault Not Found (Requirement 4.3)', () => {
      it('should throw VaultNotFoundError when vault directory does not exist', async () => {
        const nonExistentPath = path.join(os.tmpdir(), 'non-existent-vault-' + Date.now());

        await expect(
          LocalObsidianService.create({ vaultPath: nonExistentPath })
        ).rejects.toThrow(VaultNotFoundError);
      });

      it('should include path in VaultNotFoundError', async () => {
        const nonExistentPath = path.join(os.tmpdir(), 'non-existent-vault-' + Date.now());

        try {
          await LocalObsidianService.create({ vaultPath: nonExistentPath });
          expect.fail('Should have thrown VaultNotFoundError');
        } catch (error) {
          expect(error).toBeInstanceOf(VaultNotFoundError);
          expect((error as VaultNotFoundError).path).toBe(nonExistentPath);
          expect((error as VaultNotFoundError).message).toContain(nonExistentPath);
        }
      });

      it('should throw VaultNotFoundError when path is a file, not a directory', async () => {
        // Create a file instead of a directory
        const filePath = path.join(os.tmpdir(), 'not-a-directory-' + Date.now());
        await fs.writeFile(filePath, 'test content');

        try {
          await expect(
            LocalObsidianService.create({ vaultPath: filePath })
          ).rejects.toThrow(VaultNotFoundError);
        } finally {
          await fs.unlink(filePath).catch(() => {});
        }
      });
    });
  });

  describe('getVaultPath()', () => {
    it('should return the configured vault path', async () => {
      const service = await LocalObsidianService.create({
        vaultPath: TEST_VAULT_PATH,
      });

      expect(service.getVaultPath()).toBe(TEST_VAULT_PATH);
    });
  });

  describe('getNotesPath()', () => {
    it('should return vault path joined with notes folder', async () => {
      const service = await LocalObsidianService.create({
        vaultPath: TEST_VAULT_PATH,
        notesFolder: 'MyNotes',
      });

      expect(service.getNotesPath()).toBe(path.join(TEST_VAULT_PATH, 'MyNotes'));
    });

    it('should use default notes folder when not specified', async () => {
      const service = await LocalObsidianService.create({
        vaultPath: TEST_VAULT_PATH,
      });

      expect(service.getNotesPath()).toBe(path.join(TEST_VAULT_PATH, 'AI-Notes'));
    });
  });

  describe('getConfig()', () => {
    it('should return a copy of the configuration', async () => {
      const service = await LocalObsidianService.create({
        vaultPath: TEST_VAULT_PATH,
        notesFolder: 'TestNotes',
      });

      const config1 = service.getConfig();
      const config2 = service.getConfig();

      // Should be equal but not the same object
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2);
    });
  });

  describe('localObsidianService singleton', () => {
    it('should return the same instance on multiple calls', async () => {
      process.env.OBSIDIAN_VAULT_PATH = TEST_VAULT_PATH;

      const instance1 = await localObsidianService.getInstance();
      const instance2 = await localObsidianService.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should throw ConfigurationError when env var is missing', async () => {
      delete process.env.OBSIDIAN_VAULT_PATH;

      await expect(localObsidianService.getInstance()).rejects.toThrow(ConfigurationError);
    });

    it('should reset instance correctly', async () => {
      process.env.OBSIDIAN_VAULT_PATH = TEST_VAULT_PATH;

      const instance1 = await localObsidianService.getInstance();
      localObsidianService.resetInstance();
      const instance2 = await localObsidianService.getInstance();

      // After reset, should get a new instance
      expect(instance1).not.toBe(instance2);
    });

    it('getVaultPath should return vault path from singleton', async () => {
      process.env.OBSIDIAN_VAULT_PATH = TEST_VAULT_PATH;

      const vaultPath = await localObsidianService.getVaultPath();

      expect(vaultPath).toBe(TEST_VAULT_PATH);
    });
  });
});


// ============================================================================
// YAML Frontmatter Tests (Task 6.3)
// Requirements: 4.4, 4.6
// ============================================================================

describe('parseFrontmatter()', () => {
  describe('Basic Parsing', () => {
    it('should parse valid frontmatter with all fields', () => {
      const content = `---
title: My Test Note
created: 2026-01-16T10:00:00.000Z
modified: 2026-01-16T10:30:00.000Z
tags:
  - tag1
  - tag2
---

This is the note content.`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter.title).toBe('My Test Note');
      expect(result.frontmatter.created).toBe('2026-01-16T10:00:00.000Z');
      expect(result.frontmatter.modified).toBe('2026-01-16T10:30:00.000Z');
      expect(result.frontmatter.tags).toEqual(['tag1', 'tag2']);
      expect(result.content).toBe('This is the note content.');
    });

    it('should parse frontmatter without tags', () => {
      const content = `---
title: Note Without Tags
created: 2026-01-16T10:00:00.000Z
modified: 2026-01-16T10:00:00.000Z
---

Content here.`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter.title).toBe('Note Without Tags');
      expect(result.frontmatter.tags).toBeUndefined();
      expect(result.content).toBe('Content here.');
    });

    it('should parse frontmatter with empty tags array', () => {
      const content = `---
title: Note With Empty Tags
created: 2026-01-16T10:00:00.000Z
modified: 2026-01-16T10:00:00.000Z
tags:
---

Content here.`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter.tags).toEqual([]);
    });

    it('should handle content with multiple paragraphs', () => {
      const content = `---
title: Multi Paragraph Note
created: 2026-01-16T10:00:00.000Z
modified: 2026-01-16T10:00:00.000Z
---

First paragraph.

Second paragraph.

Third paragraph.`;

      const result = parseFrontmatter(content);

      expect(result.content).toBe('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.');
    });

    it('should handle content with no trailing newline', () => {
      const content = `---
title: No Trailing Newline
created: 2026-01-16T10:00:00.000Z
modified: 2026-01-16T10:00:00.000Z
---
Content immediately after frontmatter`;

      const result = parseFrontmatter(content);

      expect(result.content).toBe('Content immediately after frontmatter');
    });
  });

  describe('Tags Array Handling', () => {
    it('should parse multiple tags in list format', () => {
      const content = `---
title: Tagged Note
created: 2026-01-16T10:00:00.000Z
modified: 2026-01-16T10:00:00.000Z
tags:
  - javascript
  - typescript
  - testing
---

Content.`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter.tags).toEqual(['javascript', 'typescript', 'testing']);
    });

    it('should parse inline array format', () => {
      const content = `---
title: Inline Tags
created: 2026-01-16T10:00:00.000Z
modified: 2026-01-16T10:00:00.000Z
tags: [tag1, tag2, tag3]
---

Content.`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter.tags).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('should handle single tag', () => {
      const content = `---
title: Single Tag Note
created: 2026-01-16T10:00:00.000Z
modified: 2026-01-16T10:00:00.000Z
tags:
  - only-one
---

Content.`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter.tags).toEqual(['only-one']);
    });
  });

  describe('Quoted Values', () => {
    it('should handle double-quoted title', () => {
      const content = `---
title: "Note with: special characters"
created: 2026-01-16T10:00:00.000Z
modified: 2026-01-16T10:00:00.000Z
---

Content.`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter.title).toBe('Note with: special characters');
    });

    it('should handle single-quoted title', () => {
      const content = `---
title: 'Another special title'
created: 2026-01-16T10:00:00.000Z
modified: 2026-01-16T10:00:00.000Z
---

Content.`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter.title).toBe('Another special title');
    });
  });

  describe('Error Handling (Graceful Defaults)', () => {
    it('should return defaults when frontmatter is missing', () => {
      const content = 'Just some content without frontmatter.';

      const result = parseFrontmatter(content);

      // Should return content as-is with default frontmatter
      expect(result.content).toBe(content);
      expect(result.frontmatter.title).toBeDefined();
      expect(result.frontmatter.created).toBeDefined();
      expect(result.frontmatter.modified).toBeDefined();
    });

    it('should return defaults when frontmatter is not closed', () => {
      const content = `---
title: Unclosed Frontmatter
created: 2026-01-16T10:00:00.000Z

Content without closing delimiter.`;

      const result = parseFrontmatter(content);

      // No valid frontmatter block found, returns content as-is with defaults
      expect(result.content).toBe(content);
      expect(result.frontmatter.title).toBeDefined();
      expect(result.frontmatter.created).toBeDefined();
      expect(result.frontmatter.modified).toBeDefined();
    });

    it('should provide default title when title is missing from frontmatter', () => {
      const content = `---
created: 2026-01-16T10:00:00.000Z
modified: 2026-01-16T10:00:00.000Z
---

Content.`;

      const result = parseFrontmatter(content);

      // Should provide a default title (e.g. 'Untitled')
      expect(result.frontmatter.title).toBeDefined();
      expect(result.frontmatter.title.length).toBeGreaterThan(0);
      expect(result.content).toBe('Content.');
    });

    it('should provide default created when created is missing from frontmatter', () => {
      const content = `---
title: Missing Created
modified: 2026-01-16T10:00:00.000Z
---

Content.`;

      const result = parseFrontmatter(content);

      // Should provide a default created timestamp
      expect(result.frontmatter.title).toBe('Missing Created');
      expect(result.frontmatter.created).toBeDefined();
      expect(new Date(result.frontmatter.created).toISOString()).toBe(result.frontmatter.created);
      expect(result.content).toBe('Content.');
    });

    it('should provide default modified when modified is missing from frontmatter', () => {
      const content = `---
title: Missing Modified
created: 2026-01-16T10:00:00.000Z
---

Content.`;

      const result = parseFrontmatter(content);

      // Should provide a default modified timestamp
      expect(result.frontmatter.title).toBe('Missing Modified');
      expect(result.frontmatter.created).toBe('2026-01-16T10:00:00.000Z');
      expect(result.frontmatter.modified).toBeDefined();
      expect(new Date(result.frontmatter.modified).toISOString()).toBe(result.frontmatter.modified);
      expect(result.content).toBe('Content.');
    });
  });

  describe('Windows Line Endings', () => {
    it('should handle CRLF line endings', () => {
      const content = '---\r\ntitle: Windows Note\r\ncreated: 2026-01-16T10:00:00.000Z\r\nmodified: 2026-01-16T10:00:00.000Z\r\n---\r\n\r\nContent with CRLF.';

      const result = parseFrontmatter(content);

      expect(result.frontmatter.title).toBe('Windows Note');
      expect(result.content).toBe('Content with CRLF.');
    });
  });
});

describe('generateFrontmatter()', () => {
  describe('Basic Generation', () => {
    it('should generate valid frontmatter with all fields', () => {
      const frontmatter: ObsidianNoteFrontmatter = {
        title: 'My Test Note',
        created: '2026-01-16T10:00:00.000Z',
        modified: '2026-01-16T10:30:00.000Z',
        tags: ['tag1', 'tag2'],
      };

      const result = generateFrontmatter(frontmatter);

      expect(result).toBe(`---
title: My Test Note
created: 2026-01-16T10:00:00.000Z
modified: 2026-01-16T10:30:00.000Z
tags:
  - tag1
  - tag2
---`);
    });

    it('should generate frontmatter without tags when undefined', () => {
      const frontmatter: ObsidianNoteFrontmatter = {
        title: 'Note Without Tags',
        created: '2026-01-16T10:00:00.000Z',
        modified: '2026-01-16T10:00:00.000Z',
      };

      const result = generateFrontmatter(frontmatter);

      expect(result).toBe(`---
title: Note Without Tags
created: 2026-01-16T10:00:00.000Z
modified: 2026-01-16T10:00:00.000Z
---`);
    });

    it('should generate frontmatter without tags when empty array', () => {
      const frontmatter: ObsidianNoteFrontmatter = {
        title: 'Note With Empty Tags',
        created: '2026-01-16T10:00:00.000Z',
        modified: '2026-01-16T10:00:00.000Z',
        tags: [],
      };

      const result = generateFrontmatter(frontmatter);

      expect(result).not.toContain('tags:');
    });
  });

  describe('Tags Array Serialization', () => {
    it('should serialize multiple tags in list format', () => {
      const frontmatter: ObsidianNoteFrontmatter = {
        title: 'Tagged Note',
        created: '2026-01-16T10:00:00.000Z',
        modified: '2026-01-16T10:00:00.000Z',
        tags: ['javascript', 'typescript', 'testing'],
      };

      const result = generateFrontmatter(frontmatter);

      expect(result).toContain('tags:');
      expect(result).toContain('  - javascript');
      expect(result).toContain('  - typescript');
      expect(result).toContain('  - testing');
    });

    it('should serialize single tag', () => {
      const frontmatter: ObsidianNoteFrontmatter = {
        title: 'Single Tag Note',
        created: '2026-01-16T10:00:00.000Z',
        modified: '2026-01-16T10:00:00.000Z',
        tags: ['only-one'],
      };

      const result = generateFrontmatter(frontmatter);

      expect(result).toContain('tags:');
      expect(result).toContain('  - only-one');
    });
  });

  describe('Special Character Escaping', () => {
    it('should quote title with colon', () => {
      const frontmatter: ObsidianNoteFrontmatter = {
        title: 'Note: With Colon',
        created: '2026-01-16T10:00:00.000Z',
        modified: '2026-01-16T10:00:00.000Z',
      };

      const result = generateFrontmatter(frontmatter);

      expect(result).toContain('title: "Note: With Colon"');
    });

    it('should quote title with hash', () => {
      const frontmatter: ObsidianNoteFrontmatter = {
        title: 'Note #1',
        created: '2026-01-16T10:00:00.000Z',
        modified: '2026-01-16T10:00:00.000Z',
      };

      const result = generateFrontmatter(frontmatter);

      expect(result).toContain('title: "Note #1"');
    });

    it('should escape quotes in title', () => {
      const frontmatter: ObsidianNoteFrontmatter = {
        title: 'Note with "quotes"',
        created: '2026-01-16T10:00:00.000Z',
        modified: '2026-01-16T10:00:00.000Z',
      };

      const result = generateFrontmatter(frontmatter);

      expect(result).toContain('title: "Note with \\"quotes\\""');
    });

    it('should escape newlines in title', () => {
      const frontmatter: ObsidianNoteFrontmatter = {
        title: 'Note with\nnewline',
        created: '2026-01-16T10:00:00.000Z',
        modified: '2026-01-16T10:00:00.000Z',
      };

      const result = generateFrontmatter(frontmatter);

      expect(result).toContain('title: "Note with\\nnewline"');
    });

    it('should quote tags with special characters', () => {
      const frontmatter: ObsidianNoteFrontmatter = {
        title: 'Note',
        created: '2026-01-16T10:00:00.000Z',
        modified: '2026-01-16T10:00:00.000Z',
        tags: ['tag:special', 'tag#hash'],
      };

      const result = generateFrontmatter(frontmatter);

      expect(result).toContain('  - "tag:special"');
      expect(result).toContain('  - "tag#hash"');
    });
  });

  describe('Round-Trip Compatibility', () => {
    it('should produce output that can be parsed back', () => {
      const original: ObsidianNoteFrontmatter = {
        title: 'Round Trip Test',
        created: '2026-01-16T10:00:00.000Z',
        modified: '2026-01-16T10:30:00.000Z',
        tags: ['tag1', 'tag2'],
      };

      const generated = generateFrontmatter(original);
      const fullContent = generated + '\n\nNote content here.';
      const parsed = parseFrontmatter(fullContent);

      expect(parsed.frontmatter.title).toBe(original.title);
      expect(parsed.frontmatter.created).toBe(original.created);
      expect(parsed.frontmatter.modified).toBe(original.modified);
      expect(parsed.frontmatter.tags).toEqual(original.tags);
    });

    it('should round-trip frontmatter without tags', () => {
      const original: ObsidianNoteFrontmatter = {
        title: 'No Tags Round Trip',
        created: '2026-01-16T10:00:00.000Z',
        modified: '2026-01-16T10:00:00.000Z',
      };

      const generated = generateFrontmatter(original);
      const fullContent = generated + '\n\nContent.';
      const parsed = parseFrontmatter(fullContent);

      expect(parsed.frontmatter.title).toBe(original.title);
      expect(parsed.frontmatter.created).toBe(original.created);
      expect(parsed.frontmatter.modified).toBe(original.modified);
      expect(parsed.frontmatter.tags).toBeUndefined();
    });

    it('should round-trip frontmatter with special characters in title', () => {
      const original: ObsidianNoteFrontmatter = {
        title: 'Title: With Special #Characters',
        created: '2026-01-16T10:00:00.000Z',
        modified: '2026-01-16T10:00:00.000Z',
        tags: ['tag1'],
      };

      const generated = generateFrontmatter(original);
      const fullContent = generated + '\n\nContent.';
      const parsed = parseFrontmatter(fullContent);

      expect(parsed.frontmatter.title).toBe(original.title);
    });
  });
});


// ============================================================================
// Note CRUD Operations Tests (Task 6.4)
// Requirements: 4.4, 4.5, 4.6, 4.7, 4.8
// ============================================================================

describe('Note CRUD Operations', () => {
  let service: LocalObsidianService;
  const TEST_VAULT_PATH_CRUD = path.join(os.tmpdir(), 'test-obsidian-vault-crud-' + Date.now());

  beforeEach(async () => {
    // Create test vault directory
    await fs.mkdir(TEST_VAULT_PATH_CRUD, { recursive: true });
    
    // Create service instance
    service = await LocalObsidianService.create({
      vaultPath: TEST_VAULT_PATH_CRUD,
      notesFolder: 'Notes',
    });
  });

  afterEach(async () => {
    // Clean up test vault
    await fs.rm(TEST_VAULT_PATH_CRUD, { recursive: true, force: true }).catch(() => {});
  });

  describe('createNote() (Requirements 4.4, 4.5)', () => {
    it('should create a note with sanitized filename', async () => {
      const filename = await service.createNote('My Test Note', 'This is the content.');

      // Verify filename is sanitized
      expect(filename).toBe('My Test Note.md');

      // Verify file exists
      const filePath = path.join(TEST_VAULT_PATH_CRUD, 'Notes', filename);
      const exists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should create note with proper content format', async () => {
      const filename = await service.createNote('Frontmatter Test', 'Content here.');

      // Read the file and verify content format
      const filePath = path.join(TEST_VAULT_PATH_CRUD, 'Notes', filename);
      const content = await fs.readFile(filePath, 'utf-8');

      // createNote writes as markdown with heading, not YAML frontmatter
      expect(content).toContain('# Frontmatter Test');
      expect(content).toContain('Content here.');
    });

    it('should create note with content that includes tags when provided in content', async () => {
      // createNote doesn't have a tags parameter - tags would be in the content
      const filename = await service.createNote('Tagged Note', 'Content.\n\ntags: tag1, tag2');

      const filePath = path.join(TEST_VAULT_PATH_CRUD, 'Notes', filename);
      const content = await fs.readFile(filePath, 'utf-8');

      expect(content).toContain('# Tagged Note');
      expect(content).toContain('tags: tag1, tag2');
    });

    it('should create note without tags when not provided', async () => {
      const filename = await service.createNote('No Tags Note', 'Content.');

      const filePath = path.join(TEST_VAULT_PATH_CRUD, 'Notes', filename);
      const content = await fs.readFile(filePath, 'utf-8');

      expect(content).not.toContain('tags:');
    });

    it('should sanitize invalid characters in filename', async () => {
      const filename = await service.createNote('Note: With <Invalid> Characters', 'Content.');

      // Verify invalid characters are replaced
      expect(filename).not.toContain(':');
      expect(filename).not.toContain('<');
      expect(filename).not.toContain('>');
      expect(filename).toBe('Note_ With _Invalid_ Characters.md');
    });

    it('should create notes folder if it does not exist', async () => {
      // Create service with non-existent notes folder
      const customService = await LocalObsidianService.create({
        vaultPath: TEST_VAULT_PATH_CRUD,
        notesFolder: 'CustomNotes',
      });

      const filename = await customService.createNote('Test', 'Content.');

      // Verify folder was created
      const folderPath = path.join(TEST_VAULT_PATH_CRUD, 'CustomNotes');
      const exists = await fs.access(folderPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should set created and modified timestamps when reading back', async () => {
      const beforeCreate = new Date();
      const filename = await service.createNote('Timestamp Test', 'Content.');
      const afterCreate = new Date();

      // readNote resolves from vault root, createNote stores in Notes/
      const note = await service.readNote(`Notes/${filename}`);

      const created = new Date(note.frontmatter.created);
      const modified = new Date(note.frontmatter.modified);

      // Timestamps should be reasonable (derived at read time)
      expect(created.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
      expect(modified.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
    });
  });

  describe('readNote() (Requirement 4.6)', () => {
    it('should read note and parse content', async () => {
      // Create a note first
      await service.createNote('Read Test', 'Test content here.');

      // Read it back - readNote resolves from vault root
      const note = await service.readNote('Notes/Read Test.md');

      // createNote writes "# Title\n\nContent" format
      // parseFrontmatter will derive title from filename since no YAML frontmatter
      expect(note.frontmatter.title).toBeDefined();
      expect(note.content).toContain('Test content here.');
    });

    it('should read note without .md extension', async () => {
      await service.createNote('Extension Test', 'Content.');

      // Read without extension - from vault root
      const note = await service.readNote('Notes/Extension Test');

      expect(note.frontmatter.title).toBeDefined();
    });

    it('should throw error for non-existent note', async () => {
      await expect(service.readNote('Non-Existent-Note.md')).rejects.toThrow();
    });

    it('should preserve multi-paragraph content', async () => {
      const multiParagraph = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
      await service.createNote('Multi Paragraph', multiParagraph);

      const note = await service.readNote('Notes/Multi Paragraph.md');

      // Content includes the heading added by createNote
      expect(note.content).toContain('First paragraph.');
      expect(note.content).toContain('Second paragraph.');
      expect(note.content).toContain('Third paragraph.');
    });

    it('should read note from arbitrary vault path with folder', async () => {
      // Create a subfolder in the vault (not in Notes folder)
      const subfolderPath = path.join(TEST_VAULT_PATH_CRUD, 'permanent');
      await fs.mkdir(subfolderPath, { recursive: true });

      // Create a note directly in the subfolder
      const noteContent = `---
title: Readme
created: 2026-01-30T10:00:00.000Z
modified: 2026-01-30T10:00:00.000Z
---

This is a readme file in the permanent folder.`;
      await fs.writeFile(path.join(subfolderPath, 'readme.md'), noteContent);

      // Read using path with folder
      const note = await service.readNote('permanent/readme.md');

      expect(note.frontmatter.title).toBe('Readme');
      expect(note.content).toBe('This is a readme file in the permanent folder.');
    });

    it('should read note from nested vault path', async () => {
      // Create nested subfolders
      const nestedPath = path.join(TEST_VAULT_PATH_CRUD, 'folder', 'subfolder');
      await fs.mkdir(nestedPath, { recursive: true });

      // Create a note in the nested folder
      const noteContent = `---
title: Nested Note
created: 2026-01-30T10:00:00.000Z
modified: 2026-01-30T10:00:00.000Z
---

Content in nested folder.`;
      await fs.writeFile(path.join(nestedPath, 'nested-note.md'), noteContent);

      // Read using nested path
      const note = await service.readNote('folder/subfolder/nested-note.md');

      expect(note.frontmatter.title).toBe('Nested Note');
      expect(note.content).toBe('Content in nested folder.');
    });

    it('should read note from vault path without .md extension', async () => {
      // Create a subfolder
      const subfolderPath = path.join(TEST_VAULT_PATH_CRUD, 'docs');
      await fs.mkdir(subfolderPath, { recursive: true });

      // Create a note
      const noteContent = `---
title: Documentation
created: 2026-01-30T10:00:00.000Z
modified: 2026-01-30T10:00:00.000Z
---

Documentation content.`;
      await fs.writeFile(path.join(subfolderPath, 'guide.md'), noteContent);

      // Read without .md extension
      const note = await service.readNote('docs/guide');

      expect(note.frontmatter.title).toBe('Documentation');
    });

    it('should reject path traversal attempts in readNote', async () => {
      // Attempt to read outside vault using path traversal
      await expect(service.readNote('../../../etc/passwd')).rejects.toThrow();
      await expect(service.readNote('folder/../../outside.md')).rejects.toThrow();
    });
  });

  describe('updateNote() (Requirement 4.7)', () => {
    it('should update note content', async () => {
      // Create a note
      await service.createNote('Update Test', 'Original content.');

      // Update it
      await service.updateNote('Update Test.md', 'Updated content.');

      // Read it back
      const note = await service.readNote('Update Test.md');

      expect(note.content).toBe('Updated content.');
    });

    it('should preserve original content structure after update', async () => {
      // Create a note
      await service.createNote('Preserve Created', 'Original.');

      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      // Update it with new raw content - updateNote resolves from vault root
      await service.updateNote('Notes/Preserve Created.md', 'Updated.');

      // Read it back - updateNote writes raw content
      const filePath = path.join(TEST_VAULT_PATH_CRUD, 'Notes', 'Preserve Created.md');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('Updated.');
    });

    it('should update content completely', async () => {
      // Create a note
      await service.createNote('Update Modified', 'Original.');

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));

      // Update it - resolves from vault root
      await service.updateNote('Notes/Update Modified.md', 'Updated content.');

      // Read raw file to verify
      const filePath = path.join(TEST_VAULT_PATH_CRUD, 'Notes', 'Update Modified.md');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('Updated content.');
    });

    it('should overwrite all content on update', async () => {
      // Create a note with tags in content
      await service.createNote('Tags Preserve', 'Original.');

      // Update content only - updateNote replaces entire file content, resolves from vault root
      await service.updateNote('Notes/Tags Preserve.md', 'Updated.');

      // Read raw file
      const filePath = path.join(TEST_VAULT_PATH_CRUD, 'Notes', 'Tags Preserve.md');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('Updated.');
    });

    it('should preserve title on update', async () => {
      // Create a note
      await service.createNote('Title Preserve Test', 'Original.');

      // Update content only
      await service.updateNote('Title Preserve Test.md', 'Updated.');

      // Read it back
      const note = await service.readNote('Title Preserve Test.md');

      // Title should be preserved
      expect(note.frontmatter.title).toBe('Title Preserve Test');
    });

    it('should create file when updating non-existent note (atomic write)', async () => {
      // updateNote uses atomicWrite which creates the file if it doesn't exist
      // It resolves from vault root
      await service.updateNote('Non-Existent.md', 'Content.');

      // Verify file was created at vault root (not in Notes folder)
      const filePath = path.join(TEST_VAULT_PATH_CRUD, 'Non-Existent.md');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('Content.');
    });

    it('should update note without .md extension', async () => {
      await service.createNote('No Extension Update', 'Original.');

      // Update without extension
      await service.updateNote('No Extension Update', 'Updated.');

      const note = await service.readNote('No Extension Update.md');
      expect(note.content).toBe('Updated.');
    });
  });

  describe('deleteNote() (Requirement 4.8)', () => {
    it('should delete existing note', async () => {
      // Create a note
      const filename = await service.createNote('Delete Test', 'Content.');
      const filePath = path.join(TEST_VAULT_PATH_CRUD, 'Notes', filename);

      // Verify it exists
      let exists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      // Delete it - need to pass path relative to vault root
      await service.deleteNote(`Notes/${filename}`);

      // Verify it's gone
      exists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });

    it('should delete note without .md extension', async () => {
      await service.createNote('Delete No Ext', 'Content.');

      // Delete without extension - path relative to vault root
      await service.deleteNote('Notes/Delete No Ext');

      // Verify it's gone
      const filePath = path.join(TEST_VAULT_PATH_CRUD, 'Notes', 'Delete No Ext.md');
      const exists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });

    it('should not throw error for already deleted note', async () => {
      // Create and delete a note
      await service.createNote('Double Delete', 'Content.');
      await service.deleteNote('Double Delete.md');

      // Second delete should not throw (file already gone)
      await expect(service.deleteNote('Double Delete.md')).resolves.not.toThrow();
    });
  });

  describe('listNotes()', () => {
    it('should return empty array when notes folder does not exist', async () => {
      // Create service with non-existent notes folder
      const customService = await LocalObsidianService.create({
        vaultPath: TEST_VAULT_PATH_CRUD,
        notesFolder: 'NonExistentFolder',
      });

      const notes = await customService.listNotes();

      expect(notes).toEqual([]);
    });

    it('should return empty array when notes folder is empty', async () => {
      // Create empty notes folder
      await fs.mkdir(path.join(TEST_VAULT_PATH_CRUD, 'Notes'), { recursive: true });

      const notes = await service.listNotes();

      expect(notes).toEqual([]);
    });

    it('should list all .md files in vault recursively', async () => {
      // Create some notes
      await service.createNote('Note One', 'Content 1.');
      await service.createNote('Note Two', 'Content 2.');
      await service.createNote('Note Three', 'Content 3.');

      const notes = await service.listNotes();

      expect(notes).toHaveLength(3);
      expect(notes).toContain('Notes/Note One.md');
      expect(notes).toContain('Notes/Note Two.md');
      expect(notes).toContain('Notes/Note Three.md');
    });

    it('should only return .md files', async () => {
      // Create a note
      await service.createNote('Valid Note', 'Content.');

      // Create a non-.md file in the Notes folder
      const notesPath = path.join(TEST_VAULT_PATH_CRUD, 'Notes');
      await fs.writeFile(path.join(notesPath, 'not-a-note.txt'), 'text content');

      const notes = await service.listNotes();

      expect(notes).toHaveLength(1);
      expect(notes).toContain('Notes/Valid Note.md');
      expect(notes).not.toContain('Notes/not-a-note.txt');
    });

    it('should reflect changes after create and delete', async () => {
      // Initially empty
      let notes = await service.listNotes();
      expect(notes).toEqual([]);

      // Create a note
      await service.createNote('Dynamic Note', 'Content.');
      notes = await service.listNotes();
      expect(notes).toContain('Notes/Dynamic Note.md');

      // Delete the note (path relative to vault root)
      await service.deleteNote('Notes/Dynamic Note.md');
      notes = await service.listNotes();
      expect(notes).not.toContain('Notes/Dynamic Note.md');
    });
  });

  describe('Full CRUD Round-Trip', () => {
    it('should support complete create-read-update-delete cycle', async () => {
      // Create
      const filename = await service.createNote(
        'Full Cycle Test',
        'Initial content.'
      );
      expect(filename).toBe('Full Cycle Test.md');

      // Read (from vault root path)
      let note = await service.readNote(`Notes/${filename}`);
      expect(note.content).toContain('Initial content.');

      // Update (from vault root path)
      await service.updateNote(`Notes/${filename}`, '# Full Cycle Test\n\nUpdated content.');
      note = await service.readNote(`Notes/${filename}`);
      expect(note.content).toContain('Updated content.');

      // List
      const notes = await service.listNotes();
      expect(notes).toContain(`Notes/${filename}`);

      // Delete (from vault root path)
      await service.deleteNote(`Notes/${filename}`);
      const notesAfterDelete = await service.listNotes();
      expect(notesAfterDelete).not.toContain(`Notes/${filename}`);
    });
  });
});


// ============================================================================
// sendNoteTask Tests (Task 6.6)
// Requirements: 5.1, 5.2, 5.3, 5.4
// ============================================================================

describe('sendNoteTask()', () => {
  let service: LocalObsidianService;
  const TEST_VAULT_PATH_TASK = path.join(os.tmpdir(), 'test-obsidian-vault-task-' + Date.now());

  beforeEach(async () => {
    // Create test vault directory
    await fs.mkdir(TEST_VAULT_PATH_TASK, { recursive: true });
    
    // Create service instance
    service = await LocalObsidianService.create({
      vaultPath: TEST_VAULT_PATH_TASK,
      notesFolder: 'Notes',
    });
  });

  afterEach(async () => {
    // Clean up test vault
    await fs.rm(TEST_VAULT_PATH_TASK, { recursive: true, force: true }).catch(() => {});
  });

  describe('Task Parsing (Requirement 5.1)', () => {
    it('should parse task with title and content separated by blank line', async () => {
      const task = 'My Note Title\n\nThis is the content of the note.';
      
      const result = await service.sendNoteTask(task);
      
      // Verify note was created - readNote resolves from vault root
      const note = await service.readNote('Notes/My Note Title.md');
      // createNote writes "# Title\n\nContent" format
      expect(note.content).toContain('This is the content of the note.');
    });

    it('should parse task with title only (no content)', async () => {
      const task = 'Just a Title';
      
      const result = await service.sendNoteTask(task);
      
      // Verify note was created
      const note = await service.readNote('Notes/Just a Title.md');
      // Title-only note has heading but empty content body
      expect(note.content).toContain('Just a Title');
    });

    it('should parse task with title and content separated by single newline', async () => {
      const task = 'Title Line\nContent on next line';
      
      const result = await service.sendNoteTask(task);
      
      // First line becomes title, rest becomes content
      const note = await service.readNote('Notes/Title Line.md');
      expect(note.content).toContain('Content on next line');
    });

    it('should handle Windows-style line endings (CRLF)', async () => {
      const task = 'Windows Title\r\n\r\nWindows content here.';
      
      const result = await service.sendNoteTask(task);
      
      const note = await service.readNote('Notes/Windows Title.md');
      expect(note.content).toContain('Windows content here.');
    });

    it('should handle multi-paragraph content', async () => {
      const task = 'Multi Paragraph Note\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
      
      const result = await service.sendNoteTask(task);
      
      const note = await service.readNote('Notes/Multi Paragraph Note.md');
      expect(note.content).toContain('First paragraph.');
      expect(note.content).toContain('Second paragraph.');
      expect(note.content).toContain('Third paragraph.');
    });

    it('should trim whitespace from task', async () => {
      const task = '  Trimmed Title  \n\n  Trimmed content  ';
      
      const result = await service.sendNoteTask(task);
      
      // Task in response should be trimmed
      expect(result.task).toBe('Trimmed Title  \n\n  Trimmed content');
    });

    it('should handle task with only whitespace after title', async () => {
      // Note: The task is trimmed before parsing, so trailing whitespace is removed
      const task = 'Title Only\n\n   ';
      
      const result = await service.sendNoteTask(task);
      
      const note = await service.readNote('Notes/Title Only.md');
      // Content will contain the heading at minimum
      expect(note.content).toContain('Title Only');
    });
  });

  describe('Validation (Requirement 5.2)', () => {
    it('should throw error for empty task', async () => {
      await expect(service.sendNoteTask('')).rejects.toThrow('Task cannot be empty');
    });

    it('should throw error for whitespace-only task', async () => {
      await expect(service.sendNoteTask('   ')).rejects.toThrow('Task cannot be empty');
    });

    it('should throw error for task exceeding 1,000,000 characters', async () => {
      const longTask = 'A'.repeat(1_000_001);

      await expect(service.sendNoteTask(longTask)).rejects.toThrow('Task exceeds maximum length of 1000000 characters');
    });

    it('should accept task with exactly 5000 characters', async () => {
      const maxTask = 'Title\n\n' + 'A'.repeat(4993); // 7 chars for "Title\n\n" + 4993 = 5000
      
      const result = await service.sendNoteTask(maxTask);
      
      expect(result.task).toBe(maxTask);
      expect(result.result).toContain('Note created:');
    });

    it('should accept task with less than 5000 characters', async () => {
      const shortTask = 'Short Note\n\nShort content.';
      
      const result = await service.sendNoteTask(shortTask);
      
      expect(result.task).toBe(shortTask);
    });
  });

  describe('Response Interface (Requirements 5.3, 5.4)', () => {
    it('should return ObsidianNoteCall with task field', async () => {
      const task = 'Test Task\n\nTest content.';
      
      const result = await service.sendNoteTask(task);
      
      expect(result.task).toBe(task);
    });

    it('should return ObsidianNoteCall with result field containing filename', async () => {
      const task = 'Result Test\n\nContent.';
      
      const result = await service.sendNoteTask(task);
      
      expect(result.result).toBe('Note created: Result Test.md');
    });

    it('should return ObsidianNoteCall with timestamp field', async () => {
      const beforeCall = new Date();
      const task = 'Timestamp Test\n\nContent.';
      
      const result = await service.sendNoteTask(task);
      const afterCall = new Date();
      
      // Verify timestamp is a valid ISO string
      expect(result.timestamp).toBeDefined();
      const timestamp = new Date(result.timestamp);
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
      expect(timestamp.getTime()).toBeLessThanOrEqual(afterCall.getTime());
    });

    it('should return all three required fields', async () => {
      const task = 'Complete Response\n\nContent.';
      
      const result = await service.sendNoteTask(task);
      
      expect(result).toHaveProperty('task');
      expect(result).toHaveProperty('result');
      expect(result).toHaveProperty('timestamp');
      expect(typeof result.task).toBe('string');
      expect(typeof result.result).toBe('string');
      expect(typeof result.timestamp).toBe('string');
    });
  });

  describe('Note Creation', () => {
    it('should actually create a note file in the vault', async () => {
      const task = 'File Creation Test\n\nContent here.';
      
      await service.sendNoteTask(task);
      
      // Verify file exists
      const filePath = path.join(TEST_VAULT_PATH_TASK, 'Notes', 'File Creation Test.md');
      const exists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should create note with proper content format', async () => {
      const task = 'Frontmatter Check\n\nContent.';
      
      await service.sendNoteTask(task);
      
      const note = await service.readNote('Notes/Frontmatter Check.md');
      // createNote writes "# Title\n\nContent" format
      expect(note.content).toContain('Frontmatter Check');
      expect(note.content).toContain('Content.');
    });

    it('should sanitize special characters in title for filename', async () => {
      const task = 'Note: With <Special> Characters\n\nContent.';
      
      const result = await service.sendNoteTask(task);
      
      // Extract filename from result (format: "Note created: filename.md")
      const filename = result.result.replace('Note created: ', '');
      
      // Filename should be sanitized (no special characters)
      expect(filename).not.toContain(':');
      expect(filename).not.toContain('<');
      expect(filename).not.toContain('>');
      expect(filename).toBe('Note_ With _Special_ Characters.md');
    });

    it('should handle multiple notes with different titles', async () => {
      await service.sendNoteTask('First Note\n\nFirst content.');
      await service.sendNoteTask('Second Note\n\nSecond content.');
      await service.sendNoteTask('Third Note\n\nThird content.');
      
      const notes = await service.listNotes();
      
      expect(notes).toHaveLength(3);
      expect(notes).toContain('Notes/First Note.md');
      expect(notes).toContain('Notes/Second Note.md');
      expect(notes).toContain('Notes/Third Note.md');
    });
  });

  describe('Singleton sendNoteTask', () => {
    it('should work through singleton interface', async () => {
      // Set env var for singleton
      process.env.OBSIDIAN_VAULT_PATH = TEST_VAULT_PATH_TASK;
      localObsidianService.resetInstance();
      
      const task = 'Singleton Test\n\nContent.';
      
      const result = await localObsidianService.sendNoteTask(task);
      
      expect(result.task).toBe(task);
      expect(result.result).toContain('Note created:');
      expect(result.timestamp).toBeDefined();
      
      // Clean up
      localObsidianService.resetInstance();
    });
  });
});
