import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';

export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

class GmailService {
  private gmail: gmail_v1.Gmail | null = null;
  private auth: OAuth2Client | null = null;

  private getAuth(): OAuth2Client {
    if (this.auth) {
      return this.auth;
    }

    // Load OAuth2 client credentials
    const clientSecretPath = process.env.GMAIL_CLIENT_SECRET_PATH;
    if (!clientSecretPath) {
      throw new Error('GMAIL_CLIENT_SECRET_PATH environment variable is required');
    }

    const cleanPath = clientSecretPath.replace(/^["']|["']$/g, '');
    if (!fs.existsSync(cleanPath)) {
      throw new Error('Gmail OAuth client secret file not found at configured path');
    }

    const credentials = JSON.parse(fs.readFileSync(cleanPath, 'utf8'));
    const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

    this.auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    // Load refresh token
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
    if (refreshToken) {
      this.auth.setCredentials({ refresh_token: refreshToken });
    } else {
      // Try loading from token file
      const tokenPath = path.join(process.cwd(), 'gmail-token.json');
      if (fs.existsSync(tokenPath)) {
        const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
        this.auth.setCredentials(tokens);
      } else {
        throw new Error('No Gmail refresh token found. Set GMAIL_REFRESH_TOKEN env var or run: npx tsx scripts/gmail-auth.ts');
      }
    }

    return this.auth;
  }

  private getGmail(): gmail_v1.Gmail {
    if (this.gmail) {
      return this.gmail;
    }

    const auth = this.getAuth();
    this.gmail = google.gmail({ version: 'v1', auth });
    return this.gmail;
  }

  /**
   * Build a RFC 2822 compliant email message and base64url-encode it.
   */
  private buildRawMessage(params: SendEmailParams): string {
    const lines: string[] = [];
    lines.push(`To: ${params.to}`);
    if (params.cc) lines.push(`Cc: ${params.cc}`);
    if (params.bcc) lines.push(`Bcc: ${params.bcc}`);
    lines.push(`Subject: ${params.subject}`);
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push('MIME-Version: 1.0');
    lines.push('');
    lines.push(params.body);

    const message = lines.join('\r\n');
    return Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Send an email via Gmail API.
   */
  async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    try {
      const gmail = this.getGmail();
      const raw = this.buildRawMessage(params);

      const response = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw },
      });

      return {
        success: true,
        messageId: response.data.id || undefined,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      // Strip any sensitive details from error messages
      const safeError = errorMsg
        .replace(/Bearer\s+\S+/g, '[redacted]')
        .replace(/key=\S+/g, '[redacted]')
        .replace(/client_secret=\S+/g, '[redacted]');
      return {
        success: false,
        error: `Failed to send email: ${safeError}`,
      };
    }
  }
}

// Singleton instance
let _gmailService: GmailService | null = null;

export const gmailService = {
  getInstance(): GmailService {
    if (!_gmailService) {
      _gmailService = new GmailService();
    }
    return _gmailService;
  },

  async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    return this.getInstance().sendEmail(params);
  },
};

export { GmailService };
