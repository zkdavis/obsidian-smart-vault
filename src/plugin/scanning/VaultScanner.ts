import type { App, TFile, Notice } from 'obsidian';
import type { SmartVaultSettings } from '../../settings/types';
import type { RerankerService } from '../../llm/RerankerService';
import type { CacheManager } from '../cache/CacheManager';
import type { FileProcessor } from './FileProcessor';
import { truncateContent } from '../../utils/content';
import * as wasmNamespace from '../../../pkg/obsidian_smart_vault';
import type { LinkSuggestionView } from '../../ui/LinkSuggestionView';

/**
 * Represents a file in the scan plan
 */
interface FileToProcess {
    path: string;
    mtime: number;
    needs_embedding: boolean;
    needs_keywords: boolean;
    needs_suggestions: boolean;
}

/**
 * Result of Rust scan planning
 */
interface ScanPlan {
    to_process: FileToProcess[];
    to_skip: string[];
    current_file_index: number | null;
}

/**
 * Service responsible for orchestrating vault-wide scanning operations.
 * Uses Rust for scan planning decisions and mtime tracking.
 * Handles batch processing, concurrency control, progress tracking,
 * and coordination between file processing and cache management.
 */
export class VaultScanner {
    private app: App;
    private smartVault: wasmNamespace.SmartVault;
    private wasmModule: typeof wasmNamespace;
    private rerankerService: RerankerService;
    private cacheManager: CacheManager;
    private fileProcessor: FileProcessor;
    private settings: SmartVaultSettings;
    private suggestionView: LinkSuggestionView | null;

    constructor(
        app: App,
        smartVault: wasmNamespace.SmartVault,
        wasmModule: typeof wasmNamespace,
        rerankerService: RerankerService,
        cacheManager: CacheManager,
        fileProcessor: FileProcessor,
        settings: SmartVaultSettings,
        suggestionView: LinkSuggestionView | null,
        // Kept for backward compatibility but no longer used
        _fileModificationTimes: Map<string, number>
    ) {
        this.app = app;
        this.smartVault = smartVault;
        this.wasmModule = wasmModule;
        this.rerankerService = rerankerService;
        this.cacheManager = cacheManager;
        this.fileProcessor = fileProcessor;
        this.settings = settings;
        this.suggestionView = suggestionView;
    }

    /**
     * Update the settings reference used by this service.
     */
    updateSettings(settings: SmartVaultSettings): void {
        this.settings = settings;
    }

    /**
     * Update the suggestion view reference.
     */
    updateSuggestionView(suggestionView: LinkSuggestionView | null): void {
        this.suggestionView = suggestionView;
    }

    /**
     * Scan the entire vault, generating embeddings and suggestions for all files.
     * Uses Rust for scan planning to determine which files need processing.
     * Processes files in parallel batches with smart prioritization (current file first).
     *
     * @param notice - Notice object for progress updates
     * @returns Promise resolving to completion message
     */
    async scanVault(notice: Notice): Promise<string> {
        if (this.settings.debugMode) {
            console.debug('[DEBUG] Starting vault scan');
        }

        const allFiles = this.app.vault.getMarkdownFiles();

        // Apply folder filter if configured
        const files = this.settings.debugFolderFilter
            ? allFiles.filter(file => file.path.startsWith(this.settings.debugFolderFilter))
            : allFiles;

        const currentFile = this.app.workspace.getActiveFile();
        let processed = 0;
        let skipped = 0;
        let skippedUnchanged = 0;
        let newEmbeddings = 0;

        if (this.settings.debugMode) {
            const filterMsg = this.settings.debugFolderFilter
                ? ` (filtered to ${this.settings.debugFolderFilter} only)`
                : '';
            console.debug(`[DEBUG] Found ${files.length} markdown files to scan${filterMsg}`);
        }

        // Use Rust scan planning for optimized file ordering and filtering
        const filesJson = JSON.stringify(files.map(f => ({
            path: f.path,
            mtime: f.stat.mtime
        })));

        const scanPlan: ScanPlan = this.smartVault.plan_scan(
            filesJson,
            currentFile?.path || null,
            true  // check_suggestions
        );

        if (!scanPlan || !scanPlan.to_process) {
            console.error('[ERROR] Rust scan planning failed');
            // Fallback to basic sorting
            return this.scanVaultLegacy(notice, files, currentFile);
        }

        skippedUnchanged = scanPlan.to_skip.length;

        if (this.settings.debugMode) {
            console.debug(`[DEBUG] Scan plan: ${scanPlan.to_process.length} to process, ${scanPlan.to_skip.length} unchanged`);
            if (scanPlan.current_file_index !== null) {
                console.debug(`[DEBUG] Current file index: ${scanPlan.current_file_index}`);
            }
            console.debug(`[DEBUG] Using concurrency: ${this.settings.llmConcurrency} parallel LLM requests`);
        }

        // Convert plan to TFile array
        const filesToProcess: TFile[] = [];
        const fileMap = new Map(files.map(f => [f.path, f]));
        for (const item of scanPlan.to_process) {
            const file = fileMap.get(item.path);
            if (file) {
                filesToProcess.push(file);
            }
        }

        // Process files in parallel batches
        const batchSize = this.settings.llmConcurrency;

        for (let i = 0; i < filesToProcess.length; i += batchSize) {
            const batch = filesToProcess.slice(i, i + batchSize);

            // Process batch in parallel
            const results = await Promise.allSettled(
                batch.map(file => this.processFile(file, currentFile))
            );

            // Count results and update UI after each batch completes
            for (let j = 0; j < results.length; j++) {
                const result = results[j];
                const file = batch[j];
                if (result.status === 'rejected') {
                    // Log error with file path for debugging
                    console.error(`[ERROR] Failed to process file "${file.path}":`, result.reason);
                    if (this.settings.debugMode) {
                        console.debug(`[DEBUG] Error details for ${file.path}:`, {
                            error: result.reason?.message || result.reason,
                            stack: result.reason?.stack
                        });
                    }
                    skipped++;
                    processed++;
                } else {
                    processed++;
                    if (result.value.wasNewEmbedding) {
                        newEmbeddings++;
                    }
                }
            }

            // Update UI after each batch
            const totalFiles = filesToProcess.length + skippedUnchanged;
            notice.setMessage(`Scanning: ${processed + skippedUnchanged}/${totalFiles} files (${newEmbeddings} new)`);

            // Save embeddings periodically (every 3 batches)
            if (Math.floor(i / batchSize) % 3 === 0) {
                await this.cacheManager.saveEmbeddings();
            }
        }

        // Final save
        await this.cacheManager.saveEmbeddings();
        await this.cacheManager.saveKeywords();
        await this.cacheManager.saveSuggestions(this.suggestionView);

        // Refresh the current file's view with all the new embeddings
        if (this.suggestionView && currentFile) {
            if (this.settings.debugMode) {
                console.debug('[DEBUG] Refreshing current file view after scan');
            }
            await this.suggestionView.updateForFile(currentFile);
        }

        notice.hide();
        const totalFiles = filesToProcess.length + skippedUnchanged;
        let message = `Scan complete: ${totalFiles} files, ${newEmbeddings} new embeddings`;
        if (skippedUnchanged > 0) {
            message += `, ${skippedUnchanged} unchanged`;
        }
        if (skipped > 0) {
            message += `, ${skipped} errors`;
        }

        if (this.settings.debugMode) {
            console.debug('[DEBUG] Scan complete');
        }

        // Return the message for the caller to display
        return message;
    }

    /**
     * Legacy scan method (fallback if Rust planning fails)
     */
    private async scanVaultLegacy(notice: Notice, files: TFile[], currentFile: TFile | null): Promise<string> {
        if (this.settings.debugMode) {
            console.debug('[DEBUG] Using legacy scan method');
        }

        // Sort files: current file first, then by modification time (most recent first)
        const sortedFiles = [...files].sort((a, b) => {
            if (currentFile && a.path === currentFile.path) return -1;
            if (currentFile && b.path === currentFile.path) return 1;
            return b.stat.mtime - a.stat.mtime;
        });

        let processed = 0;
        let skipped = 0;
        let newEmbeddings = 0;

        const batchSize = this.settings.llmConcurrency;

        for (let i = 0; i < sortedFiles.length; i += batchSize) {
            const batch = sortedFiles.slice(i, i + batchSize);

            const results = await Promise.allSettled(
                batch.map(file => this.processFile(file, currentFile))
            );

            for (let j = 0; j < results.length; j++) {
                const result = results[j];
                if (result.status === 'rejected') {
                    skipped++;
                } else if (result.value.wasNewEmbedding) {
                    newEmbeddings++;
                }
                processed++;
            }

            notice.setMessage(`Scanning: ${processed}/${files.length} files (${newEmbeddings} new)`);

            if (Math.floor(i / batchSize) % 3 === 0) {
                await this.cacheManager.saveEmbeddings();
            }
        }

        await this.cacheManager.saveEmbeddings();
        await this.cacheManager.saveKeywords();
        await this.cacheManager.saveSuggestions(this.suggestionView);

        if (this.suggestionView && currentFile) {
            await this.suggestionView.updateForFile(currentFile);
        }

        notice.hide();
        return `Scan complete: ${processed} files, ${newEmbeddings} new embeddings, ${skipped} errors`;
    }

    /**
     * Process a single file during vault scan.
     * Uses Rust CacheManager for mtime tracking.
     * Generates embeddings if needed, extracts keywords, and generates suggestions.
     *
     * @param file - File to process
     * @param currentFile - Currently active file (for prioritization)
     * @returns Promise resolving to processing result
     */
    private async processFile(
        file: TFile,
        currentFile: TFile | null
    ): Promise<{ file: TFile; wasNewEmbedding: boolean; suggestionsCount: number }> {
        const currentMtime = file.stat.mtime;

        // Check if file needs processing using Rust cache
        const hasEmbedding = this.smartVault.has_embedding(file.path);
        const embeddingFresh = this.cacheManager.isEmbeddingFresh(file.path, currentMtime);

        // Skip unchanged files if they already have embeddings
        if (hasEmbedding && embeddingFresh) {
            if (this.settings.debugMode) {
                console.debug(`[DEBUG] Skipping unchanged file: ${file.basename}`);
            }
            return { file, wasNewEmbedding: false, suggestionsCount: 0 };
        }

        const content = await this.app.vault.read(file);
        const truncatedContent = truncateContent(content, this.settings.maxContentLength);

        this.smartVault.add_file(file.path, content);

        // Generate embedding if needed
        const needsEmbedding = !hasEmbedding;
        let wasNewEmbedding = false;
        let embedding: number[];

        if (needsEmbedding) {
            embedding = await this.rerankerService.generateEmbedding(truncatedContent);
            this.smartVault.set_embedding(file.path, new Float32Array(embedding));
            this.cacheManager.markEmbeddingProcessed(file.path, currentMtime);
            wasNewEmbedding = true;

            // Extract keywords for better cross-linking
            await this.extractKeywords(file, truncatedContent, currentMtime);
        } else {
            // Reuse existing embedding but update mtime
            const cachedEmb = this.smartVault.get_embedding(file.path);
            embedding = cachedEmb ? Array.from(cachedEmb) : [];
            this.cacheManager.markEmbeddingProcessed(file.path, currentMtime);
        }

        // Generate suggestions immediately for this file
        let suggestions: import('../../ui/LinkSuggestionView').LinkSuggestion[] = [];
        if (this.suggestionView) {
            // Respect Manual Rerank setting during vault scan
            const skipLLM = this.settings.manualLLMRerank;
            suggestions = await this.fileProcessor.getSuggestionsForFile(file, content, embedding, skipLLM);

            if (suggestions.length > 0) {
                this.suggestionView.allDocumentSuggestions.set(file.path, suggestions);
                this.cacheManager.markSuggestionProcessed(file.path, currentMtime);
            }

            // Update view if this is the current file (real-time update)
            if (currentFile && file.path === currentFile.path) {
                if (this.settings.debugMode) {
                    console.debug('[DEBUG] Updating view for current file');
                }
                this.suggestionView.setSuggestions(suggestions, file);
            }
        }

        return { file, wasNewEmbedding, suggestionsCount: suggestions.length };
    }

    /**
     * Extract keywords from file content using LLM.
     * Falls back to title-only keyword if extraction fails.
     *
     * @param file - File to extract keywords from
     * @param truncatedContent - Truncated file content
     * @param mtime - File modification time
     */
    private async extractKeywords(file: TFile, truncatedContent: string, mtime: number): Promise<void> {
        if (this.settings.useKeywordExtraction) {
            try {
                // Add timeout to prevent hanging
                const keywordPromise = this.wasmModule.extract_keywords_with_llm(
                    this.settings.ollamaEndpoint,
                    this.settings.llmModel,
                    file.basename,
                    truncatedContent,
                    this.settings.llmTemperature,
                    this.settings.enableThinkingMode,
                    this.settings.debugMode
                );

                const keywords = await Promise.race([
                    keywordPromise,
                    new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error('Keyword extraction timeout')), this.settings.llmTimeout)
                    )
                ]);

                // ALWAYS include the document title (without .md) as a keyword
                const titleKeyword = file.basename.replace(/\.md$/, '');
                if (!keywords.includes(titleKeyword)) {
                    keywords.unshift(titleKeyword); // Add title at the beginning
                }

                this.smartVault.set_keywords(file.path, keywords);
                this.cacheManager.markKeywordProcessed(file.path, mtime);

                if (this.settings.debugMode) {
                    console.debug(`[DEBUG] Extracted ${keywords.length} keywords for ${file.basename} (including title)`);
                }
            } catch (error) {
                if (this.settings.debugMode) {
                    console.debug(`[DEBUG] Failed to extract keywords for ${file.basename}:`, error);
                }
                // Even if LLM fails, set the title as a keyword
                const titleKeyword = file.basename.replace(/\.md$/, '');
                this.smartVault.set_keywords(file.path, [titleKeyword]);
            }
        } else {
            // If keyword extraction is disabled, still set the title as a keyword
            const titleKeyword = file.basename.replace(/\.md$/, '');
            this.smartVault.set_keywords(file.path, [titleKeyword]);
        }
    }
}
