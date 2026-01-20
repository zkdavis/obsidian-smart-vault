/**
 * Global constants for Smart Vault Organizer
 */
export const CONSTANTS = {
    /** Delay before loading suggestions on startup to ensure Obsidian is ready */
    STARTUP_DELAY_MS: 1000,

    /** Delay before starting initial scan if no embeddings found */
    INITIAL_SCAN_DELAY_MS: 2000,

    /** Debounce time for file-open events to prevent duplicate processing */
    FILE_OPEN_DEBOUNCE_MS: 500,

    /** Debounce time for file modification events */
    FILE_MODIFICATION_DEBOUNCE_MS: 2000,

    /** Number of top results to retrieve for MOC generation */
    MOC_TOP_K: 50,

    /** Minimum similarity threshold for MOC generation context */
    MOC_SIMILARITY_THRESHOLD: 0.35,

    /** Backoff delay when LLM reranking fails */
    LLM_RETRY_DELAY_MS: 2000,

    /** Default threshold for General RAG search */
    RAG_THRESHOLD_GENERAL: 0.85,

    /** Default threshold for Vault RAG search */
    RAG_THRESHOLD_VAULT: 0.5,

    /** Default temperature for Chat */
    CHAT_TEMPERATURE: 0.7,

    /** Number of recent files to fetch for context */
    CHAT_RECENT_FILES_COUNT: 15,

    /** Default temperature for Smart Insert actions */
    SMART_INSERT_TEMPERATURE: 0.7,

    /** Max characters for total context window */
    CHAT_CONTEXT_LIMIT_TOTAL: 12000,

    /** Max characters per RAG retrieved note */
    CHAT_CONTEXT_LIMIT_RAG_NOTE: 1000,

    /** Max characters for Daily Note context */
    CHAT_CONTEXT_LIMIT_DAILY_NOTE: 3000,

    /** Max characters for Cross-Link analysis context */
    CHAT_CONTEXT_LIMIT_CROSS_LINK: 2000,
};
