import type { App, TFile } from 'obsidian';
import type { SmartVaultSettings } from '../../settings/types';
import type { RerankerService } from '../../llm/RerankerService';
import { truncateContent } from '../../utils/content';
import * as wasmNamespace from '../../../pkg/obsidian_smart_vault';
import type { LinkSuggestionView } from '../../ui/LinkSuggestionView';

/**
 * Service responsible for processing individual files in the vault.
 * Handles single file operations like refreshing, embedding generation,
 * and suggestion generation for specific files.
 */
export class FileProcessor {
    private app: App;
    private smartVault: wasmNamespace.SmartVault;
    public rerankerService: RerankerService;
    private settings: SmartVaultSettings;
    private suggestionView: LinkSuggestionView | null;

    constructor(
        app: App,
        smartVault: wasmNamespace.SmartVault,
        rerankerService: RerankerService,
        settings: SmartVaultSettings,
        suggestionView: LinkSuggestionView | null
    ) {
        this.app = app;
        this.smartVault = smartVault;
        this.rerankerService = rerankerService;
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
     * Refresh a single document: regenerate embedding and suggestions.
     *
     * @param file - The file to refresh
     * @param saveEmbeddings - Callback to save embeddings after update
     * @returns Promise resolving to the new suggestions
     */
    async refreshDocument(
        file: TFile,
        saveEmbeddings: () => Promise<void>
    ): Promise<import('../../ui/LinkSuggestionView').LinkSuggestion[]> {
        if (this.settings.debugMode) {
            console.debug(`[DEBUG] Refresh requested for: ${file.path}`);
        }

        const content = await this.app.vault.read(file);

        if (this.settings.debugMode) {
            console.debug(`[DEBUG] Read file content, length: ${content.length}`);
        }

        // Truncate content if too long for embedding
        const truncatedContent = truncateContent(content, this.settings.maxContentLength);

        // Update file content
        this.smartVault.add_file(file.path, content);

        if (this.settings.debugMode) {
            console.debug(`[DEBUG] Generating new embedding...`);
        }

        // Regenerate embedding
        const embedding = await this.rerankerService.generateEmbedding(truncatedContent);
        this.smartVault.set_embedding(file.path, new Float32Array(embedding));

        if (this.settings.debugMode) {
            console.debug(`[DEBUG] Embedding generated, saving...`);
        }

        // Save embeddings to disk
        await saveEmbeddings();

        if (this.settings.debugMode) {
            console.debug(`[DEBUG] Generating suggestions...`);
        }

        // Generate suggestions with LLM reranking if enabled
        // Respect manualLLMRerank setting for automatic refreshes
        const skipLLM = this.settings.manualLLMRerank;
        const suggestions = await this.getSuggestionsForFile(file, content, embedding, skipLLM);

        if (this.settings.debugMode) {
            console.debug(`[DEBUG] Got ${suggestions.length} suggestions, updating view...`);
        }

        // Update suggestion view
        if (this.suggestionView) {
            this.suggestionView.allDocumentSuggestions.set(file.path, suggestions);
            await this.suggestionView.updateForFile(file);
        }

        if (this.settings.debugMode) {
            console.debug(`[DEBUG] Refresh complete!`);
        }

        return suggestions;
    }

    /**
     * Generate link suggestions for a specific file.
     * First gets embedding-based suggestions, then optionally reranks with LLM.
     *
     * @param file - The file to generate suggestions for
     * @param content - File content
     * @param embedding - File's embedding vector
     * @returns Promise resolving to array of suggestions
     */
    async getSuggestionsForFile(
        file: TFile,
        content: string,
        embedding: number[],
        skipLLM: boolean = false,
        forceLLMRefresh: boolean = false
    ): Promise<import('../../ui/LinkSuggestionView').LinkSuggestion[]> {
        if (this.settings.debugMode) {
            console.debug(`[DEBUG] getSuggestionsForFile: ${file.path}`);
        }

        // Get initial suggestions from embeddings (already filters self-links in Rust)
        let suggestions = this.smartVault.suggest_links_for_text(
            content,
            new Float32Array(embedding),
            this.settings.similarityThreshold,
            file.path,  // Current file to exclude
            20  // Top 20 candidates for LLM reranking
        );

        if (this.settings.debugMode) {
            console.debug(`[DEBUG] Embedding-based suggestions: ${suggestions.length} found`);
        }

        // Optionally rerank with LLM or check cache
        if (this.settings.useLLMReranking && suggestions.length > 0) {
            if (!skipLLM) {
                // Auto mode or explicit rerank: Run LLM (checks cache internally unless forced)
                if (this.settings.debugMode) {
                    console.debug(`[DEBUG] LLM reranking enabled, processing ${suggestions.length} suggestions (force: ${forceLLMRefresh})`);
                }
                const result = await this.rerankerService.rerankSuggestionsWithLLM(
                    file.basename,
                    content,
                    suggestions,
                    file.path,  // Pass doc path for cache key
                    forceLLMRefresh
                );
                suggestions = result.suggestions;

                // Track LLM failures in the view for visual warning
                if (this.suggestionView && result.llmFailed) {
                    this.suggestionView.llmFailedDocuments.set(file.path, result.failureReason || 'LLM reranking failed');
                } else if (this.suggestionView) {
                    // Clear any previous failure for this document
                    this.suggestionView.llmFailedDocuments.delete(file.path);
                }
            } else {
                // Manual mode (skipLLM=true): Try to use CACHED LLM scores if available
                // This allows "Refresh" (Vector only) to preserve AI scores if we already paid for them
                const cachedResult = this.rerankerService.getCachedRerank(suggestions, file.path);
                if (cachedResult) {
                    if (this.settings.debugMode) {
                        console.debug(`[DEBUG] Manual Mode: Using cached LLM scores for ${file.path}`);
                    }
                    suggestions = cachedResult.suggestions;
                }
            }
        }

        if (this.settings.debugMode) {
            console.debug(`[DEBUG] Final suggestions count: ${suggestions.length}`);
        }

        return suggestions;
    }

    /**
     * Generate suggestions for the currently active note.
     *
     * @param file - The active file
     * @returns Promise resolving to array of suggestions
     */
    async suggestLinksForCurrentNote(file: TFile): Promise<import('../../ui/LinkSuggestionView').LinkSuggestion[]> {
        const content = await this.app.vault.read(file);
        const truncatedContent = truncateContent(content, this.settings.maxContentLength);
        const embedding = await this.rerankerService.generateEmbedding(truncatedContent);

        // Respect Manual Rerank setting: if True, skip new LLM calls (but allow cached ones via getSuggestionsForFile logic)
        const skipLLM = this.settings.manualLLMRerank;
        const suggestions = await this.getSuggestionsForFile(file, content, embedding, skipLLM);

        if (this.suggestionView) {
            this.suggestionView.setSuggestions(suggestions, file);
        }

        return suggestions;
    }

    /**
     * Generate suggestions for all files in the vault that have embeddings.
     * Used for batch pre-computing suggestions.
     *
     * @returns Promise resolving when all suggestions are generated
     */
    async generateAllSuggestions(): Promise<void> {
        if (!this.suggestionView) return;

        try {
            const files = this.app.vault.getMarkdownFiles();
            let processedCount = 0;
            let suggestionsCount = 0;

            // First pass: count files that need processing
            const filesToProcess: typeof files = [];
            for (const file of files) {
                if (!this.smartVault.has_embedding(file.path)) {
                    continue;
                }

                const cached = this.suggestionView.allDocumentSuggestions.get(file.path);
                if (cached !== undefined) {
                    const hasLLMScores = cached.some((s: import('../../ui/LinkSuggestionView').LinkSuggestion) => s.llm_score !== undefined);
                    if (cached.length === 0 || hasLLMScores || !this.settings.useLLMReranking) {
                        continue;
                    }
                }
                filesToProcess.push(file);
            }

            // Start scanning indicator if there are files to process
            if (filesToProcess.length > 0 && this.settings.useLLMReranking) {
                this.suggestionView.startLLMScanning(filesToProcess.length);
            }

            for (const file of filesToProcess) {
                try {
                    if (this.settings.debugMode) {
                        const cached = this.suggestionView.allDocumentSuggestions.get(file.path);
                        if (cached !== undefined) {
                            console.debug(`[DEBUG] Regenerating ${file.path} - has ${cached.length} suggestions but no LLM scores`);
                        }
                    }

                    const content = await this.app.vault.read(file);

                    // Use existing embedding instead of regenerating
                    const embedding = this.smartVault.get_embedding(file.path);

                    const suggestions = await this.getSuggestionsForFile(
                        file,
                        content,
                        Array.from(embedding),
                        this.settings.manualLLMRerank
                    );

                    // Cache ALL results, even empty ones, so we know the file has been processed
                    this.suggestionView.allDocumentSuggestions.set(file.path, suggestions);
                    suggestionsCount += suggestions.length;
                    processedCount++;

                    // Update progress indicator
                    if (this.settings.useLLMReranking) {
                        this.suggestionView.updateLLMScanningProgress(processedCount);
                    }
                } catch (error) {
                    // Silently skip files that error
                    if (this.settings.debugMode) {
                        console.debug(`[DEBUG] Error generating suggestions for ${file.path}:`, error);
                    }
                    processedCount++;  // Still count for progress
                    if (this.settings.useLLMReranking) {
                        this.suggestionView.updateLLMScanningProgress(processedCount);
                    }
                }
            }

            // Stop scanning indicator
            if (filesToProcess.length > 0 && this.settings.useLLMReranking) {
                this.suggestionView.stopLLMScanning();
            }

            if (this.settings.debugMode) {
                console.debug(`[DEBUG] Generated suggestions for ${processedCount} files with embeddings (${suggestionsCount} total suggestions)`);
            }
        } catch (error) {
            console.error('Error generating all suggestions:', error);
            // Make sure to stop indicator on error
            if (this.suggestionView) {
                this.suggestionView.stopLLMScanning();
            }
        }
    }
}
