/**
 * Gmail OAuth2 Authorization Script
 * 
 * Run this once to get a refresh token for Gmail send access:
 *   npx tsx scripts/gmail-auth.ts
 * 
 * It will open a browser for you to authorize, then save the token to gmail-token.json.
 */

import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as url from 'url';

const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];
const TOKEN_PATH = path.join(process.cwd(), 'gmail-token.json');

async function main() {
  // Find the client secret file
  const clientSecretPath = process.env.GMAIL_CLIENT_SECRET_PATH
    || findClientSecret();

  if (!clientSecretPath) {
    console.error('Could not find client_secret_*.json file.');
    console.error('Set GMAIL_CLIENT_SECRET_PATH env var or place the file in the project root.');
    process.exit(1);
  }

  console.log(`Using client secret: ${clientSecretPath}`);

  const credentials = JSON.parse(fs.readFileSync(clientSecretPath, 'utf8'));
  const { client_id, client_secret } = credentials.installed || credentials.web;

  // Use localhost redirect for the OAuth flow
  const redirectUri = 'http://localhost:3333/oauth2callback';
  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Force consent to always get refresh_token
  });

  console.log('\nOpening browser for authorization...');
  console.log(`If it doesn't open, go to:\n${authUrl}\n`);

  // Open browser
  const { exec } = await import('child_process');
  exec(`start "" "${authUrl}"`);

  // Start local server to receive the callback
  const code = await waitForCallback();

  console.log('Authorization code received. Exchanging for tokens...');

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // Save tokens
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log(`\nTokens saved to: ${TOKEN_PATH}`);
  console.log(`Refresh token: ${tokens.refresh_token}`);
  console.log('\nYou can either:');
  console.log('  1. Leave gmail-token.json in place (the service will read it automatically)');
  console.log('  2. Set GMAIL_REFRESH_TOKEN in your .env file to the refresh token above');
  console.log('\nDone! Gmail send is now configured.');
}

function findClientSecret(): string | null {
  const files = fs.readdirSync(process.cwd());
  const match = files.find(f => f.startsWith('client_secret_') && f.endsWith('.json'));
  return match ? path.join(process.cwd(), match) : null;
}

function waitForCallback(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsed = url.parse(req.url || '', true);
      if (parsed.pathname === '/oauth2callback') {
        const code = parsed.query.code as string;
        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Authorization successful!</h1><p>You can close this tab.</p>');
          server.close();
          resolve(code);
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Error</h1><p>No authorization code received.</p>');
          server.close();
          reject(new Error('No code in callback'));
        }
      }
    });

    server.listen(3333, () => {
      console.log('Waiting for OAuth callback on http://localhost:3333 ...');
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Timed out waiting for authorization'));
    }, 120_000);
  });
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
