import { App, TFile, Notice } from 'obsidian';
import type { KeywordCache, SuggestionCache } from './types';
import * as wasmNamespace from '../../../pkg/obsidian_smart_vault';
import type { LinkSuggestionView } from '../../ui/LinkSuggestionView';
import type { ChatMessage } from '../../ui/tabs/ChatTab';

/**
 * Manages all cache operations for the Smart Vault plugin.
 * Now delegates mtime tracking, ignored suggestions, and insertion cache to Rust.
 * Handles loading/saving of:
 * - Embeddings (768-dim vectors) - stored in Rust SmartVault
 * - Cache Index (mtimes, ignored, insertions) - stored in Rust CacheIndex
 * - Keywords (extracted by LLM) - stored in Rust SmartVault
 * - Suggestions (pre-computed link suggestions per file) - stored in JS for UI access
 */
export class CacheManager {
    private app: App;
    private manifestDir: string;
    private smartVault: wasmNamespace.SmartVault;
    private saveEmbeddingsTimeout: number | null = null;
    private saveCacheIndexTimeout: number | null = null;
    private saveQueue: Promise<void> = Promise.resolve();
    private saveInProgress: boolean = false;
    private debugMode: boolean = false;

    constructor(
        app: App,
        cacheDir: string, // Renamed from manifestDir to be generic
        smartVault: wasmNamespace.SmartVault,
        // These Maps are kept for backward compatibility but now sync with Rust
        _fileModificationTimes: Map<string, number>,
        _keywordModificationTimes: Map<string, number>,
        _suggestionModificationTimes: Map<string, number>
    ) {
        this.app = app;
        this.manifestDir = cacheDir; // Usage remains same, but semantic checks will be handled in plugin
        this.smartVault = smartVault;
    }

    setDebugMode(enabled: boolean) {
        this.debugMode = enabled;
    }

    // Ensure cache directory exists
    async ensureCacheDirectory() {
        try {
            const adapter = this.app.vault.adapter;
            // @ts-ignore
            if (!(await adapter.exists(this.manifestDir))) {
                if (this.debugMode) {
                    console.debug(`[DEBUG] Creating cache directory: ${this.manifestDir}`);
                }
                // @ts-ignore
                await adapter.mkdir(this.manifestDir);
            }
        } catch (e) {
            console.error(`Failed to create cache directory ${this.manifestDir}:`, e);
        }
    }

    // Path helpers
    getEmbeddingsPath(): string {
        return `${this.manifestDir}/smart-vault-embeddings.json`;
    }

    getEmbeddingsBinaryPath(): string {
        return `${this.manifestDir}/smart-vault-embeddings.bin`;
    }

    getCacheIndexPath(): string {
        return `${this.manifestDir}/smart-vault-cache-index.bin`;
    }

    getSuggestionsPath(): string {
        return `${this.manifestDir}/smart-vault-suggestions.json`;
    }

    getKeywordsPath(): string {
        return `${this.manifestDir}/smart-vault-keywords.json`;
    }

    getLLMRerankedPath(): string {
        return `${this.manifestDir}/smart-vault-llm-reranked.json`;
    }

    getInsertionCachePath(): string {
        return `${this.manifestDir}/smart-vault-insertions.json`;
    }

    getIgnoredSuggestionsPath(): string {
        return `${this.manifestDir}/smart-vault-ignored.json`;
    }

    getChatHistoryPath(): string {
        return `${this.manifestDir}/smart-vault-chat-history.json`;
    }

    // ============================================================
    // Cache Index Operations (Now delegated to Rust)
    // ============================================================

    /**
     * Load chat history from JSON file.
     */
    async loadChatHistory(): Promise<Record<string, ChatMessage[]>> {
        try {
            const path = this.getChatHistoryPath();
            const adapter = this.app.vault.adapter;
            // @ts-ignore
            if (await adapter.exists(path)) {
                // @ts-ignore
                const json = await adapter.read(path);
                return JSON.parse(json);
            }
        } catch (e) {
            console.error('Error loading chat history:', e);
        }
        return {};
    }

    /**
     * Save chat history to JSON file.
     */
    async saveChatHistory(history: Record<string, ChatMessage[]>) {
        try {
            const path = this.getChatHistoryPath();
            const adapter = this.app.vault.adapter;
            // @ts-ignore
            await adapter.write(path, JSON.stringify(history, null, 2));
        } catch (e) {
            console.error('Error saving chat history:', e);
        }
    }

    /**
     * Delete chat history for a specific file.
     */
    async deleteChatHistory(filePath: string) {
        try {
            const history = await this.loadChatHistory();
            if (history[filePath]) {
                delete history[filePath];
                await this.saveChatHistory(history);
            }
        } catch (e) {
            console.error('Error deleting chat history:', e);
        }
    }

    /**
     * Load the unified cache index from binary file.
     * This includes mtimes, ignored suggestions, and insertion cache.
     */
    async loadCacheIndex() {
        try {
            const cachePath = this.getCacheIndexPath();
            const adapter = this.app.vault.adapter;

            // @ts-ignore
            const exists = await adapter.exists(cachePath);
            if (!exists) {
                if (this.debugMode) {
                    console.debug('[DEBUG] No cache index found, will migrate from legacy files');
                }
                // Try to migrate from legacy files
                await this.migrateLegacyCaches();
                return;
            }

            const startTime = performance.now();
            // @ts-ignore
            const binaryData = await adapter.readBinary(cachePath);
            const uint8Array = new Uint8Array(binaryData);

            this.smartVault.deserialize_cache_index(uint8Array);

            const loadTime = (performance.now() - startTime).toFixed(2);
            if (this.debugMode) {
                console.debug(`[DEBUG] Loaded cache index in ${loadTime}ms`);
            }
        } catch (error) {
            console.error('Error loading cache index:', error);
            // Try to migrate from legacy files
            await this.migrateLegacyCaches();
        }
    }

    /**
     * Save the unified cache index to binary file.
     */
    saveCacheIndex() {
        // Debounce saves
        if (this.saveCacheIndexTimeout !== null) {
            clearTimeout(this.saveCacheIndexTimeout);
        }

        this.saveCacheIndexTimeout = window.setTimeout(() => {
            void (async () => {
                this.saveCacheIndexTimeout = null;

                try {
                    const cachePath = this.getCacheIndexPath();
                    const adapter = this.app.vault.adapter;

                    const startTime = performance.now();
                    const binaryData = this.smartVault.serialize_cache_index();
                    const arrayBuffer = binaryData.buffer;

                    // @ts-ignore
                    await adapter.writeBinary(cachePath, arrayBuffer);

                    const saveTime = (performance.now() - startTime).toFixed(2);
                    const sizeKB = (arrayBuffer.byteLength / 1024).toFixed(2);

                    if (this.debugMode) {
                        console.debug(`[DEBUG] Saved cache index in ${saveTime}ms (${sizeKB} KB)`);
                    }
                } catch (error) {
                    console.error('Error saving cache index:', error);
                }
            })();
        }, 500);
    }

    /**
     * Migrate from legacy separate cache files to unified cache index.
     */
    private async migrateLegacyCaches() {
        if (this.debugMode) {
            console.debug('[DEBUG] Attempting to migrate legacy cache files...');
        }

        // Migrate ignored suggestions
        await this.migrateLegacyIgnoredSuggestions();

        // Migrate insertion cache
        await this.migrateLegacyInsertionCache();

        // Save the migrated data
        this.saveCacheIndex();

        if (this.debugMode) {
            console.debug('[DEBUG] Legacy cache migration complete');
        }
    }

    private async migrateLegacyIgnoredSuggestions() {
        try {
            const cachePath = this.getIgnoredSuggestionsPath();
            const adapter = this.app.vault.adapter;

            // @ts-ignore
            const exists = await adapter.exists(cachePath);
            if (!exists) return;

            const cacheJson = await adapter.read(cachePath);
            const parsed: { [key: string]: number } = JSON.parse(cacheJson);

            let count = 0;
            for (const key of Object.keys(parsed)) {
                const parts = key.split('|');
                if (parts.length === 2) {
                    this.smartVault.ignore_suggestion(parts[0], parts[1]);
                    count++;
                }
            }

            if (this.debugMode) {
                console.debug(`[DEBUG] Migrated ${count} ignored suggestions from legacy file`);
            }

            // Optionally remove the legacy file
            // await adapter.remove(cachePath);
        } catch (error) {
            if (this.debugMode) {
                console.debug('[DEBUG] No legacy ignored suggestions to migrate:', error);
            }
        }
    }

    private async migrateLegacyInsertionCache() {
        try {
            const cachePath = this.getInsertionCachePath();
            const adapter = this.app.vault.adapter;

            // @ts-ignore
            const exists = await adapter.exists(cachePath);
            if (!exists) return;

            const cacheJson = await adapter.read(cachePath);
            const parsed: Record<string, unknown> = JSON.parse(cacheJson);

            let count = 0;
            for (const [key, value] of Object.entries(parsed)) {
                const parts = key.split('::');
                if (parts.length === 2) {
                    this.smartVault.cache_insertion(parts[0], parts[1], JSON.stringify(value));
                    count++;
                }
            }

            if (this.debugMode) {
                console.debug(`[DEBUG] Migrated ${count} insertion cache entries from legacy file`);
            }
        } catch (error) {
            if (this.debugMode) {
                console.debug('[DEBUG] No legacy insertion cache to migrate:', error);
            }
        }
    }

    // ============================================================
    // File freshness checks (delegated to Rust)
    // ============================================================

    isEmbeddingFresh(path: string, mtime: number): boolean {
        return this.smartVault.is_embedding_fresh(path, mtime);
    }

    isKeywordFresh(path: string, mtime: number): boolean {
        return this.smartVault.is_keyword_fresh(path, mtime);
    }

    isSuggestionFresh(path: string, mtime: number): boolean {
        return this.smartVault.is_suggestion_fresh(path, mtime);
    }

    markEmbeddingProcessed(path: string, mtime: number) {
        this.smartVault.mark_embedding_processed(path, mtime);
    }

    markKeywordProcessed(path: string, mtime: number) {
        this.smartVault.mark_keyword_processed(path, mtime);
    }

    markSuggestionProcessed(path: string, mtime: number) {
        this.smartVault.mark_suggestion_processed(path, mtime);
    }

    invalidateFileCaches(path: string) {
        this.smartVault.invalidate_file_caches(path);
    }

    // File contents loading
    async loadFileContents() {
        const files = this.app.vault.getMarkdownFiles();
        let filesLoaded = 0;

        for (const file of files) {
            if (this.smartVault.has_embedding(file.path)) {
                try {
                    const content = await this.app.vault.read(file);
                    this.smartVault.add_file(file.path, content);
                    filesLoaded++;
                } catch (error) {
                    console.error(`Error loading content for ${file.path}:`, error);
                }
            }
        }

        if (this.debugMode) {
            console.debug(`[DEBUG] Loaded ${filesLoaded} file contents for deduplication`);
        }
    }

    // Embeddings cache
    async loadEmbeddings() {
        try {
            const binaryPath = this.getEmbeddingsBinaryPath();
            const jsonPath = this.getEmbeddingsPath();
            const adapter = this.app.vault.adapter;

            if (this.debugMode) {
                console.debug(`[DEBUG] Attempting to load embeddings (binary preferred)`);
            }

            // @ts-ignore - exists method may not be typed
            const binaryExists = await adapter.exists(binaryPath);

            // Try binary format first (faster)
            if (binaryExists) {
                try {
                    const startTime = performance.now();
                    // @ts-ignore - readBinary method may not be typed
                    const binaryData = await adapter.readBinary(binaryPath);

                    // Convert ArrayBuffer to Uint8Array
                    const uint8Array = new Uint8Array(binaryData);

                    this.smartVault.deserialize_embeddings_binary(uint8Array);

                    const loadedCount = this.smartVault.get_embedding_count();
                    const loadTime = (performance.now() - startTime).toFixed(2);

                    if (this.debugMode) {
                        console.debug(`[DEBUG] Loaded ${loadedCount} embeddings from binary cache in ${loadTime}ms`);
                    }

                    // Mark all loaded embeddings as processed with current file mtimes
                    const files = this.app.vault.getMarkdownFiles();
                    for (const file of files) {
                        if (this.smartVault.has_embedding(file.path)) {
                            this.smartVault.mark_embedding_processed(file.path, file.stat.mtime);
                        }
                    }

                    if (this.debugMode) {
                        console.debug(`Loaded saved embeddings (binary format, ${loadTime}ms)`);
                    }
                    return;
                } catch (error) {
                    console.error('[WARNING] Failed to load binary cache, falling back to JSON:', error);
                }
            }

            // Fall back to JSON format (legacy or migration)
            // @ts-ignore
            let jsonExists = await adapter.exists(jsonPath);
            let loadPath = jsonPath;

            // Migration: check old path if new path doesn't exist
            if (!jsonExists) {
                const oldPath = `${this.manifestDir}/embeddings.json`;
                // @ts-ignore
                const oldExists = await adapter.exists(oldPath);
                if (oldExists) {
                    if (this.debugMode) {
                        console.debug('Migrating embeddings from old location...');
                    }
                    loadPath = oldPath;
                    jsonExists = true;
                }
            }

            if (jsonExists) {
                const startTime = performance.now();
                const embeddingsJson = await adapter.read(loadPath);
                if (this.debugMode) {
                    console.debug(`[DEBUG] Loading embeddings from JSON: ${loadPath}`);
                    console.debug(`[DEBUG] Embeddings JSON length: ${embeddingsJson.length} chars`);
                }

                this.smartVault.deserialize_embeddings(embeddingsJson);

                const loadedCount = this.smartVault.get_embedding_count();
                const loadTime = (performance.now() - startTime).toFixed(2);
                if (this.debugMode) {
                    console.debug(`[DEBUG] Loaded ${loadedCount} file embeddings from disk in ${loadTime}ms`);
                }

                // Mark embeddings as processed
                const parsed = JSON.parse(embeddingsJson);
                const paths = Object.keys(parsed);
                if (this.debugMode) {
                    console.debug(`[DEBUG] Embeddings JSON contains ${paths.length} file entries`);
                }

                for (const path of paths) {
                    const file = this.app.vault.getAbstractFileByPath(path);
                    if (file instanceof TFile) {
                        this.smartVault.mark_embedding_processed(path, file.stat.mtime);
                    }
                }

                if (this.debugMode) {
                    console.debug(`Loaded saved embeddings (JSON format, ${loadTime}ms) - will migrate to binary on next save`);
                }
            }
        } catch (error) {
            if (this.debugMode) {
                console.debug('No saved embeddings found or error loading:', error);
            }
        }
    }

    saveEmbeddings() {
        // Debounce saves - reduced from 3s to 1s (binary format is much faster)
        if (this.saveEmbeddingsTimeout !== null) {
            clearTimeout(this.saveEmbeddingsTimeout);
        }

        this.saveEmbeddingsTimeout = window.setTimeout(() => {
            this.saveEmbeddingsTimeout = null;

            if (this.saveInProgress) {
                if (this.debugMode) {
                    console.debug('[DEBUG] Save already in progress, skipping');
                }
                return;
            }

            this.saveQueue = this.saveQueue
                .catch(() => { })
                .then(async () => {
                    this.saveInProgress = true;
                    const binaryPath = this.getEmbeddingsBinaryPath();

                    try {
                        if (this.debugMode) {
                            console.debug(`[DEBUG] Attempting to save to: ${binaryPath}`);
                            console.debug(`[DEBUG] manifest.dir = ${this.manifestDir}`);
                        }

                        const maxRetries = 10;
                        let lastError: Error | null = null;

                        for (let attempt = 1; attempt <= maxRetries; attempt++) {
                            try {
                                // Ensure directory exists
                                const dirPath = binaryPath.substring(0, binaryPath.lastIndexOf('/'));
                                // @ts-ignore
                                const dirExists = await this.app.vault.adapter.exists(dirPath);
                                if (!dirExists) {
                                    if (this.debugMode) {
                                        console.debug(`[DEBUG] Creating directory: ${dirPath}`);
                                    }
                                    // @ts-ignore
                                    await this.app.vault.adapter.mkdir(dirPath);
                                }

                                const startTime = performance.now();

                                // Serialize to binary format
                                const binaryData = this.smartVault.serialize_embeddings_binary();

                                // Convert Uint8Array to ArrayBuffer for writing
                                const arrayBuffer = binaryData.buffer;

                                // @ts-ignore - writeBinary method may not be typed
                                await this.app.vault.adapter.writeBinary(binaryPath, arrayBuffer);

                                const saveTime = (performance.now() - startTime).toFixed(2);
                                const sizeKB = (arrayBuffer.byteLength / 1024).toFixed(2);

                                if (this.debugMode) {
                                    console.debug(`[DEBUG] Saved embeddings to binary cache in ${saveTime}ms (${sizeKB} KB, attempt ${attempt})`);
                                } else if (attempt > 1) {
                                    if (this.debugMode) {
                                        console.debug(`Saved embeddings to disk (after ${attempt} attempts, ${saveTime}ms, ${sizeKB} KB)`);
                                    }
                                } else {
                                    if (this.debugMode) {
                                        console.debug(`Saved embeddings to disk (${saveTime}ms, ${sizeKB} KB)`);
                                    }
                                }

                                lastError = null;
                                break;

                            } catch (error) {
                                lastError = error as Error;

                                if (attempt < maxRetries) {
                                    const delay = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
                                    if (this.debugMode) {
                                        console.debug(`[DEBUG] Save attempt ${attempt}/${maxRetries} failed: ${error}. Retrying in ${delay}ms...`);
                                    } else if (attempt === 1) {
                                        if (this.debugMode) {
                                            console.debug('File locked by Nextcloud, retrying...');
                                        }
                                    }
                                    await new Promise(resolve => setTimeout(resolve, delay));
                                }
                            }
                        }

                        if (lastError) {
                            if (this.debugMode) {
                                console.error('Failed to save embeddings after', maxRetries, 'attempts:', lastError);
                            } else {
                                if (this.debugMode) {
                                    console.debug('Could not save embeddings (file locked by sync), will retry on next change');
                                }
                            }
                        }

                        // Also save the cache index
                        this.saveCacheIndex();
                    } finally {
                        // Always reset saveInProgress even if an unexpected error occurs
                        this.saveInProgress = false;
                    }
                });
        }, 1000); // Reduced from 3s to 1s - binary format is much faster
    }

    async clearEmbeddings() {
        try {
            this.smartVault = new wasmNamespace.SmartVault();

            // Clear caches in Rust
            this.smartVault.clear_all_caches();

            const embeddingsPath = this.getEmbeddingsPath();
            const binaryPath = this.getEmbeddingsBinaryPath();
            const suggestionsPath = this.getSuggestionsPath();
            const cacheIndexPath = this.getCacheIndexPath();
            const adapter = this.app.vault.adapter;

            // Remove JSON cache (if exists)
            // @ts-ignore
            const embeddingsExists = await adapter.exists(embeddingsPath);
            if (embeddingsExists) {
                await adapter.remove(embeddingsPath);
            }

            // Remove binary cache (if exists)
            // @ts-ignore
            const binaryExists = await adapter.exists(binaryPath);
            if (binaryExists) {
                await adapter.remove(binaryPath);
            }

            // @ts-ignore
            const suggestionsExists = await adapter.exists(suggestionsPath);
            if (suggestionsExists) {
                await adapter.remove(suggestionsPath);
            }

            // Remove cache index
            // @ts-ignore
            const cacheIndexExists = await adapter.exists(cacheIndexPath);
            if (cacheIndexExists) {
                await adapter.remove(cacheIndexPath);
            }

            if (this.debugMode) {
                console.debug('Cleared embeddings cache (both JSON and binary formats) and cache index');
            }
        } catch (error) {
            console.error('Error clearing embeddings:', error);
        }
    }

    // Keywords cache
    async loadKeywords() {
        try {
            const keywordsPath = this.getKeywordsPath();
            const adapter = this.app.vault.adapter;

            // @ts-ignore
            const exists = await adapter.exists(keywordsPath);
            if (!exists) {
                if (this.debugMode) {
                    console.debug('[DEBUG] No keywords cache found');
                }
                return;
            }

            const keywordsJson = await adapter.read(keywordsPath);
            const parsed: KeywordCache = JSON.parse(keywordsJson);

            let totalKeywords = 0;
            let staleCount = 0;

            for (const [path, data] of Object.entries(parsed)) {
                if (data && typeof data === 'object' && 'keywords' in data && 'mtime' in data) {
                    const file = this.app.vault.getAbstractFileByPath(path);
                    if (file instanceof TFile) {
                        if (data.mtime && file.stat.mtime === data.mtime) {
                            this.smartVault.set_keywords(path, data.keywords);
                            this.smartVault.mark_keyword_processed(path, data.mtime);
                            totalKeywords += data.keywords.length;
                        } else {
                            staleCount++;
                        }
                    } else {
                        staleCount++;
                    }
                } else if (Array.isArray(data)) {
                    // Old format compatibility
                    this.smartVault.set_keywords(path, data);
                    totalKeywords += data.length;
                }
            }

            if (this.debugMode) {
                console.debug(`[DEBUG] Loaded ${totalKeywords} keywords from cache (${staleCount} stale entries skipped)`);
            }
        } catch (error) {
            console.error('Error loading keywords cache:', error);
        }
    }

    async saveKeywords() {
        try {
            const keywordsPath = this.getKeywordsPath();
            const adapter = this.app.vault.adapter;

            const keywordsObj: KeywordCache = {};
            const files = this.app.vault.getMarkdownFiles();
            let totalKeywords = 0;

            for (const file of files) {
                const keywords = this.smartVault.get_keywords(file.path);
                if (keywords && Array.isArray(keywords) && keywords.length > 0) {
                    keywordsObj[file.path] = {
                        keywords: keywords,
                        mtime: file.stat.mtime
                    };
                    this.smartVault.mark_keyword_processed(file.path, file.stat.mtime);
                    totalKeywords += keywords.length;
                }
            }

            const keywordsJson = JSON.stringify(keywordsObj, null, 2);
            await adapter.write(keywordsPath, keywordsJson);

            if (this.debugMode) {
                console.debug(`[DEBUG] Saved ${Object.keys(keywordsObj).length} files with ${totalKeywords} total keywords to disk`);
            }
        } catch (error) {
            console.error('Error saving keywords cache:', error);
        }
    }

    // Suggestions cache
    async loadSuggestions(suggestionView: LinkSuggestionView | null) {
        if (!suggestionView) {
            if (this.debugMode) {
                console.debug('[DEBUG] loadSuggestions: No suggestionView provided');
            }
            return;
        }

        try {
            const suggestionsPath = this.getSuggestionsPath();
            const adapter = this.app.vault.adapter;

            if (this.debugMode) {
                console.debug(`[DEBUG] loadSuggestions: Checking for cache at ${suggestionsPath}`);
            }

            // @ts-ignore
            const exists = await adapter.exists(suggestionsPath);
            if (!exists) {
                if (this.debugMode) {
                    console.debug('[DEBUG] loadSuggestions: No suggestions cache found at path');
                }
                return;
            }

            if (this.debugMode) {
                console.debug('[DEBUG] loadSuggestions: Cache file exists, reading...');
            }
            const suggestionsJson = await adapter.read(suggestionsPath);
            if (this.debugMode) {
                console.debug(`[DEBUG] loadSuggestions: Read ${suggestionsJson.length} chars, parsing JSON...`);
            }

            const parsed: SuggestionCache = JSON.parse(suggestionsJson);
            if (this.debugMode) {
                console.debug(`[DEBUG] loadSuggestions: Parsed ${Object.keys(parsed).length} files from JSON`);
            }

            let totalSuggestions = 0;
            for (const [path, suggestions] of Object.entries(parsed)) {
                suggestionView.allDocumentSuggestions.set(path, suggestions);
                totalSuggestions += suggestions.length;
            }

            if (this.debugMode) {
                console.debug(`[DEBUG] ✅ Loaded ${Object.keys(parsed).length} files from suggestions cache (${totalSuggestions} total suggestions)`);
            }
        } catch (error) {
            console.error('[ERROR] Error loading suggestions cache:', error);
        }
    }

    async saveSuggestions(suggestionView: LinkSuggestionView | null) {
        if (!suggestionView) {
            if (this.debugMode) {
                console.debug('[DEBUG] saveSuggestions: No suggestionView, returning early');
            }
            return;
        }

        try {
            const suggestionsPath = this.getSuggestionsPath();
            const adapter = this.app.vault.adapter;

            const suggestionsObj: SuggestionCache = {};
            let totalSuggestions = 0;
            for (const [path, suggestions] of suggestionView.allDocumentSuggestions) {
                suggestionsObj[path] = suggestions;
                totalSuggestions += suggestions.length;
            }

            if (this.debugMode) {
                console.debug(`[DEBUG] saveSuggestions: Converting ${suggestionView.allDocumentSuggestions.size} files (${totalSuggestions} total suggestions) to JSON`);
            }

            const suggestionsJson = JSON.stringify(suggestionsObj, null, 2);
            if (this.debugMode) {
                console.debug(`[DEBUG] saveSuggestions: Writing to ${suggestionsPath}`);
            }
            await adapter.write(suggestionsPath, suggestionsJson);

            if (this.debugMode) {
                console.debug(`[DEBUG] Saved ${Object.keys(suggestionsObj).length} files with ${totalSuggestions} total suggestions to disk`);
            }
        } catch (error) {
            console.error('Error saving suggestions cache:', error);
        }
    }

    /**
     * Clear all caches (embeddings, keywords, suggestions, insertions)
     */
    async clearAllCaches() {
        const notice = new Notice('Clearing all caches...', 0);
        try {
            // First clear in memory
            this.smartVault.clear_all_caches();

            // Then clear files
            await this.clearEmbeddings();

            notice.setMessage('Caches cleared successfully');
            setTimeout(() => notice.hide(), 2000);
        } catch (error) {
            notice.hide();
            console.error('Error clearing all caches:', error);
            new Notice('Failed to clear caches');
        }
    }

    // ============================================================
    // Insertion cache (now delegated to Rust)
    // ============================================================

    async loadInsertionCache() {
        // Insertion cache is now part of the unified cache index
        // Migration happens in loadCacheIndex()
        if (this.debugMode) {
            console.debug('[DEBUG] Insertion cache is now managed by Rust CacheIndex');
        }
        await Promise.resolve();
    }

    saveInsertionCache() {
        // Insertion cache is now part of the unified cache index
        this.saveCacheIndex();
    }

    getCachedInsertion(filePath: string, linkTitle: string): import('./types').InsertionResult | null {
        try {
            const resultJson = this.smartVault.get_cached_insertion(filePath, linkTitle);
            if (resultJson) {
                return JSON.parse(resultJson);
            }
        } catch {
            // Silently fail, not a critical cache
        }
        return null;
    }

    cacheInsertion(filePath: string, linkTitle: string, result: import('./types').InsertionResult) {
        try {
            const resultJson = JSON.stringify(result);
            this.smartVault.cache_insertion(filePath, linkTitle, resultJson);
            this.saveCacheIndex();
        } catch {
            // Silently fail
        }
    }

    invalidateInsertionCacheForFile(filePath: string): number {
        const count = this.smartVault.invalidate_insertion_cache_for_file(filePath);
        this.saveCacheIndex();
        return count;
    }

    clearInsertionCache() {
        this.smartVault.clear_insertion_cache();
        this.saveCacheIndex();
    }

    // ============================================================
    // Ignored suggestions (now delegated to Rust)
    // ============================================================

    async loadIgnoredSuggestions() {
        // Ignored suggestions are now part of the unified cache index
        // Migration happens in loadCacheIndex()
        if (this.debugMode) {
            console.debug('[DEBUG] Ignored suggestions are now managed by Rust CacheIndex');
        }
        await Promise.resolve();
    }

    saveIgnoredSuggestions() {
        // Ignored suggestions are now part of the unified cache index
        this.saveCacheIndex();
    }

    isIgnored(sourceFile: string, targetFile: string): boolean {
        return this.smartVault.is_suggestion_ignored(sourceFile, targetFile);
    }

    ignoreSuggestion(sourceFile: string, targetFile: string) {
        this.smartVault.ignore_suggestion(sourceFile, targetFile);
        this.saveCacheIndex();
    }

    unignoreSuggestion(sourceFile: string, targetFile: string) {
        this.smartVault.unignore_suggestion(sourceFile, targetFile);
        this.saveCacheIndex();
    }

    getIgnoredSuggestions(): Array<{ sourceFile: string; targetFile: string; timestamp: number }> {
        const ignored = this.smartVault.get_ignored_suggestions();
        if (!ignored || !Array.isArray(ignored)) {
            return [];
        }
        // The Rust function returns objects with source_file, target_file, timestamp
        // Map to the expected TypeScript format
        return ignored.map((item: { source_file: string; target_file: string; timestamp: number }) => ({
            sourceFile: item.source_file,
            targetFile: item.target_file,
            timestamp: item.timestamp
        }));
    }

    clearIgnoredSuggestions() {
        this.smartVault.clear_ignored_suggestions();
        this.saveCacheIndex();
    }

    // ============================================================
    // Offline Backup / Export
    // ============================================================

    async exportCache() {

        // Since we cannot easily get absolute path of vault root depending on adapter,
        // we'll just write to the root of the vault with a fixed name.
        const targetPath = 'smart-vault-export.json';

        try {
            if (this.debugMode) {
                console.debug('[DEBUG] Exporting vector cache to JSON...');
            }
            const jsonString = this.smartVault.serialize_embeddings();

            // Add metadata wrapper? Or just raw map?
            // The WASM method returns just the map {path: [vector]}.
            // Better to wrap it for future proofing if we add import later.
            // But deserialize_embeddings expects the raw map. 
            // So for now, let's keep it compatible with deserialize_embeddings.

            await this.app.vault.adapter.write(targetPath, jsonString);

            // Also export suggestions for completeness?
            // For now, just embeddings is the expensive part.

            if (this.debugMode) {
                console.debug(`[DEBUG] Successfully exported cache to ${targetPath}`);
            }
            return targetPath;
        } catch (error) {
            console.error('Error exporting cache:', error);
            throw error;
        }
    }

    async importCache() {
        const importPath = 'smart-vault-export.json';

        try {
            const adapter = this.app.vault.adapter;
            // @ts-ignore
            const exists = await adapter.exists(importPath);
            if (!exists) {
                throw new Error(`Import file "${importPath}" not found in vault root.`);
            }

            console.debug(`[DEBUG] Importing vector cache from ${importPath}...`);
            // @ts-ignore
            const jsonString = await adapter.read(importPath);

            // Calls WASM deserialize (JSON format)
            this.smartVault.deserialize_embeddings(jsonString);

            // Immediately save to binary format for performance
            this.saveEmbeddings();

            const count = this.smartVault.get_embedding_count();
            console.debug(`[DEBUG] Successfully imported ${count} embeddings from ${importPath}`);
            return count;
        } catch (error) {
            console.error('Error importing cache:', error);
            throw error;
        }
    }
}
