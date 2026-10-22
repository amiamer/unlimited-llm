/**
 * Kiro CLI LLM Provider
 * 
 * Spawns `kiro-cli chat --no-interactive --trust-all-tools` as a child process
 * and captures stdout as the assistant response.
 * 
 * KEY DIFFERENCE FROM OTHER PROVIDERS:
 * - Does NOT use the tool registry (lib/tool-registry.ts)
 * - Kiro CLI handles its own tool execution via --trust-all-tools
 * - Returns final text response only, no tool call arrays
 * - No streaming — headless mode prints complete response to stdout
 */

import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { LLMProvider, LLMRequest, LLMResponse } from './llm-service';
import { Message } from './types';
import { renderAgentContext } from './agent-context';

const execFileAsync = promisify(execFile);

// ─── Binary Resolution ───────────────────────────────────────────────────────

/**
 * Resolve the kiro-cli binary path.
 * Checks KIRO_CLI_PATH env var first, then PATH, then known Windows install location.
 */
function resolveKiroCliBinary(): string {
  // explicit override via env var
  if (process.env.KIRO_CLI_PATH) {
    return process.env.KIRO_CLI_PATH;
  }

  // known Windows install location (installer puts it here but doesn't always add to PATH)
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    if (localAppData) {
      const knownPath = `${localAppData}\\Kiro-Cli\\kiro-cli.exe`;
      // we'll try this path — spawn will fail with ENOENT if it doesn't exist
      // and the error handler will give a clear message
      try {
        if (existsSync(knownPath)) {
          return knownPath;
        }
      } catch {
        // fall through to default
      }
    }
  }

  // default: assume it's on PATH
  return 'kiro-cli';
}

// ─── Output Cleaner ──────────────────────────────────────────────────────────

/**
 * Strips residual ANSI escape codes from kiro-cli stdout.
 * 
 * We set KIRO_LOG_NO_COLOR=1 on the child process to prevent ANSI codes
 * at the source, but this function exists as a safety net for edge cases.
 * 
 * INTENTIONALLY does NOT strip status messages or tool execution logs —
 * there is no structured output mode in kiro-cli, and aggressive regex
 * patterns (emoji prefixes, box-drawing chars) risk removing legitimate
 * response content like markdown horizontal rules or emoji in text.
 */
export function cleanOutput(raw: string): string {
  // strip ANSI escape codes: CSI sequences (\x1b[...X) and OSC sequences (\x1b]...BEL)
  const cleaned = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  return cleaned.trim();
}

// ─── KiroService ─────────────────────────────────────────────────────────────

class KiroService implements LLMProvider {
  private timeout: number;
  private cwd: string;

  constructor() {
    this.timeout = parseInt(process.env.KIRO_TIMEOUT_MS || '300000', 10);
    this.cwd = process.env.KIRO_CWD || process.cwd();
  }

  /** Build the prompt from the shared system context, history, and current message. */
  buildPrompt(request: LLMRequest): string {
    let prompt = '';

    if (request.systemPromptOverride) {
      prompt += '[SYSTEM INSTRUCTIONS]\n';
      prompt += request.systemPromptOverride + '\n\n';
    } else if (request.agentContext) {
      const rendered = renderAgentContext(request.agentContext);
      if (rendered) {
        prompt += '[CURATED AGENT CONTEXT]\n';
        prompt += rendered + '\n\n';
      }
    }

    // session summary if available
    if (request.sessionSummary) {
      prompt += '[EARLIER CONVERSATION SUMMARY]\n';
      prompt += request.sessionSummary + '\n\n';
    }

    // conversation history
    if (request.sessionMessages && request.sessionMessages.length > 0) {
      prompt += '[CONVERSATION HISTORY]\n';
      request.sessionMessages.forEach((msg: Message) => {
        const label = msg.role === 'user' ? 'User' : 'Assistant';
        prompt += `${label}: ${msg.content}\n\n`;
      });
    }

    // current user message
    prompt += '[CURRENT MESSAGE]\n';
    prompt += request.userMessage;

    return prompt;
  }

  /**
   * Spawn kiro-cli as a child process and capture stdout.
   * Each call starts a fresh session (no --resume) to avoid state conflicts.
   * Sets KIRO_LOG_NO_COLOR=1 to suppress ANSI codes at the source.
   * 
   * The prompt is written to a temp file to avoid ENAMETOOLONG errors on Windows
   * (command-line args are limited to ~32KB) and stdin piping issues with kiro-cli.
   */
  private async spawnKiroCli(prompt: string): Promise<string> {
    // write prompt to a temp file to avoid arg length limits
    const os = await import('node:os');
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const tmpFile = path.join(os.tmpdir(), `kiro-prompt-${Date.now()}.txt`);
    await fs.writeFile(tmpFile, prompt, 'utf-8');

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      const binary = resolveKiroCliBinary();

      // pass a short instruction that reads from the temp file
      // kiro-cli chat accepts a positional INPUT argument
      const shortPrompt = `Read and respond to the full prompt in this file: ${tmpFile}`;

      const child = spawn(binary, [
        'chat',
        '--no-interactive',
        '--trust-all-tools',
        shortPrompt,
      ], {
        cwd: this.cwd,
        env: {
          ...process.env,
          KIRO_API_KEY: process.env.KIRO_API_KEY || '',
          KIRO_LOG_NO_COLOR: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false,
      });

      // timeout handling
      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        reject(new Error(`Kiro request timed out after ${this.timeout / 1000}s`));
      }, this.timeout);

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('error', (err: Error) => {
        clearTimeout(timer);
        // clean up temp file on error too
        fs.unlink(tmpFile).catch(() => {});
        if (err.message.includes('ENOENT')) {
          reject(new Error('Failed to generate Kiro response: kiro-cli not found on PATH'));
        } else if (err.message.includes('EACCES')) {
          reject(new Error('Failed to generate Kiro response: permission denied'));
        } else {
          reject(new Error(`Failed to generate Kiro response: ${err.message}`));
        }
      });

      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        // clean up temp file
        fs.unlink(tmpFile).catch(() => {});

        if (killed) return; // already rejected via timeout

        if (code !== 0) {
          const errMsg = stderr.trim() || `kiro-cli exited with code ${code}`;
          reject(new Error(`Failed to generate Kiro response: ${errMsg}`));
          return;
        }

        resolve(stdout);
      });
    });
  }

  async generateResponse(request: LLMRequest): Promise<LLMResponse> {
    if (!request.userMessage || request.userMessage.trim().length === 0) {
      throw new Error('User message cannot be empty');
    }

    if (!process.env.KIRO_API_KEY) {
      throw new Error('KIRO_API_KEY environment variable is required');
    }

    const prompt = this.buildPrompt(request);
    const rawOutput = await this.spawnKiroCli(prompt);
    const content = cleanOutput(rawOutput);

    if (!content || content.length === 0) {
      throw new Error('No response from Kiro CLI');
    }

    // kiro handles its own tools — return text only, no tool call arrays
    return {
      content,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Verify kiro-cli is available without burning credits.
   * Checks: (1) kiro-cli exists on PATH or known location, (2) KIRO_API_KEY is set.
   * Does NOT spawn a real chat session.
   */
  async testConnection(): Promise<boolean> {
    // check KIRO_API_KEY is set
    if (!process.env.KIRO_API_KEY) {
      return false;
    }

    // check kiro-cli binary is resolvable
    const binary = resolveKiroCliBinary();
    try {
      await execFileAsync(binary, ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  getModelId(): string {
    return 'kiro-cli';
  }
}

// ─── Singleton Accessor ──────────────────────────────────────────────────────

let _kiroInstance: KiroService | null = null;

export const kiroService = {
  getInstance(): KiroService {
    if (!_kiroInstance) _kiroInstance = new KiroService();
    return _kiroInstance;
  },
  async generateResponse(request: LLMRequest): Promise<LLMResponse> {
    return this.getInstance().generateResponse(request);
  },
  async testConnection(): Promise<boolean> {
    return this.getInstance().testConnection();
  },
  getModelId(): string {
    return this.getInstance().getModelId();
  },
};

export { KiroService };
