import { App, Plugin, TFile, Notice, Editor, MarkdownView, Modal } from 'obsidian';
import { ConfirmModal } from '../ui/ConfirmModal';
import { SmartVaultSettings, DEFAULT_SETTINGS } from '../settings/types';
import { SmartVaultSettingTab } from '../settings/SmartVaultSettings';
import { RerankerService } from '../llm/RerankerService';
import { CacheManager } from './cache/CacheManager';
import { FileProcessor } from './scanning/FileProcessor';
import { VaultScanner } from './scanning/VaultScanner';
import { HandwrittenNoteWatcher } from './scanning/HandwrittenNoteWatcher';
import { LinkSuggestionView, VIEW_TYPE_LINK_SUGGESTIONS } from '../ui/LinkSuggestionView';
import { InlineLinkSuggest } from '../suggest/InlineLinkSuggest';
import { inlineSuggestionExtension } from '../editor/InlineSuggestionExtension';
import { truncateContent } from '../utils/content';
import { CONSTANTS } from '../constants';
// @ts-ignore
import wasmBinary from '../../pkg/obsidian_smart_vault_bg.wasm';
import * as wasmNamespace from '../../pkg/obsidian_smart_vault';

/**
 * Main plugin class for Smart Vault Organizer.
 * Orchestrates all services and manages plugin lifecycle.
 */
export default class SmartVaultPlugin extends Plugin {
    settings: SmartVaultSettings;
    wasmModule: typeof wasmNamespace;
    smartVault: wasmNamespace.SmartVault;
    rerankerService: RerankerService | null = null;
    cacheManager: CacheManager | null = null;
    fileProcessor: FileProcessor | null = null;
    vaultScanner: VaultScanner | null = null;
    handwrittenWatcher: HandwrittenNoteWatcher | null = null;
    scanIntervalId: number | null = null;
    inlineSuggest: InlineLinkSuggest | null = null;
    fileModificationTimes: Map<string, number> = new Map();  // Track file mtimes to skip unchanged files
    keywordModificationTimes: Map<string, number> = new Map();  // Track when keywords were extracted
    suggestionModificationTimes: Map<string, number> = new Map();  // Track when suggestions were generated
    cacheInitialized: boolean = false;  // Flag to prevent early file-open events from overwriting cache
    private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();  // Track debounce timers
    private lastOpenedFile: string | null = null;  // Track last opened file to deduplicate events
    private lastOpenedTime: number = 0;  // Track when file was last opened

    /**
     * Getter for the suggestion view instance.
     * Finds the view in the workspace instead of storing a reference to avoid memory leaks.
     */
    get suggestionView(): LinkSuggestionView | null {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_LINK_SUGGESTIONS);
        if (leaves.length > 0) {
            return leaves[0].view as LinkSuggestionView;
        }
        return null;
    }

    async onload() {
        await this.loadSettings();

        if (this.settings.debugMode) {
            console.debug('Loading Smart Vault plugin...');
        }

        try {
            await this.initializeWasm();
        } catch (error) {
            new Notice('Failed to initialize WASM module: ' + error);
            console.error('WASM initialization error:', error);
        }

        this.registerView(
            VIEW_TYPE_LINK_SUGGESTIONS,
            (leaf) => new LinkSuggestionView(leaf, this)
        );

        this.inlineSuggest = new InlineLinkSuggest(this.app, this);
        this.registerEditorSuggest(this.inlineSuggest);

        // Initialize Handwritten Note Watcher
        this.handwrittenWatcher = new HandwrittenNoteWatcher(this);
        this.handwrittenWatcher.register();

        this.registerEditorExtension(inlineSuggestionExtension(this.app, this));

        this.addRibbonIcon('brain', 'Smart vault suggestions', () => {
            this.activateSuggestionView();
        });

        this.addCommand({
            id: 'scan-vault',
            name: 'Scan vault for embeddings',
            callback: () => this.scanVault()
        });



        this.addCommand({
            id: 'complete-rescan',
            name: 'Complete rescan (clear all caches)',
            callback: async () => {
                const confirmed = await this.confirmCompleteRescan();
                if (confirmed) {
                    await this.completeRescan();
                }
            }
        });

        this.addCommand({
            id: 'suggest-links-current',
            name: 'Suggest links for current note',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                this.suggestLinksForCurrentNote(view);
            }
        });

        this.addCommand({
            id: 'refresh-current-document',
            name: 'Refresh current document embedding',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                this.refreshCurrentDocument(view);
            }
        });

        this.addCommand({
            id: 'toggle-suggestion-panel',
            name: 'Toggle suggestion panel',
            callback: () => this.activateSuggestionView()
        });



        this.addCommand({
            id: 'generate-moc',
            name: 'Generate map of content (MOC)',
            callback: () => this.openGenerateMOCModal()
        });

        this.addCommand({
            id: 'extract-diagrams',
            name: 'Extract diagrams (Vision)',
            callback: () => this.extractDiagramFromActiveNote()
        });

        this.addSettingTab(new SmartVaultSettingTab(this.app, this));

        if (this.settings.autoScanEnabled) {
            this.startAutoScan();
        }

        // Context Menu: "Chat with this note"
        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor, view) => {
                const selection = editor.getSelection();
                if (selection) {
                    menu.addItem((item) => {
                        item
                            .setTitle('Smart Vault: Suggest Grammar Corrections')
                            .setIcon('spell-check')
                            .onClick(async () => {
                                await this.activateSuggestionView();
                                if (this.suggestionView) {
                                    this.suggestionView.openChatWithAction([view.file!], `Correct the grammar of this text and explain the changes:\n\n"${selection}"`);
                                }
                            });
                    });
                }
            })
        );

        // Context Menu: "Chat with this note"
        this.registerEvent(
            this.app.workspace.on('file-menu', (menu, file) => {
                if (file instanceof TFile) {
                    menu.addItem((item) => {
                        item
                            .setTitle('Smart Vault: Chat with this note')
                            .setIcon('message-square')
                            .onClick(async () => {
                                await this.activateSuggestionView();
                                if (this.suggestionView) {
                                    this.suggestionView.openChatWithFiles([file]);
                                }
                            });
                    });

                    menu.addItem((item) => {
                        item
                            .setTitle('Smart Vault: Summarize this note')
                            .setIcon('file-text')
                            .onClick(async () => {
                                await this.activateSuggestionView();
                                if (this.suggestionView) {
                                    this.suggestionView.openChatWithAction([file], "Summarize this note.");
                                }
                            });
                    });

                    menu.addItem((item) => {
                        item
                            .setTitle('Smart Vault: Generate Outline')
                            .setIcon('list')
                            .onClick(async () => {
                                await this.activateSuggestionView();
                                if (this.suggestionView) {
                                    this.suggestionView.openChatWithAction([file], "Generate a structured outline of this note.");
                                }
                            });
                    });
                    menu.addItem((item) => {
                        item
                            .setTitle('Smart Vault: Transcribe PDF (Force)')
                            .setIcon('file-audio')
                            .onClick(async () => {
                                if (file.extension === 'pdf' && this.handwrittenWatcher) {
                                    new Notice(`Force transcribing ${file.basename}...`);
                                    await this.handwrittenWatcher.forceTranscribe(file);
                                } else {
                                    new Notice(`Not a PDF or watcher not initialized.`);
                                }
                            });
                    });
                }
            })
        );

        // Context Menu: "Chat with selected notes" (Multi-file)
        this.registerEvent(
            this.app.workspace.on('files-menu', (menu, files) => {
                const selectedFiles = files.filter(f => f instanceof TFile) as TFile[];
                if (selectedFiles.length > 0) {
                    menu.addItem((item) => {
                        item
                            .setTitle(`Smart Vault: Chat with ${selectedFiles.length} notes`)
                            .setIcon('message-square')
                            .onClick(async () => {
                                await this.activateSuggestionView();
                                if (this.suggestionView) {
                                    this.suggestionView.openChatWithFiles(selectedFiles);
                                }
                            });
                    });
                }
            })
        );



        // Update suggestions when file is opened
        this.registerEvent(
            this.app.workspace.on('file-open', (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    if (this.settings.debugMode) {
                        console.debug('[DEBUG] file-open event:', file.path);
                    }
                    this.onFileOpen(file);
                }
            })
        );

        // Also update when active leaf changes (more reliable for some cases)
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', (leaf) => {
                if (leaf?.view instanceof MarkdownView) {
                    const file = leaf.view.file;
                    if (file) {
                        if (this.settings.debugMode) {
                            console.debug('[DEBUG] active-leaf-change event:', file.path);
                        }
                        this.onFileOpen(file);
                    }
                }
            })
        );

        // Watch for file modifications to invalidate caches
        this.registerEvent(
            this.app.vault.on('modify', async (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    if (this.settings.debugMode) {
                        console.debug(`[DEBUG] File modified: ${file.path}`);
                    }
                    await this.onFileModified(file);
                }
            })
        );

        // Check if we have embeddings loaded and generate suggestions if needed
        const embeddingCount = this.smartVault.get_embedding_count();
        if (embeddingCount > 0) {
            if (this.settings.debugMode) {
                console.debug(`Loaded ${embeddingCount} embeddings from disk`);
            }
            // Load cached suggestions first for instant availability
            setTimeout(async () => {
                // Ensure the suggestion view is activated so we can load suggestions
                await this.activateSuggestionView();

                // Load file contents first so deduplication works
                await this.loadFileContents();

                await this.loadSuggestions();

                // NOW mark cache as initialized - this allows file-open events to proceed
                this.cacheInitialized = true;
                if (this.settings.debugMode) {
                    console.log('[DEBUG] Cache initialization complete - file-open events now enabled');
                }

                // Check if we need to generate any suggestions
                const cachedCount = this.suggestionView?.allDocumentSuggestions.size || 0;
                const embeddingCount = this.smartVault.get_embedding_count();
                if (this.settings.debugMode) {
                    console.log(`[DEBUG] Found ${cachedCount} cached suggestions for ${embeddingCount} embeddings`);
                }

                // Check if any cached suggestions are missing LLM scores (when LLM is enabled)
                let needsLLMRegeneration = false;
                if (this.settings.useLLMReranking && this.suggestionView) {
                    for (const [path, suggestions] of this.suggestionView.allDocumentSuggestions) {
                        if (suggestions.length > 0 && !suggestions.some((s: import('../ui/LinkSuggestionView').LinkSuggestion) => s.llm_score !== undefined)) {
                            needsLLMRegeneration = true;
                            if (this.settings.debugMode) {
                                console.debug(`[DEBUG] File ${path} has ${suggestions.length} suggestions but no LLM scores`);
                            }
                            break;  // Found at least one, no need to check more
                        }
                    }
                }

                // Regenerate if cache is empty OR incomplete OR missing LLM scores
                if (cachedCount === 0 || cachedCount < embeddingCount || needsLLMRegeneration) {
                    if (needsLLMRegeneration) {
                        if (this.settings.debugMode) {
                            console.debug(`Regenerating suggestions to add LLM rankings...`);
                            console.debug(`Generating suggestions for ${embeddingCount - cachedCount} files...`);
                        }
                    } else {
                        if (this.settings.debugMode) {
                            console.debug(`Generating suggestions for ${embeddingCount - cachedCount} files...`);
                        }
                    }
                    await this.generateAllSuggestions();

                    // Save the generated suggestions
                    if (this.settings.debugMode) {
                        console.debug(`[DEBUG] About to save suggestions. allDocumentSuggestions.size=${this.suggestionView?.allDocumentSuggestions.size}`);
                    }
                    await this.saveSuggestions();
                    if (this.settings.debugMode) {
                        console.debug(`[DEBUG] Finished saving suggestions`);
                    }
                }

                // Update view if file is open
                if (this.suggestionView) {
                    const activeFile = this.app.workspace.getActiveFile();
                    if (activeFile) {
                        await this.suggestionView.updateForFile(activeFile);
                    }
                }
            }, CONSTANTS.STARTUP_DELAY_MS);
        } else {
            // No embeddings found - auto-scan vault
            if (this.settings.debugMode) {
                console.debug('No embeddings found, starting initial vault scan...');
            }
            setTimeout(async () => {
                this.cacheInitialized = true;  // Enable file-open events after scan starts
                await this.scanVault();
            }, CONSTANTS.INITIAL_SCAN_DELAY_MS); // Wait 2 seconds to let Obsidian finish loading
        }

        if (this.settings.debugMode) {
            console.debug('Smart Vault plugin loaded successfully');
        }
    }

    async initializeWasm() {
        const wasmModule = await import('../../pkg/obsidian_smart_vault.js');

        // Initialize WASM module using the bundled binary
        await wasmModule.default({ module_or_path: wasmBinary });
        wasmModule.init();

        this.wasmModule = wasmModule;
        this.smartVault = new wasmModule.SmartVault();

        // Initialize RerankerService
        this.rerankerService = new RerankerService(this.wasmModule, this.settings);

        // Initialize CacheManager
        // Initialize Cache Manager
        const cacheDir = this.settings.cacheDirectory || '_smartvault';
        this.cacheManager = new CacheManager(
            this.app,
            cacheDir,
            this.smartVault,
            this.fileModificationTimes,
            this.keywordModificationTimes,
            this.suggestionModificationTimes
        );
        this.cacheManager.setDebugMode(this.settings.debugMode);

        // Ensure cache directory exists
        await this.cacheManager.ensureCacheDirectory();

        // Initialize FileProcessor
        // Note: suggestionView might not be initialized yet, will be updated later
        this.fileProcessor = new FileProcessor(
            this.app,
            this.smartVault,
            this.rerankerService,
            this.settings,
            this.suggestionView
        );

        // Initialize VaultScanner
        this.vaultScanner = new VaultScanner(
            this.app,
            this.smartVault,
            this.wasmModule,
            this.rerankerService,
            this.cacheManager,
            this.fileProcessor,
            this.settings,
            this.suggestionView,
            this.fileModificationTimes
        );

        // Load saved embeddings if they exist
        await this.cacheManager.loadEmbeddings();

        // Load the unified cache index (includes mtimes, ignored suggestions, insertion cache)
        await this.cacheManager.loadCacheIndex();

        // Load saved keywords if they exist
        await this.cacheManager.loadKeywords();

        if (this.settings.debugMode) {
            console.debug('WASM module initialized');
        }
    }

    getEmbeddingsPath(): string {
        return this.cacheManager!.getEmbeddingsPath();
    }

    getSuggestionsPath(): string {
        return this.cacheManager!.getSuggestionsPath();
    }

    getKeywordsPath(): string {
        return this.cacheManager!.getKeywordsPath();
    }

    getLLMRerankedPath(): string {
        return this.cacheManager!.getLLMRerankedPath();
    }

    getInsertionCachePath(): string {
        return this.cacheManager!.getInsertionCachePath();
    }

    async loadFileContents() {
        return this.cacheManager!.loadFileContents();
    }

    async loadEmbeddings() {
        // Delegated to CacheManager
    }

    async loadSuggestions() {
        return this.cacheManager!.loadSuggestions(this.suggestionView);
    }

    async saveSuggestions() {
        return this.cacheManager!.saveSuggestions(this.suggestionView);
    }

    async loadKeywords() {
        // Delegated to CacheManager
        await Promise.resolve();
    }

    async saveKeywords() {
        return this.cacheManager!.saveKeywords();
    }

    async loadInsertionCache() {
        // Delegated to CacheManager
        await Promise.resolve();
    }

    async saveInsertionCache() {
        return this.cacheManager!.saveInsertionCache();
    }

    getCachedInsertion(filePath: string, linkTitle: string): import('./cache/types').InsertionResult | null {
        return this.cacheManager!.getCachedInsertion(filePath, linkTitle);
    }

    cacheInsertion(filePath: string, linkTitle: string, result: import('./cache/types').InsertionResult) {
        return this.cacheManager!.cacheInsertion(filePath, linkTitle, result);
    }

    async saveEmbeddings() {
        return this.cacheManager!.saveEmbeddings();
    }

    refreshEditors() {
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view instanceof MarkdownView && leaf.view.editor) {
                // @ts-ignore
                const editorView = leaf.view.editor.cm;
                if (editorView) {
                    editorView.dispatch({ effects: [] });
                }
            }
        });
    }

    async clearEmbeddings() {
        try {
            // Check if WASM module is initialized
            if (!this.wasmModule) {
                console.error('WASM module not initialized');
                return;
            }

            // Delegate cache clearing to CacheManager
            await this.cacheManager!.clearEmbeddings();

            // Clear suggestion cache in view
            if (this.suggestionView) {
                this.suggestionView.allDocumentSuggestions.clear();
                this.suggestionView.currentSuggestions = [];
                this.suggestionView.render();
            }

            if (this.settings.debugMode) {
                console.debug('Cleared all embeddings');
            }
        } catch (error) {
            console.error('Failed to clear embeddings:', error);
            throw error;
        }
    }

    async onFileOpen(file: TFile) {
        // Don't process file-open events until cache is loaded to avoid overwriting good cache with empty data
        if (!this.cacheInitialized) {
            if (this.settings.debugMode) {
                console.log(`[DEBUG] Ignoring early file-open for ${file.path} - cache not yet initialized`);
            }
            return;
        }

        // Deduplicate rapid file-open events (both file-open and active-leaf-change fire for same file)
        const now = Date.now();
        if (this.lastOpenedFile === file.path && (now - this.lastOpenedTime) < CONSTANTS.FILE_OPEN_DEBOUNCE_MS) {
            if (this.settings.debugMode) {
                console.log(`[DEBUG] Skipping duplicate file-open for ${file.path} (${now - this.lastOpenedTime}ms since last)`);
            }
            return;
        }
        this.lastOpenedFile = file.path;
        this.lastOpenedTime = now;

        if (this.suggestionView) {
            await this.suggestionView.updateForFile(file);
        }
    }

    /**
     * Handle file modification events.
     * Debounces rapidly firing events and checks if file content actually changed.
     * @param file The file that was modified
     */
    async onFileModified(file: TFile) {
        // Debounce file modifications - wait 2 seconds after last edit
        const existingTimer = this.debounceTimers.get(file.path);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        const timer = setTimeout(async () => {
            await Promise.resolve(); // satisfy async
            this.debounceTimers.delete(file.path);

            if (this.settings.debugMode) {
                console.log(`[DEBUG] Processing modification for: ${file.path}`);
            }

            // Check if file actually changed since we last processed it
            const cachedMtime = this.fileModificationTimes.get(file.path);
            if (cachedMtime === file.stat.mtime) {
                if (this.settings.debugMode) {
                    console.log(`[DEBUG] File mtime unchanged, skipping: ${file.path}`);
                }
                return;
            }

            // Invalidate caches for this file
            await this.invalidateFileCaches(file);

            // Regenerate embedding and suggestions for this file
            await this.refreshSingleFile(file);
        }, CONSTANTS.FILE_MODIFICATION_DEBOUNCE_MS);

        this.debounceTimers.set(file.path, timer);
    }

    invalidateFileCaches(file: TFile) {
        if (this.settings.debugMode) {
            console.log(`[DEBUG] Invalidating caches for: ${file.path}`);
        }

        // Invalidate all caches for this file via Rust CacheIndex
        this.cacheManager!.invalidateFileCaches(file.path);

        // Also remove from the JS suggestion map (needed for UI)
        if (this.suggestionView) {
            this.suggestionView.allDocumentSuggestions.delete(file.path);
        }

        // Clear LLM reranking cache for this file
        if (this.rerankerService) {
            this.rerankerService.clearRerankCache(file.path);
        }

        if (this.settings.debugMode) {
            console.log(`[DEBUG] Invalidated caches for ${file.path}`);
        }
    }

    async refreshSingleFile(file: TFile) {
        try {
            if (this.settings.debugMode) {
                console.log(`[DEBUG] Refreshing single file: ${file.path}`);
            }

            const content = await this.app.vault.read(file);
            const truncatedContent = truncateContent(content, this.settings.maxContentLength);

            // Update file content in WASM
            this.smartVault.add_file(file.path, content);

            // Regenerate embedding
            const embedding = await this.rerankerService!.generateEmbedding(truncatedContent);
            this.smartVault.set_embedding(file.path, new Float32Array(embedding));
            this.cacheManager!.markEmbeddingProcessed(file.path, file.stat.mtime);

            // Extract keywords if enabled
            if (this.settings.useKeywordExtraction) {
                try {
                    const keywords = await Promise.race([
                        this.wasmModule.extract_keywords_with_llm(
                            this.settings.ollamaEndpoint,
                            this.settings.llmModel,
                            file.basename,
                            truncatedContent,
                            this.settings.llmTemperature,
                            this.settings.enableThinkingMode,
                            this.settings.debugMode
                        ),
                        new Promise<never>((_, reject) =>
                            setTimeout(() => reject(new Error('Keyword extraction timeout')), this.settings.llmTimeout)
                        )
                    ]);

                    // Add title to keywords
                    const titleKeyword = file.basename.replace(/\.md$/, '');
                    if (!keywords.includes(titleKeyword)) {
                        keywords.unshift(titleKeyword);
                    }

                    this.smartVault.set_keywords(file.path, keywords);
                    this.cacheManager!.markKeywordProcessed(file.path, file.stat.mtime);
                } catch (error) {
                    // Fallback to title only
                    const titleKeyword = file.basename.replace(/\.md$/, '');
                    this.smartVault.set_keywords(file.path, [titleKeyword]);
                }
            } else {
                // Just use title
                const titleKeyword = file.basename.replace(/\.md$/, '');
                this.smartVault.set_keywords(file.path, [titleKeyword]);
            }

            // Regenerate suggestions
            const suggestions = await this.getSuggestionsForFile(file, content, embedding);
            if (this.suggestionView) {
                this.suggestionView.allDocumentSuggestions.set(file.path, suggestions);
                this.cacheManager!.markSuggestionProcessed(file.path, file.stat.mtime);

                // Update view if this is the current file
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile && activeFile.path === file.path) {
                    await this.suggestionView.updateForFile(file);
                }
            }

            // Save updated caches
            await this.saveEmbeddings();
            await this.saveKeywords();
            await this.saveSuggestions();

            if (this.settings.debugMode) {
                console.log(`[DEBUG] Successfully refreshed: ${file.path}`);
            }
        } catch (error) {
            console.error(`Error refreshing file ${file.path}:`, error);
        }
    }

    /**
     * Standard vault scan.
     * Queues scan in background, processes files in batches, and updates embeddings.
     */
    async scanVault() {
        const notice = new Notice('Scanning vault...', 0);

        try {
            const message = await this.vaultScanner!.scanVault(notice);
            new Notice(message);
        } catch (error) {
            notice.hide();
            new Notice('Error scanning vault: ' + error);
            console.error('Vault scan error:', error);
        }
    }

    async confirmCompleteRescan(): Promise<boolean> {
        return new Promise((resolve) => {
            const modal = new ConfirmModal(
                this.app,
                'Complete Rescan',
                'This will clear ALL caches (embeddings, keywords, suggestions, insertions) and regenerate everything from scratch. This may take several minutes.\n\nAre you sure you want to proceed?',
                (confirmed) => resolve(confirmed)
            );
            modal.open();
        });
    }

    /**
     * Completely resets the plugin state.
     * Deletes all caches, clears memory, and triggers a fresh full scan.
     */
    async completeRescan() {
        const notice = new Notice('Clearing all caches...', 0);

        try {
            // Clear in-memory caches
            this.smartVault = new this.wasmModule.SmartVault();
            this.fileModificationTimes.clear();
            this.keywordModificationTimes.clear();
            this.suggestionModificationTimes.clear();
            this.cacheManager!.clearInsertionCache();
            if (this.suggestionView) {
                this.suggestionView.allDocumentSuggestions.clear();
            }

            // Delete cache files
            const adapter = this.app.vault.adapter;
            const cacheFiles = [
                this.getEmbeddingsPath(),                          // JSON embeddings (legacy)
                this.cacheManager!.getEmbeddingsBinaryPath(),      // Binary embeddings (current)
                this.getKeywordsPath(),
                this.getSuggestionsPath(),
                this.getInsertionCachePath(),
                this.getLLMRerankedPath(),
                this.cacheManager!.getIgnoredSuggestionsPath()     // Ignored suggestions
            ];

            if (this.settings.debugMode) {
                console.log('[DEBUG] Complete rescan: deleting cache files...');
            }
            for (const cachePath of cacheFiles) {
                try {
                    // @ts-ignore
                    const exists = await adapter.exists(cachePath);
                    if (exists) {
                        await adapter.remove(cachePath);
                        if (this.settings.debugMode) {
                            console.log(`[DEBUG] Deleted cache file: ${cachePath}`);
                        }
                    } else {
                        if (this.settings.debugMode) {
                            console.log(`[DEBUG] Cache file not found (already deleted?): ${cachePath}`);
                        }
                    }
                } catch (error) {
                    console.error(`Error deleting cache file ${cachePath}:`, error);
                }
            }
            if (this.settings.debugMode) {
                console.log('[DEBUG] Complete rescan: cache files deleted, starting scan...');
            }

            notice.setMessage('All caches cleared. Starting complete scan...');

            // Force a complete scan
            await this.scanVault();

            notice.hide();
            new Notice('Complete rescan finished!');
        } catch (error) {
            notice.hide();
            new Notice('Error during complete rescan: ' + error);
            console.error('Complete rescan error:', error);
        }
    }

    /**
     * Manually refresh the embedding and suggestions for the current document.
     * @param view The active MarkdownView
     */
    async refreshCurrentDocument(view: MarkdownView) {
        const file = view.file;
        if (!file) {
            new Notice('No active file');
            return;
        }

        if (this.settings.debugMode) {
            console.log(`[DEBUG] Refresh button clicked for: ${file.path}`);
        }

        const notice = new Notice(`Refreshing ${file.basename}...`, 0);

        try {
            const suggestions = await this.fileProcessor!.refreshDocument(
                file,
                () => this.saveEmbeddings()
            );

            notice.hide();
            new Notice(`Refreshed ${file.basename} - ${suggestions.length} suggestions`);
        } catch (error) {
            notice.hide();
            new Notice('Error refreshing document: ' + error);
            console.error('Refresh error:', error);
            if (this.settings.debugMode) {
                console.log(`[DEBUG] Refresh failed with error:`, error);
            }
        }
    }

    /**
     * Generate link suggestions for a file.
     * Wrapper for FileProcessor.getSuggestionsForFile
     */
    async getSuggestionsForFile(file: TFile, content: string, existingEmbedding?: number[], skipLLM: boolean = false, forceLLMRefresh: boolean = false): Promise<any[]> {
        if (!this.fileProcessor) return [];

        let embedding = existingEmbedding;
        if (!embedding || embedding.length === 0) {
            // Check if we have valid embedding in cache for this file content
            // Use smartVault directly as CacheManager doesn't expose getEmbedding
            if (this.smartVault && this.smartVault.has_embedding(file.path)) {
                const cachedEmb = this.smartVault.get_embedding(file.path);
                if (cachedEmb && cachedEmb.length > 0) {
                    embedding = Array.from(cachedEmb);
                }
            }

            if (!embedding || embedding.length === 0) {
                embedding = await this.fileProcessor.rerankerService.generateEmbedding(content);
            }
        }

        return this.fileProcessor.getSuggestionsForFile(file, content, embedding || [], skipLLM, forceLLMRefresh);
    }

    async generateAllSuggestions() {
        return this.fileProcessor!.generateAllSuggestions();
    }

    async suggestLinksForCurrentNote(view: MarkdownView) {
        const file = view.file;
        if (!file) return;

        try {
            const suggestions = await this.fileProcessor!.suggestLinksForCurrentNote(file);
            new Notice(`Found ${suggestions.length} link suggestions`);
        } catch (error) {
            new Notice('Error generating suggestions: ' + error);
            console.error('Suggestion error:', error);
        }
    }

    async activateSuggestionView() {
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_LINK_SUGGESTIONS);

        if (existing.length) {
            this.app.workspace.revealLeaf(existing[0]);
            return;
        }

        await this.app.workspace.getRightLeaf(false)?.setViewState({
            type: VIEW_TYPE_LINK_SUGGESTIONS,
            active: true,
        });

        this.app.workspace.revealLeaf(
            this.app.workspace.getLeavesOfType(VIEW_TYPE_LINK_SUGGESTIONS)[0]
        );
    }

    /**
     * Starts the automatic vault scan interval.
     */
    startAutoScan() {
        if (this.scanIntervalId !== null) {
            window.clearInterval(this.scanIntervalId);
        }

        const intervalMs = this.settings.scanInterval * 60 * 1000;
        this.scanIntervalId = window.setInterval(() => {
            this.scanVault();
        }, intervalMs);

        if (this.settings.debugMode) {
            console.debug(`Auto-scan started: every ${this.settings.scanInterval} minutes`);
        }
    }

    stopAutoScan() {
        if (this.scanIntervalId !== null) {
            window.clearInterval(this.scanIntervalId);
            this.scanIntervalId = null;
            if (this.settings.debugMode) {
                console.debug('Auto-scan stopped');
            }
        }
    }

    onunload() {
        this.stopAutoScan();

        // Clear any pending debounce timers to prevent memory leaks
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();

        // Save embeddings synchronously on unload via CacheManager
        if (this.cacheManager) {
            try {
                const embeddingsJson = this.smartVault.serialize_embeddings();
                const embeddingsPath = this.cacheManager.getEmbeddingsPath();
                this.app.vault.adapter.write(embeddingsPath, embeddingsJson);
            } catch (error) {
                console.error('Failed to save embeddings on unload:', error);
            }
        }

        if (this.settings.debugMode) {
            console.debug('Smart Vault plugin unloaded');
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

        // Migration: bump old 15s timeout to new 30s default
        // This helps users who had the old default and are experiencing timeouts
        if (this.settings.llmTimeout === 15000) {
            if (this.settings.debugMode) {
                console.debug('[Smart Vault] Migrating LLM timeout from 15s to 30s default');
            }
            this.settings.llmTimeout = 30000;
            await this.saveSettings();
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    // ============================================================
    // MOC Generator (Phase 3)
    // ============================================================

    openGenerateMOCModal() {
        const activeFile = this.app.workspace.getActiveFile();
        const defaultTopic = activeFile ? activeFile.basename : '';

        new GenerateMOCModal(this.app, defaultTopic, async (topic) => {
            await this.generateMOC(topic);
        }).open();
    }

    /**
     * Generates a Map of Content (MOC) for a given topic.
     * Finds relevant notes using vector similarity and uses LLM to structure them.
     * @param topic The central topic/title for the MOC
     */
    async generateMOC(topic: string) {
        if (!topic) return;
        new Notice(`Generating MOC for "${topic}"...`);

        try {
            // 1. Get embedding for topic
            // Use 'bge-m3' or configured model
            const embeddingModel = this.settings.embeddingModel || 'bge-m3';
            const topicVec = await this.wasmModule.generate_embedding_ollama(
                this.settings.ollamaEndpoint,
                embeddingModel,
                topic
            );
            // NOTE: generate_embedding_ollama returns Promise<Float32Array> or number[]? 
            // In RerankerService it returns number[].
            // Checking wasmModule usage... RerankerService calls `generate_embedding_ollama`.

            // 2. Find relevant notes (Top 50)
            const relevantSuggestions = this.smartVault.suggest_links_for_text(
                topic, // 'text' content - not relevant for retrieval, just used for title matching logic
                new Float32Array(topicVec),
                CONSTANTS.MOC_SIMILARITY_THRESHOLD, // threshold
                "", // current_file_path (empty to avoid exclusion)
                CONSTANTS.MOC_TOP_K // top_k
            );

            // relevantSuggestions is Array of LinkSuggestion objects.

            if (relevantSuggestions.length < 3) {
                new Notice(`Not enough relevant notes found for "${topic}" (found ${relevantSuggestions.length}).`);
                return;
            }

            new Notice(`Found ${relevantSuggestions.length} related notes. Asking AI to organize...`);

            // 3. Call LLM to generate MOC
            const notesJson = JSON.stringify(relevantSuggestions);
            const mocContent = await this.wasmModule.generate_moc_with_llm(
                this.settings.ollamaEndpoint,
                this.settings.organizationModel || this.settings.chatModel || this.settings.llmModel,
                topic,
                notesJson,
                0.7, // temperature
                this.settings.enableThinkingMode,
                this.settings.debugMode
            );

            // 4. Create File
            const filename = `MOC - ${topic}.md`;
            const targetFile = await this.app.vault.create(filename, mocContent);

            // Open the new file
            this.app.workspace.getLeaf().openFile(targetFile);
            new Notice(`MOC created: ${filename}`);

        } catch (error) {
            console.error("MOC generation failed:", error);
            new Notice(`MOC generation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    // ============================================================
    // Auto-Crop Diagrams (Phase 3)
    // ============================================================

    async extractDiagramFromActiveNote() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file.');
            return;
        }

        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return;

        const content = view.getViewData();
        // Regex to find FIRST image: ![[image.png]] or ![[image.png|...]]
        const linkRegex = /!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/;
        const match = content.match(linkRegex);

        if (!match) {
            new Notice('No embedded images found in this note.');
            return;
        }

        const imagePath = match[1];
        const imageFile = this.app.metadataCache.getFirstLinkpathDest(imagePath, activeFile.path);

        if (!imageFile || !(imageFile instanceof TFile)) {
            new Notice(`Could not resolve image file: ${imagePath}`);
            return;
        }

        if (!['png', 'jpg', 'jpeg', 'webp'].includes(imageFile.extension.toLowerCase())) {
            new Notice('Only PNG, JPG, and WEBP images are supported.');
            return;
        }

        new Notice(`Analyzing ${imagePath} for diagrams...`);

        try {
            const arrayBuffer = await this.app.vault.readBinary(imageFile);
            const base64 = this.arrayBufferToBase64(arrayBuffer);

            // Detect objects (Vision Model)
            // Use 'visionModel' setting (e.g. qwen2.5-vl)
            const visionModel = this.settings.visionModel || 'ministral-3:3b';

            const resultJson = await this.wasmModule.detect_objects_with_llm(
                this.settings.ollamaEndpoint,
                visionModel,
                base64,
                this.settings.debugMode
            );

            if (this.settings.debugMode) {
                console.debug('[DEBUG] object detection result:', resultJson);
            }

            // Clean response (sometimes has markdown blocks)
            const cleanedJson = resultJson.replace(/```json/g, '').replace(/```/g, '').trim();

            let coords;
            try {
                coords = JSON.parse(cleanedJson);
            } catch (e) {
                // Try to find array regex
                const arrMatch = cleanedJson.match(/\[\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\]/);
                if (arrMatch) {
                    coords = JSON.parse(arrMatch[0]);
                } else {
                    throw new Error("Could not parse coordinates: " + resultJson);
                }
            }

            if (!coords || !Array.isArray(coords) || coords.length !== 4) {
                new Notice('No valid diagram coordinates returned.');
                return;
            }

            // [ymin, xmin, ymax, xmax] in 0-1000 scale
            const [ymin, xmin, ymax, xmax] = coords;
            if (ymin === null || ymin === undefined) {
                new Notice('No diagram detected.');
                return;
            }

            new Notice(`Diagram detected at [${ymin}, ${xmin}]. Cropping...`);

            // Crop Image using HTML Canvas
            const blob = new Blob([arrayBuffer]);
            const imageBitmap = await createImageBitmap(blob);

            const canvas = document.createElement('canvas');
            const width = imageBitmap.width;
            const height = imageBitmap.height;

            // Calculate pixel coordinates
            const x = Math.floor((xmin / 1000) * width);
            const y = Math.floor((ymin / 1000) * height);
            const w = Math.floor(((xmax - xmin) / 1000) * width);
            const h = Math.floor(((ymax - ymin) / 1000) * height);

            canvas.width = w;
            canvas.height = h;

            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error("Could not get canvas context");

            ctx.drawImage(imageBitmap, x, y, w, h, 0, 0, w, h);

            // Convert to blob/buffer
            // We need to write to vault. Obsidian writes ArrayBuffer.
            // Canvas -> Blob -> ArrayBuffer
            canvas.toBlob(async (croppedBlob) => {
                if (!croppedBlob) {
                    new Notice("Failed to create cropped image blob");
                    return;
                }
                const croppedBuffer = await croppedBlob.arrayBuffer();

                // Save file
                const timestamp = Date.now();
                const newFilename = `Diagram_${timestamp}.png`;
                const _newFile = await this.app.vault.createBinary(newFilename, croppedBuffer);

                // Append to note
                const editor = view.editor;
                editor.replaceSelection(`\n![[${newFilename}]]\n*Extracted Diagram*\n`);

                new Notice(`Saved diagram: ${newFilename}`);

            }, 'image/png');

        } catch (error) {
            console.error('Failed to extract diagram:', error);
            new Notice(`Failed to extract diagram: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    arrayBufferToBase64(buffer: ArrayBuffer): string {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }
}

// Simple Modal for MOC Topic
class GenerateMOCModal extends Modal {
    topic: string;
    onSubmit: (topic: string) => void;

    constructor(app: App, defaultTopic: string, onSubmit: (topic: string) => void) {
        super(app);
        this.topic = defaultTopic;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Generate map of content' });

        const div = contentEl.createDiv({ cls: 'setting-item-control' });
        const input = div.createEl('input', {
            type: 'text',
            value: this.topic,
            cls: 'smart-vault-full-width'
        });
        input.placeholder = 'Enter topic (e.g. Fluid dynamics)';
        input.addEventListener('input', (e) => {
            this.topic = (e.target as HTMLInputElement).value;
        });

        // Focus input
        setTimeout(() => input.focus(), 50);

        const btnDiv = contentEl.createDiv({ cls: 'modal-button-container smart-vault-margin-top-20' });
        const btn = btnDiv.createEl('button', { text: 'Generate', cls: 'mod-cta' });
        btn.addEventListener('click', () => {
            this.close();
            this.onSubmit(this.topic);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.close();
                this.onSubmit(this.topic);
            }
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
