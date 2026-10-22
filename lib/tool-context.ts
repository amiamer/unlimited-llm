/**
 * Tool Context Storage
 * Provides a way to inject context (like Discord user/channel IDs) into tool calls
 */

interface ToolContext {
  discordUserId?: string;
  discordChannelId?: string;
}

let currentContext: ToolContext = {};

export function setToolContext(context: ToolContext) {
  currentContext = context;
}

export function getToolContext(): ToolContext {
  return currentContext;
}

export function clearToolContext() {
  currentContext = {};
}
