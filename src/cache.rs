use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Cache file format version and metadata
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CacheHeader {
    pub version: u32,
    pub format: String,  // "msgpack" or "json"
    pub created_at: u64,
}

/// Unified cache index for tracking file modification times and ignored suggestions.
/// This provides a single source of truth for cache state management.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct CacheIndex {
    /// File modification times for embeddings (path -> mtime in ms)
    pub embedding_mtimes: HashMap<String, u64>,
    /// File modification times for keywords (path -> mtime in ms)
    pub keyword_mtimes: HashMap<String, u64>,
    /// File modification times for suggestions (path -> mtime in ms)
    pub suggestion_mtimes: HashMap<String, u64>,
    /// Ignored suggestions (key: "source|target" -> timestamp when ignored)
    pub ignored_suggestions: HashMap<String, u64>,
    /// Insertion cache (key: "filepath::linktitle" -> InsertionResult as JSON string)
    pub insertion_cache: HashMap<String, String>,
}

impl CacheIndex {
    pub fn new() -> Self {
        CacheIndex::default()
    }

    /// Check if a file's embedding is fresh (unchanged since last processing)
    pub fn is_embedding_fresh(&self, path: &str, current_mtime: u64) -> bool {
        self.embedding_mtimes.get(path).map_or(false, |&cached| cached == current_mtime)
    }

    /// Check if a file's keywords are fresh
    pub fn is_keyword_fresh(&self, path: &str, current_mtime: u64) -> bool {
        self.keyword_mtimes.get(path).map_or(false, |&cached| cached == current_mtime)
    }

    /// Check if a file's suggestions are fresh
    pub fn is_suggestion_fresh(&self, path: &str, current_mtime: u64) -> bool {
        self.suggestion_mtimes.get(path).map_or(false, |&cached| cached == current_mtime)
    }

    /// Mark a file's embedding as processed with the given mtime
    pub fn mark_embedding_processed(&mut self, path: &str, mtime: u64) {
        self.embedding_mtimes.insert(path.to_string(), mtime);
    }

    /// Mark a file's keywords as processed
    pub fn mark_keyword_processed(&mut self, path: &str, mtime: u64) {
        self.keyword_mtimes.insert(path.to_string(), mtime);
    }

    /// Mark a file's suggestions as processed
    pub fn mark_suggestion_processed(&mut self, path: &str, mtime: u64) {
        self.suggestion_mtimes.insert(path.to_string(), mtime);
    }

    /// Invalidate all caches for a specific file
    pub fn invalidate_file(&mut self, path: &str) {
        self.embedding_mtimes.remove(path);
        self.keyword_mtimes.remove(path);
        self.suggestion_mtimes.remove(path);
        // Also remove insertion cache entries for this file
        let keys_to_remove: Vec<String> = self.insertion_cache.keys()
            .filter(|k| k.starts_with(&format!("{}::", path)))
            .cloned()
            .collect();
        for key in keys_to_remove {
            self.insertion_cache.remove(&key);
        }
    }

    /// Clear all cache data
    pub fn clear(&mut self) {
        self.embedding_mtimes.clear();
        self.keyword_mtimes.clear();
        self.suggestion_mtimes.clear();
        self.ignored_suggestions.clear();
        self.insertion_cache.clear();
    }

    // --- Ignored Suggestions ---

    fn make_ignored_key(source: &str, target: &str) -> String {
        format!("{}|{}", source, target)
    }

    /// Check if a suggestion is ignored
    pub fn is_suggestion_ignored(&self, source_file: &str, target_file: &str) -> bool {
        let key = Self::make_ignored_key(source_file, target_file);
        self.ignored_suggestions.contains_key(&key)
    }

    /// Ignore a suggestion
    pub fn ignore_suggestion(&mut self, source_file: &str, target_file: &str) {
        let key = Self::make_ignored_key(source_file, target_file);
        self.ignored_suggestions.insert(key, js_sys::Date::now() as u64);
    }

    /// Unignore a suggestion
    pub fn unignore_suggestion(&mut self, source_file: &str, target_file: &str) {
        let key = Self::make_ignored_key(source_file, target_file);
        self.ignored_suggestions.remove(&key);
    }

    /// Get all ignored suggestions as a list
    pub fn get_ignored_suggestions(&self) -> Vec<IgnoredSuggestion> {
        let mut result: Vec<IgnoredSuggestion> = self.ignored_suggestions.iter()
            .filter_map(|(key, &timestamp)| {
                let parts: Vec<&str> = key.splitn(2, '|').collect();
                if parts.len() == 2 {
                    Some(IgnoredSuggestion {
                        source_file: parts[0].to_string(),
                        target_file: parts[1].to_string(),
                        timestamp,
                    })
                } else {
                    None
                }
            })
            .collect();
        // Sort by timestamp (most recently ignored first)
        result.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        result
    }

    /// Clear all ignored suggestions
    pub fn clear_ignored_suggestions(&mut self) {
        self.ignored_suggestions.clear();
    }

    // --- Insertion Cache ---

    fn make_insertion_key(file_path: &str, link_title: &str) -> String {
        format!("{}::{}", file_path, link_title)
    }

    /// Get a cached insertion result
    pub fn get_cached_insertion(&self, file_path: &str, link_title: &str) -> Option<&String> {
        let key = Self::make_insertion_key(file_path, link_title);
        self.insertion_cache.get(&key)
    }

    /// Cache an insertion result
    pub fn cache_insertion(&mut self, file_path: &str, link_title: &str, result_json: &str) {
        let key = Self::make_insertion_key(file_path, link_title);
        self.insertion_cache.insert(key, result_json.to_string());
    }

    /// Invalidate insertion cache entries for a specific file
    pub fn invalidate_insertion_cache_for_file(&mut self, file_path: &str) -> usize {
        let keys_to_remove: Vec<String> = self.insertion_cache.keys()
            .filter(|k| k.starts_with(&format!("{}::", file_path)))
            .cloned()
            .collect();
        let count = keys_to_remove.len();
        for key in keys_to_remove {
            self.insertion_cache.remove(&key);
        }
        count
    }

    /// Clear all insertion cache
    pub fn clear_insertion_cache(&mut self) {
        self.insertion_cache.clear();
    }
}

/// Represents an ignored suggestion for serialization
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct IgnoredSuggestion {
    pub source_file: String,
    pub target_file: String,
    pub timestamp: u64,
}

impl CacheHeader {
    pub fn new_msgpack() -> Self {
        CacheHeader {
            version: 1,
            format: "msgpack".to_string(),
            created_at: js_sys::Date::now() as u64,
        }
    }

    pub fn new_json() -> Self {
        CacheHeader {
            version: 1,
            format: "json".to_string(),
            created_at: js_sys::Date::now() as u64,
        }
    }
}

/// Wrapper for versioned cache data
#[derive(Serialize, Deserialize, Debug)]
pub struct VersionedCache<T> {
    pub header: CacheHeader,
    pub data: T,
}

impl<T: Serialize> VersionedCache<T> {
    pub fn new(data: T, format: &str) -> Self {
        let header = if format == "msgpack" {
            CacheHeader::new_msgpack()
        } else {
            CacheHeader::new_json()
        };

        VersionedCache { header, data }
    }

    /// Serialize to MessagePack binary format
    pub fn to_msgpack(&self) -> Result<Vec<u8>, rmp_serde::encode::Error> {
        rmp_serde::to_vec(self)
    }

    /// Serialize to JSON string format
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }
}

impl<T: for<'de> Deserialize<'de>> VersionedCache<T> {
    /// Deserialize from MessagePack binary format
    pub fn from_msgpack(data: &[u8]) -> Result<Self, rmp_serde::decode::Error> {
        rmp_serde::from_slice(data)
    }

    /// Deserialize from JSON string format
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }
}

/// Embeddings cache data structure
pub type EmbeddingsData = HashMap<String, Vec<f32>>;

/// Keywords cache entry
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct KeywordEntry {
    pub keywords: Vec<String>,
    pub mtime: u64,
}

/// Keywords cache data structure
pub type KeywordsData = HashMap<String, KeywordEntry>;
