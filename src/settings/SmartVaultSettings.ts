import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type { SmartVaultPlugin } from '../main';

export class SmartVaultSettingTab extends PluginSettingTab {
    plugin: SmartVaultPlugin;

    constructor(app: App, plugin: SmartVaultPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Smart Vault Organizer Settings' });

        // Contribution Buttons
        const contributionContainer = containerEl.createDiv({ cls: 'smart-vault-contribution-container' });
        contributionContainer.style.display = 'flex';
        contributionContainer.style.gap = '10px';
        contributionContainer.style.marginBottom = '20px';
        contributionContainer.style.justifyContent = 'center';

        const createButton = (text: string, url: string, icon?: string) => {
            const btn = contributionContainer.createEl('a', {
                href: url,
                text: text,
                cls: 'smart-vault-contribution-btn'
            });
            btn.style.padding = '8px 16px';
            btn.style.borderRadius = '4px';
            btn.style.backgroundColor = 'var(--interactive-accent)';
            btn.style.color = 'var(--text-on-accent)';
            btn.style.textDecoration = 'none';
            btn.style.fontWeight = 'bold';

            if (icon) {
                // simple icon support if needed, or just text
            }
        };

        createButton('⭐ Star on GitHub', 'https://github.com/zkdavis/obsidian-smart-vault');
        createButton('💖 Sponsor', 'https://github.com/sponsors/zkdavis');
        createButton('☕ Buy me a coffee', 'https://www.buymeacoffee.com/zkdavis');
        createButton('🍵 Ko-Fi', 'https://ko-fi.com/zkdavis');

        // Debug Section
        containerEl.createEl('h3', { text: 'Debug' });

        new Setting(containerEl)
            .setName('Enable Debug Mode')
            .setDesc('Show detailed debug logs in console (Ctrl+Shift+I)')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.debugMode)
                .onChange(async (value) => {
                    this.plugin.settings.debugMode = value;
                    await this.plugin.saveSettings();
                    console.log(`[DEBUG] Debug mode ${value ? 'enabled' : 'disabled'}`);
                }));

        new Setting(containerEl)
            .setName('Debug Folder Filter')
            .setDesc('Optional: Only scan files in this folder (e.g., "Wiki/"). Leave empty to scan all files.')
            .addText(text => text
                .setPlaceholder('Wiki/')
                .setValue(this.plugin.settings.debugFolderFilter)
                .onChange(async (value) => {
                    this.plugin.settings.debugFolderFilter = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Embedding Settings' });

        new Setting(containerEl)
            .setName('Ollama Endpoint')
            .setDesc('URL of your Ollama server (e.g., http://localhost:11434)')
            .addText(text => text
                .setPlaceholder('http://localhost:11434')
                .setValue(this.plugin.settings.ollamaEndpoint)
                .onChange(async (value) => {
                    this.plugin.settings.ollamaEndpoint = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Chat Model')
            .setDesc('Ollama model to use for chat (e.g., llama3.1, mistral)')
            .addText(text => text
                .setPlaceholder('llama3.1')
                .setValue(this.plugin.settings.chatModel)
                .onChange(async (value) => {
                    this.plugin.settings.chatModel = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Embedding Model')
            .setDesc('Ollama model for vector embeddings (e.g., bge-m3, nomic-embed-text). REQUIRES RE-SCAN if changed!')
            .addText(text => text
                .setPlaceholder('bge-m3')
                .setValue(this.plugin.settings.embeddingModel)
                .onChange(async (value) => {
                    this.plugin.settings.embeddingModel = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Max Content Length')
            .setDesc('Maximum characters to send for embedding (nomic-embed-text: ~2000 safe, mxbai-embed: ~8000)')
            .addSlider(slider => slider
                .setLimits(500, 8000, 500)
                .setValue(this.plugin.settings.maxContentLength)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.maxContentLength = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Similarity Threshold')
            .setDesc('Minimum similarity score for link suggestions (0-1)')
            .addSlider(slider => slider
                .setLimits(0, 1, 0.05)
                .setValue(this.plugin.settings.similarityThreshold)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.similarityThreshold = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Max Suggestions')
            .setDesc('Maximum number of suggestions to show')
            .addSlider(slider => slider
                .setLimits(1, 20, 1)
                .setValue(this.plugin.settings.maxSuggestions)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.maxSuggestions = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Auto-scan Enabled')
            .setDesc('Automatically scan vault at regular intervals')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoScanEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.autoScanEnabled = value;
                    await this.plugin.saveSettings();

                    if (value) {
                        this.plugin.startAutoScan();
                    } else {
                        this.plugin.stopAutoScan();
                    }
                }));

        new Setting(containerEl)
            .setName('Scan Interval')
            .setDesc('Minutes between automatic scans')
            .addSlider(slider => slider
                .setLimits(5, 120, 5)
                .setValue(this.plugin.settings.scanInterval)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.scanInterval = value;
                    await this.plugin.saveSettings();

                    if (this.plugin.settings.autoScanEnabled) {
                        this.plugin.startAutoScan();
                    }
                }));

        containerEl.createEl('h3', { text: 'Chat RAG Settings' });

        new Setting(containerEl)
            .setName('Vault Mode Threshold')
            .setDesc('Minimum similarity (0-1) to include a note in "Vault" chats. Lower = more context (0.5 recommended).')
            .addSlider(slider => slider
                .setLimits(0.1, 1.0, 0.05)
                .setValue(this.plugin.settings.ragThresholdVault)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.ragThresholdVault = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('General Mode Threshold')
            .setDesc('Minimum similarity (0-1) to include a note in "General" chats. Higher = less noise (0.85 recommended).')
            .addSlider(slider => slider
                .setLimits(0.1, 1.0, 0.05)
                .setValue(this.plugin.settings.ragThresholdGeneral)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.ragThresholdGeneral = value;
                    await this.plugin.saveSettings();
                }));

        // LLM Reranking Section
        containerEl.createEl('h3', { text: 'LLM-Enhanced Suggestions' });
        containerEl.createEl('p', {
            text: 'Use a larger language model like qwen2.5:7b to intelligently rerank and explain link suggestions.',
            cls: 'setting-item-description'
        });

        new Setting(containerEl)
            .setName('Enable LLM Reranking')
            .setDesc('Use an LLM to rerank suggestions with intelligent reasoning (slower but smarter)')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useLLMReranking)
                .onChange(async (value) => {
                    this.plugin.settings.useLLMReranking = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Manual Rerank Only')
            .setDesc('Only run LLM reranking when the "✨ Rerank with AI" button is clicked (skips automatic background reranking)')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.manualLLMRerank)
                .onChange(async (value) => {
                    this.plugin.settings.manualLLMRerank = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('LLM Model')
            .setDesc('Ollama model for reranking (e.g., ministral-3:3b, qwen2.5:7b)')
            .addText(text => text
                .setPlaceholder('ministral-3:3b')
                .setValue(this.plugin.settings.llmModel)
                .onChange(async (value) => {
                    this.plugin.settings.llmModel = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h4', { text: 'Task-Specific Models' });

        new Setting(containerEl)
            .setName('Chat Model')
            .setDesc('Model for "Smart Chat" (recommended: ministral-3:3b)')
            .addText(text => text
                .setPlaceholder('ministral-3:3b')
                .setValue(this.plugin.settings.chatModel)
                .onChange(async (value) => {
                    this.plugin.settings.chatModel = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Formatting Model')
            .setDesc('Model for "Smart Formatting" (recommended: ministral-3:3b)')
            .addText(text => text
                .setPlaceholder('ministral-3:3b')
                .setValue(this.plugin.settings.formattingModel)
                .onChange(async (value) => {
                    this.plugin.settings.formattingModel = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Organization Model')
            .setDesc('Model for "Smart Organization" (ministral-3:3b works well)')
            .addText(text => text
                .setPlaceholder('ministral-3:3b')
                .setValue(this.plugin.settings.organizationModel)
                .onChange(async (value) => {
                    this.plugin.settings.organizationModel = value;
                    await this.plugin.saveSettings();
                }));


        new Setting(containerEl)
            .setName('LLM Candidate Count')
            .setDesc('How many top embedding results to send to LLM for reranking')
            .addSlider(slider => slider
                .setLimits(1, 20, 1)
                .setValue(this.plugin.settings.llmCandidateCount)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.llmCandidateCount = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('LLM Temperature')
            .setDesc('Creativity of LLM reasoning (0.0 = precise, 1.0 = creative)')
            .addSlider(slider => slider
                .setLimits(0, 1, 0.1)
                .setValue(this.plugin.settings.llmTemperature)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.llmTemperature = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Enable Hover Previews')
            .setDesc('Show live previews of suggestions on hover (for links, grammar, etc.). Default: On.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableHoverPreviews)
                .onChange(async (value) => {
                    this.plugin.settings.enableHoverPreviews = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshEditors();
                }));

        new Setting(containerEl)
            .setName('Chat Temperature')
            .setDesc('Creativity for Chat (0.7+ recommended for natural conversation)')
            .addSlider(slider => slider
                .setLimits(0, 1, 0.1)
                .setValue(this.plugin.settings.chatTemperature)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.chatTemperature = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Enable Smart Insertion')
            .setDesc('Use LLM to find the best place to insert links (experimental)')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableSmartInsertion)
                .onChange(async (value) => {
                    this.plugin.settings.enableSmartInsertion = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('LLM Concurrency')
            .setDesc('Number of files to process in parallel during vault scan (higher = faster but more CPU/memory)')
            .addSlider(slider => slider
                .setLimits(1, 10, 1)
                .setValue(this.plugin.settings.llmConcurrency)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.llmConcurrency = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('LLM Timeout (seconds)')
            .setDesc('How long to wait for LLM response before timing out (increase if you have a slow model)')
            .addSlider(slider => slider
                .setLimits(10, 120, 5)
                .setValue(this.plugin.settings.llmTimeout / 1000)  // Convert ms to seconds for display
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.llmTimeout = value * 1000;  // Convert seconds to ms for storage
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Extract Keywords')
            .setDesc('Use LLM to extract keywords from documents for better cross-linking (slightly slower scan)')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useKeywordExtraction)
                .onChange(async (value) => {
                    this.plugin.settings.useKeywordExtraction = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Enable Thinking Mode')
            .setDesc('Use chain-of-thought reasoning for qwen3/deepseek models (better quality, slower)')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableThinkingMode)
                .onChange(async (value) => {
                    this.plugin.settings.enableThinkingMode = value;
                    await this.plugin.saveSettings();
                }));

        // Handwritten Notes Section
        containerEl.createEl('h3', { text: 'Handwritten Notes (Vision)' });
        containerEl.createEl('p', {
            text: 'Automatically process handwritten notes dropped into a specific folder.',
            cls: 'setting-item-description'
        });

        new Setting(containerEl)
        new Setting(containerEl)
            .setName('Vision Model')
            .setDesc('Model for handwritten notes (OCR). Recommended: "ministral-3:3b" (Fast/Default), "ministral-3:8b" (Better), or "qwen3-vl:7b" (Best Math). Avoid "Reasoning" models like R1.')
            .addText(text => text
                .setPlaceholder('ministral-3:3b')
                .setValue(this.plugin.settings.visionModel)
                .onChange(async (value) => {
                    this.plugin.settings.visionModel = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Handwritten Inbox')
            .setDesc('Folder to watch for images/PDFs (relative to vault root)')
            .addText(text => text
                .setPlaceholder('Inbox/Handwritten')
                .setValue(this.plugin.settings.handwrittenInbox)
                .onChange(async (value) => {
                    this.plugin.settings.handwrittenInbox = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Transcript Folder')
            .setDesc('Where to save the transcribed Markdown notes')
            .addText(text => text
                .setPlaceholder('Inbox')
                .setValue(this.plugin.settings.transcriptFolder)
                .onChange(async (value) => {
                    this.plugin.settings.transcriptFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Attachments Folder')
            .setDesc('Where to move the original handwritten images/PDFs after processing')
            .addText(text => text
                .setPlaceholder('Attachments/Handwritten')
                .setValue(this.plugin.settings.handwrittenAttachmentsFolder)
                .onChange(async (value) => {
                    this.plugin.settings.handwrittenAttachmentsFolder = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Vault Management' });

        new Setting(containerEl)
            .setName('Cache Directory')
            .setDesc('Folder where cache files are stored (default: _smartvault). REQUIRES RESTART to take effect.')
            .addText(text => text
                .setPlaceholder('_smartvault')
                .setValue(this.plugin.settings.cacheDirectory)
                .onChange(async (value) => {
                    this.plugin.settings.cacheDirectory = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Manual Scan')
            .setDesc('Scan vault now to generate embeddings for all notes')
            .addButton(button => button
                .setButtonText('Scan Vault Now')
                .setCta()
                .onClick(async () => {
                    button.setButtonText('Scanning...');
                    button.setDisabled(true);
                    try {
                        await this.plugin.scanVault();
                    } finally {
                        button.setButtonText('Scan Vault Now');
                        button.setDisabled(false);
                    }
                }));

        new Setting(containerEl)
            .setName('Export Vector Cache')
            .setDesc('Export embeddings to JSON for backup or debugging (saves to "smart-vault-export.json" in root)')
            .addButton(button => button
                .setButtonText('Export Cache')
                .onClick(async () => {
                    button.setButtonText('Exporting...');
                    button.setDisabled(true);
                    try {
                        const path = await this.plugin.cacheManager!.exportCache();
                        new Notice(`Successfully exported cache to ${path}`);
                    } catch (error: any) {
                        new Notice(`Export failed: ${error.message}`);
                    } finally {
                        button.setButtonText('Export Cache');
                        button.setDisabled(false);
                    }
                }));

        new Setting(containerEl)
            .setName('Import Vector Cache')
            .setDesc('Restore embeddings from "smart-vault-export.json". WARNING: Overwrites current in-memory cache!')
            .addButton(button => button
                .setButtonText('Import Cache')
                .setWarning()
                .onClick(async () => {
                    if (!confirm('Are you sure you want to overwrite current embeddings with the backup?')) return;

                    button.setButtonText('Importing...');
                    button.setDisabled(true);
                    try {
                        const count = await this.plugin.cacheManager!.importCache();
                        new Notice(`Successfully imported ${count} embeddings!`);
                    } catch (error: any) {
                        new Notice(`Import failed: ${error.message}`);
                    } finally {
                        button.setButtonText('Import Cache');
                        button.setDisabled(false);
                    }
                }));

        new Setting(containerEl)
            .setName('Clear Embeddings')
            .setDesc('Delete all cached embeddings and start fresh (requires re-scan)')
            .addButton(button => button
                .setButtonText('Clear Embeddings')
                .setWarning()
                .onClick(async () => {
                    button.setButtonText('Clearing...');
                    button.setDisabled(true);
                    try {
                        await this.plugin.clearEmbeddings();
                        new Notice('Embeddings cleared. Scan vault to rebuild.');
                    } finally {
                        button.setButtonText('Clear Embeddings');
                        button.setDisabled(false);
                    }
                }));

        new Setting(containerEl)
            .setName('Clear Analysis Cache')
            .setDesc('Clear cached results for Formatting and Organization analysis')
            .addButton(button => button
                .setButtonText('Clear Cache')
                .setWarning()
                .onClick(async () => {
                    this.plugin.settings.formattingCache = {};
                    this.plugin.settings.organizationCache = {};
                    await this.plugin.saveSettings();
                    new Notice('Analysis cache cleared!');
                }));

        new Setting(containerEl)
            .setName('Complete Rescan')
            .setDesc('Clear all caches (embeddings, suggestions, file modification times) and rescan the entire vault from scratch')
            .addButton(button => button
                .setButtonText('Complete Rescan')
                .setWarning()
                .onClick(async () => {
                    button.setButtonText('Rescanning...');
                    button.setDisabled(true);
                    try {
                        // Clear all caches
                        await this.plugin.clearEmbeddings();

                        // Start a fresh scan
                        await this.plugin.scanVault();

                        new Notice('Complete rescan finished!');
                    } catch (error: any) {
                        new Notice('Rescan failed: ' + error.message);
                        console.error('Rescan error:', error);
                    } finally {
                        button.setButtonText('Complete Rescan');
                        button.setDisabled(false);
                    }
                }));
    }
}
