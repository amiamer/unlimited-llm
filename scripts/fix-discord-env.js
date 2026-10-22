const fs = require('fs');
const path = require('path');

// Read the .env file
const envPath = path.join(__dirname, '..', '.env');
let content = fs.readFileSync(envPath, 'utf8');

// Find and fix the Discord section
const discordStart = content.indexOf('DISCORD_CLIENT_ID');
const beforeDiscord = content.substring(0, discordStart);

// Clean Discord configuration
const cleanDiscord = `DISCORD_CLIENT_ID=PASTE_YOUR_CLIENT_ID_HERE
DISCORD_CLIENT_SECRET=PASTE_YOUR_CLIENT_SECRET_HERE
DISCORD_APPLICATION_ID=PASTE_YOUR_APPLICATION_ID_HERE
DISCORD_PUBLIC_KEY=PASTE_YOUR_PUBLIC_KEY_HERE
DISCORD_BOT_TOKEN=PASTE_YOUR_TOKEN_HERE
DISCORD_CHAT_API_URL=http://localhost:3001
`;

// Write the fixed content
fs.writeFileSync(envPath, beforeDiscord + cleanDiscord, 'utf8');

console.log('✓ Fixed .env file');
console.log('');
console.log('Next steps:');
console.log('1. Go to https://discord.com/developers/applications/YOUR_APPLICATION_ID');
console.log('2. Click "Bot" → "Reset Token" → Copy the token');
console.log('3. Open .env and replace PASTE_YOUR_TOKEN_HERE with your actual token');
console.log('4. Run: npm run discord-bot');
