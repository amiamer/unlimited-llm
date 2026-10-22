#!/usr/bin/env tsx

/**
 * Discord Bot Runner
 * 
 * Starts the Discord bot that connects to the chat interface.
 * 
 * Usage:
 *   npm run discord-bot
 */

import 'dotenv/config';
import { createDiscordBot } from '@/lib/discord-bot';

async function main() {
  console.log('Starting Discord bot...');

  try {
    const bot = createDiscordBot();
    await bot.start();

    console.log('Discord bot is running. Press Ctrl+C to stop.');

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\nShutting down Discord bot...');
      await bot.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\nShutting down Discord bot...');
      await bot.stop();
      process.exit(0);
    });

  } catch (error) {
    console.error('Failed to start Discord bot:', error);
    process.exit(1);
  }
}

main();
