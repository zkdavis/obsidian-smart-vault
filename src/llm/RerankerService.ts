import { Notice } from 'obsidian';
import { SmartVaultSettings } from '../settings/types';
import { CONSTANTS } from '../constants';
import type { LLMRerankedSuggestion } from './types';

/**
 * Result of LLM reranking operation.
 * Includes both the suggestions and metadata about the operation.
 */
export interface RerankerResult {
    suggestions: LLMRerankedSuggestion[];
    llmFailed: boolean;
    failureReason?: string;
}

/**
 * Service responsible for generating embeddings and reranking suggestions using LLM.
 * Handles all interactions with the Ollama API for embedding generation and LLM-based reranking.
 */
export class RerankerService {
    private wasmModule: any;
    private settings: SmartVaultSettings;
    // Track in-flight LLM reranking requests to prevent duplicate calls
    private pendingRerankRequests: Map<string, Promise<RerankerResult>> = new Map();
    // Cache recent LLM reranking results (cleared on embedding change)
    private rerankCache: Map<string, { result: RerankerResult; timestamp: number }> = new Map();
    private readonly CACHE_TTL_MS = 60000;  // Cache results for 1 minute

    constructor(wasmModule: any, settings: SmartVaultSettings) {
        this.wasmModule = wasmModule;
        this.settings = settings;
    }

    /**
     * Generate a cache key for reranking requests based on document and candidates.
     */
    private getRerankCacheKey(docPath: string, candidatePaths: string[]): string {
        return `${docPath}:${candidatePaths.sort().join(',')} `;
    }

    /**
     * Clear cached reranking result for a specific document.
     * Called when document content changes.
     */
    clearRerankCache(docPath?: string): void {
        if (docPath) {
            // Clear any cache entries that involve this document
            for (const key of this.rerankCache.keys()) {
                if (key.startsWith(docPath + ':') || key.includes(':' + docPath)) {
                    this.rerankCache.delete(key);
                }
            }
        } else {
            this.rerankCache.clear();
        }
    }

    /**
     * Call LLM reranking with timeout.
     * Returns the reranked results or throws on timeout.
     */
    private async callLLMWithTimeout(
        candidatesJson: string,
        currentDocTitle: string,
        currentDocContent: string,
        timeoutMs: number
    ): Promise<any[]> {
        return await Promise.race([
            this.wasmModule.rerank_suggestions_with_llm(
                this.settings.ollamaEndpoint,
                this.settings.llmModel,
                currentDocTitle,
                currentDocContent,
                candidatesJson,
                this.settings.llmTemperature,
                this.settings.enableThinkingMode,
                this.settings.debugMode
            ),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`LLM reranking timeout after ${timeoutMs} ms`)), timeoutMs)
            )
        ]) as any[];
    }

    /**
     * Generate embedding vector for the given text using Ollama API.
     * @param text - Text content to embed
     * @returns Promise resolving to 768-dimensional embedding vector
     */
    async generateEmbedding(text: string): Promise<number[]> {
        try {
            const embedding = await this.wasmModule.generate_embedding_ollama(
                this.settings.ollamaEndpoint,
                this.settings.embeddingModel,
                text
            );
            return embedding;
        } catch (error) {
            console.error('Embedding generation error:', error);
            throw error;
        }
    }

    /**
     * Rerank link suggestions using LLM reasoning.
     * Takes top N embedding-based candidates and asks LLM to intelligently reorder them
     * based on semantic relevance, providing scores and reasoning for each.
     *
     * Features deduplication to prevent duplicate LLM calls:
     * - Returns cached results if available and fresh
     * - Returns pending promise if same request is already in-flight
     *
     * @param currentDocTitle - Title of the current document
     * @param currentDocContent - Full content of current document
     * @param suggestions - Array of candidate suggestions from embedding similarity
     * @param docPath - Path to the current document (for cache key)
     * @returns Promise resolving to RerankerResult with suggestions and failure status
     */
    async rerankSuggestionsWithLLM(
        currentDocTitle: string,
        currentDocContent: string,
        suggestions: LLMRerankedSuggestion[],
        docPath?: string,
        forceRefresh: boolean = false
    ): Promise<RerankerResult> {
        if (!this.settings.useLLMReranking || suggestions.length === 0) {
            if (this.settings.debugMode) {
                console.log(`[DEBUG] Skipping LLM reranking(enabled: ${this.settings.useLLMReranking}, suggestions: ${suggestions.length})`);
            }
            return { suggestions, llmFailed: false };
        }

        // Generate cache key based on document and candidate paths
        const candidatePaths = suggestions.slice(0, this.settings.llmCandidateCount).map(s => s.path);
        const cacheKey = docPath ? this.getRerankCacheKey(docPath, candidatePaths) : null;

        // Check cache first (unless forceRefresh is true)
        if (cacheKey && !forceRefresh) {
            const cached = this.rerankCache.get(cacheKey);
            if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL_MS) {
                if (this.settings.debugMode) {
                    console.log(`[DEBUG] Using cached LLM reranking result for ${docPath}(age: ${Date.now() - cached.timestamp}ms)`);
                }
                return cached.result;
            }

            // Check if request is already in-flight
            const pending = this.pendingRerankRequests.get(cacheKey);
            if (pending) {
                if (this.settings.debugMode) {
                    console.log(`[DEBUG] Waiting for in -flight LLM reranking request for ${docPath}`);
                }
                return pending;
            }
        }

        // Create the actual reranking promise
        const rerankPromise = this.doRerankSuggestionsWithLLM(
            currentDocTitle,
            currentDocContent,
            suggestions,
            cacheKey
        );

        // Track in-flight request
        if (cacheKey) {
            this.pendingRerankRequests.set(cacheKey, rerankPromise);
        }

        return rerankPromise;
    }

    /**
     * Try to get cached reranking result without triggering a new LLM call.
     * Useful for manual mode "Refresh" where we want to show existing AI insights if available,
     * but fall back to fast vector search if not.
     */
    getCachedRerank(
        suggestions: LLMRerankedSuggestion[],
        docPath?: string
    ): RerankerResult | null {
        if (!this.settings.useLLMReranking || suggestions.length === 0) {
            return null;
        }

        const candidatePaths = suggestions.slice(0, this.settings.llmCandidateCount).map(s => s.path);
        const cacheKey = docPath ? this.getRerankCacheKey(docPath, candidatePaths) : null;

        if (cacheKey) {
            const cached = this.rerankCache.get(cacheKey);
            if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL_MS) {
                if (this.settings.debugMode) {
                    console.log(`[DEBUG] Found cached LLM result for ${docPath} (Manual Mode Refresh)`);
                }
                return cached.result;
            }
        }
        return null;
    }

    /**
     * Internal implementation of LLM reranking.
     */
    private async doRerankSuggestionsWithLLM(
        currentDocTitle: string,
        currentDocContent: string,
        suggestions: LLMRerankedSuggestion[],
        cacheKey: string | null
    ): Promise<RerankerResult> {
        try {
            // Take top N candidates for LLM reranking, keep the rest as embedding-only
            const llmCandidates = suggestions.slice(0, this.settings.llmCandidateCount);
            const embeddingOnlyCandidates = suggestions.slice(this.settings.llmCandidateCount);

            if (this.settings.debugMode) {
                console.log(`[DEBUG] llmCandidateCount setting: ${this.settings.llmCandidateCount}, total suggestions: ${suggestions.length} `);
                console.log(`[DEBUG] Preparing ${llmCandidates.length} candidates for LLM reranking, ${embeddingOnlyCandidates.length} embedding - only`);
                console.log(`[DEBUG] Document: "${currentDocTitle}", content length: ${currentDocContent.length} chars`);
            }

            // Convert to JSON for WASM
            const candidatesJson = JSON.stringify(llmCandidates);

            if (this.settings.debugMode) {
                console.log(`[DEBUG] Candidates JSON length: ${candidatesJson.length} chars`);
            }

            if (this.settings.debugMode) {
                console.log(`Reranking ${llmCandidates.length} suggestions with LLM...`);
            }

            // Add timeout with retry logic to prevent scan from hanging indefinitely
            const timeoutMs = this.settings.llmTimeout || 15000;
            let reranked: any[];

            // Try up to 2 times before giving up
            for (let attempt = 1; attempt <= 2; attempt++) {
                try {
                    reranked = await this.callLLMWithTimeout(
                        candidatesJson,
                        currentDocTitle,
                        currentDocContent,
                        timeoutMs
                    );
                    // Success - break out of retry loop
                    break;
                } catch (error: any) {
                    if (attempt === 1) {
                        // First failure - wait with backoff before retry to let LLM recover
                        if (this.settings.debugMode) {
                            console.log(`[DEBUG] LLM reranking attempt ${attempt} failed: ${error.message}. Waiting ${CONSTANTS.LLM_RETRY_DELAY_MS}ms before retry...`);
                        }
                        await new Promise(resolve => setTimeout(resolve, CONSTANTS.LLM_RETRY_DELAY_MS));
                    } else {
                        // Second failure - will show visual warning on page
                        if (this.settings.debugMode) {
                            console.log(`[DEBUG] LLM reranking attempt ${attempt} failed: ${error.message}. Giving up.`);
                        }
                        throw error; // Re-throw to trigger fallback with llmFailed flag
                    }
                }
            }

            if (this.settings.debugMode) {
                console.log(`LLM reranking complete.Got ${reranked!.length} results.`);
            }

            // Append embedding-only candidates (those beyond llmCandidateCount)
            // But also recover any candidates sent to LLM but NOT returned (LLM might have skipped them)
            const allResults = [...reranked!];
            const returnedPaths = new Set(reranked!.map(r => r.path));

            // Find candidates that were sent to LLM but not returned
            const missingLLMCandidates = llmCandidates.filter(c => !returnedPaths.has(c.path));

            if (this.settings.debugMode && missingLLMCandidates.length > 0) {
                console.log(`[DEBUG] Recovering ${missingLLMCandidates.length} candidates dropped by LLM:`, missingLLMCandidates.map(c => c.title));
            }

            // Append missing LLM candidates (demoted below explicit LLM results)
            for (const candidate of missingLLMCandidates) {
                allResults.push({
                    path: candidate.path,
                    title: candidate.title,
                    similarity: candidate.similarity,
                    context: candidate.context,
                    // No llm_score - implicitly lower rank than those with scores
                });
            }

            // Append the rest of valid embedding candidates
            for (const candidate of embeddingOnlyCandidates) {
                // Double check we haven't already included it (just in case of overlap)
                if (!returnedPaths.has(candidate.path)) {
                    allResults.push({
                        path: candidate.path,
                        title: candidate.title,
                        similarity: candidate.similarity,
                        context: candidate.context,
                        // No llm_score or llm_reason - these are embedding-only
                    });
                }
            }

            if (this.settings.debugMode) {
                console.log(`[DEBUG] Total results: ${allResults.length} (${reranked!.length} LLM - ranked, ${embeddingOnlyCandidates.length} embedding - only)`);
                console.log(`[DEBUG] Reranked results: `, allResults);
            }

            const result: RerankerResult = { suggestions: allResults, llmFailed: false };

            // Cache successful result
            if (cacheKey) {
                this.rerankCache.set(cacheKey, { result, timestamp: Date.now() });
            }

            return result;
        } catch (error: any) {
            // LLM reranking failed - fall back to embedding-only suggestions
            // This is expected when the LLM doesn't return valid JSON array format
            if (this.settings.debugMode) {
                console.log(`[DEBUG] LLM reranking failed for ${suggestions.length} candidates - using embedding - only ranking`);
                console.log('[DEBUG] Error:', error);
            }
            // Fallback to original suggestions on error with failure flag
            return {
                suggestions,
                llmFailed: true,
                failureReason: error.message || 'LLM reranking failed'
            };
        } finally {
            // Always clean up pending request tracker
            if (cacheKey) {
                this.pendingRerankRequests.delete(cacheKey);
            }
        }
    }

    /**
     * Update the settings reference used by this service.
     * Called when user changes settings in the settings tab.
     */
    updateSettings(settings: SmartVaultSettings): void {
        this.settings = settings;
    }
}
