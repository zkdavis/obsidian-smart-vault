/**
 * Smart Vault Organizer - Entry Point
 *
 * This plugin helps organize your Obsidian vault by:
 * - Generating embeddings for semantic search
 * - Suggesting relevant links between notes
 * - Auto-linking related content
 * - Extracting keywords with LLM
 *
 * Main plugin class is in src/plugin/SmartVaultPlugin.ts
 */

import SmartVaultPlugin from './plugin/SmartVaultPlugin';

export default SmartVaultPlugin;
export type { SmartVaultPlugin };
