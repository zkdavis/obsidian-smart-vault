export interface KeywordCacheEntry {
    keywords: string[];
    mtime: number;
}

export interface KeywordCache {
    [path: string]: KeywordCacheEntry | string[]; // Support legacy array format
}

export interface SuggestionCache {
    [path: string]: any[];
}

export interface InsertionCache {
    [key: string]: any;
}

export interface IgnoredSuggestionsCache {
    // Key: "sourceFile|targetFile" (e.g., "note1.md|note2.md")
    // Value: timestamp when ignored
    [key: string]: number;
}
