export interface LLMRerankedSuggestion {
    path: string;
    title: string;
    similarity: number;
    llm_score?: number;
    llm_reason?: string;
    context: string;
}

export interface LLMInsertionResult {
    phrase: string | null;
    confidence: number;
    reason: string;
}

/**
 * Result from getSuggestionsForFile that includes LLM failure status.
 * Used to track when LLM reranking fails so the UI can show a warning.
 */
export interface SuggestionResult {
    suggestions: LLMRerankedSuggestion[];
    llmFailed: boolean;
    failureReason?: string;
}
