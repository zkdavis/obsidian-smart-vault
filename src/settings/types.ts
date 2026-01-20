export interface SmartVaultSettings {
    ollamaEndpoint: string;
    embeddingModel: string;
    similarityThreshold: number;
    ragThresholdVault: number; // RAG threshold for Vault Mode
    ragThresholdGeneral: number; // RAG threshold for General Mode
    scanInterval: number;
    autoScanEnabled: boolean;
    maxSuggestions: number;
    maxContentLength: number;
    // LLM reranking settings
    useLLMReranking: boolean;
    manualLLMRerank: boolean;
    llmModel: string;
    chatModel: string;        // Specific model for Chat
    formattingModel: string;  // Specific model for Formatting
    organizationModel: string;// Specific model for Organization
    llmCandidateCount: number;
    llmTemperature: number;
    chatTemperature: number; // Specific temp for Chat (creativity)
    enableSmartInsertion: boolean;
    llmTimeout: number;
    llmConcurrency: number;  // How many LLM requests to run in parallel
    useKeywordExtraction: boolean;  // Extract keywords for better cross-linking
    enableThinkingMode: boolean;  // Enable chain-of-thought reasoning for qwen3/deepseek models
    // Vision
    visionModel: string;
    handwrittenInbox: string;
    transcriptFolder: string;
    handwrittenAttachmentsFolder: string;
    // Debug settings
    debugMode: boolean;
    debugFolderFilter: string;  // Optional folder to filter scanning (e.g., "Wiki/")
    cacheDirectory: string;     // Directory to store cache files (default: .smartvault)

    // Caching
    formattingCache: Record<string, { mtime: number, data: any }>;
    organizationCache: Record<string, { mtime: number, data: any }>;
}

export const DEFAULT_SETTINGS: SmartVaultSettings = {
    ollamaEndpoint: 'http://localhost:11434',
    embeddingModel: 'nomic-embed-text',
    similarityThreshold: 0.7,
    ragThresholdVault: 0.5,
    ragThresholdGeneral: 0.85,
    scanInterval: 30,
    autoScanEnabled: false,
    maxSuggestions: 5,
    maxContentLength: 2000,  // ~500 tokens for nomic-embed-text (2048 token context)
    // LLM reranking defaults
    useLLMReranking: false,
    manualLLMRerank: false,
    llmModel: 'ministral-3:3b',
    chatModel: 'ministral-3:3b',
    formattingModel: 'ministral-3:3b',
    organizationModel: 'ministral-3:3b',
    llmCandidateCount: 5,
    llmTemperature: 0.3,
    chatTemperature: 0.7, // Higher creativity for chat
    enableSmartInsertion: false,
    llmTimeout: 30000,  // 30 seconds default (increase if your LLM is slow)
    llmConcurrency: 3,  // Process 3 files in parallel
    useKeywordExtraction: true,  // Extract keywords for better cross-linking
    enableThinkingMode: false,  // Default off (enable for qwen3/deepseek models)
    // Vision defaults
    visionModel: 'ministral-3:3b',
    handwrittenInbox: 'Inbox/Handwritten',
    transcriptFolder: 'Inbox',
    handwrittenAttachmentsFolder: 'Attachments/Handwritten',
    // Debug defaults
    debugMode: false,
    debugFolderFilter: '',
    cacheDirectory: '_smartvault',
    formattingCache: {},
    organizationCache: {},
};
