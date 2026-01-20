use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

mod embeddings;
mod vault;
mod links;
mod llm;
mod cache;

pub use embeddings::*;
pub use vault::*;
pub use links::*;
pub use llm::*;
pub use cache::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

macro_rules! console_log {
    ($($t:tt)*) => (log(&format_args!($($t)*).to_string()))
}

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub struct SmartVault {
    embeddings: HashMap<String, Vec<f32>>,
    file_contents: HashMap<String, String>,
    keywords: HashMap<String, Vec<String>>,  // Document keywords for better cross-linking
    cache_index: CacheIndex,  // Unified cache management
}

#[wasm_bindgen]
impl SmartVault {
    #[wasm_bindgen(constructor)]
    pub fn new() -> SmartVault {
        SmartVault {
            embeddings: HashMap::new(),
            file_contents: HashMap::new(),
            keywords: HashMap::new(),
            cache_index: CacheIndex::new(),
        }
    }

    pub fn set_keywords(&mut self, path: String, keywords: Vec<String>) {
        self.keywords.insert(path, keywords);
    }

    pub fn get_keywords(&self, path: &str) -> JsValue {
        if let Some(keywords) = self.keywords.get(path) {
            serde_wasm_bindgen::to_value(keywords).unwrap_or(JsValue::NULL)
        } else {
            JsValue::NULL
        }
    }

    pub fn add_file(&mut self, path: String, content: String) {
        self.file_contents.insert(path, content);
    }

    pub fn set_embedding(&mut self, path: String, embedding: Vec<f32>) {
        self.embeddings.insert(path, embedding);
    }

    pub fn get_file_count(&self) -> usize {
        self.file_contents.len()
    }

    pub fn has_embedding(&self, path: &str) -> bool {
        self.embeddings.contains_key(path)
    }

    pub fn get_embedding_count(&self) -> usize {
        self.embeddings.len()
    }

    pub fn get_embedding(&self, path: &str) -> Box<[f32]> {
        self.embeddings.get(path)
            .cloned()
            .unwrap_or_else(Vec::new)
            .into_boxed_slice()
    }

    // Serialize embeddings to JSON string for persistence (legacy)
    pub fn serialize_embeddings(&self) -> Result<String, JsValue> {
        serde_json::to_string(&self.embeddings)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    // Deserialize embeddings from JSON string (legacy)
    pub fn deserialize_embeddings(&mut self, json: &str) -> Result<(), JsValue> {
        let embeddings: HashMap<String, Vec<f32>> = serde_json::from_str(json)
            .map_err(|e| JsValue::from_str(&format!("Deserialization error: {}", e)))?;
        self.embeddings = embeddings;
        Ok(())
    }

    // Serialize embeddings to binary MessagePack format with versioning
    pub fn serialize_embeddings_binary(&self) -> Result<Vec<u8>, JsValue> {
        let versioned = VersionedCache::new(self.embeddings.clone(), "msgpack");
        versioned.to_msgpack()
            .map_err(|e| JsValue::from_str(&format!("Binary serialization error: {}", e)))
    }

    // Deserialize embeddings from binary MessagePack format with version detection
    pub fn deserialize_embeddings_binary(&mut self, data: &[u8]) -> Result<(), JsValue> {
        // Try to deserialize as versioned cache first
        if let Ok(versioned) = VersionedCache::<EmbeddingsData>::from_msgpack(data) {
            console_log!("[DEBUG] Loaded versioned cache: format={}, version={}",
                versioned.header.format, versioned.header.version);
            self.embeddings = versioned.data;
            Ok(())
        } else {
            // Fallback: try to deserialize as raw HashMap (legacy format)
            console_log!("[DEBUG] Attempting legacy format deserialization");
            let embeddings: HashMap<String, Vec<f32>> = rmp_serde::from_slice(data)
                .map_err(|e| JsValue::from_str(&format!("Binary deserialization error: {}", e)))?;
            self.embeddings = embeddings;
            Ok(())
        }
    }

    pub fn find_similar_notes(&self, path: &str, top_k: usize) -> JsValue {
        if let Some(query_embedding) = self.embeddings.get(path) {
            let mut similarities: Vec<(String, f32)> = self.embeddings
                .iter()
                .filter(|(p, _)| p.as_str() != path)
                .map(|(p, emb)| {
                    let similarity = cosine_similarity(query_embedding, emb);
                    (p.clone(), similarity)
                })
                .collect();

            similarities.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
            similarities.truncate(top_k);

            serde_wasm_bindgen::to_value(&similarities).unwrap()
        } else {
            JsValue::NULL
        }
    }

    pub fn find_similar(&self, query_embedding: Vec<f32>, threshold: f32) -> JsValue {
        let mut matches: Vec<SimilarityMatch> = self.embeddings
            .iter()
            .map(|(p, emb)| {
                let score = cosine_similarity(&query_embedding, emb);
                SimilarityMatch { path: p.clone(), score }
            })
            .filter(|m| m.score >= threshold)
            .collect();

        matches.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        
        serde_wasm_bindgen::to_value(&matches).unwrap_or(JsValue::NULL)
    }

    pub fn suggest_links_for_text(&self, text: &str, query_embedding: Vec<f32>, threshold: f32, current_file_path: &str, top_k: usize) -> JsValue {
        let mut suggestions: Vec<LinkSuggestion> = Vec::new();
        let text_lower = text.to_lowercase();
        let mut self_link_skipped = false;
        let mut candidates_above_threshold = 0;
        let effective_threshold = threshold * 0.85;

        web_sys::console::log_1(&format!("[DEBUG] suggest_links_for_text: threshold={}, effective={}, current_file={}, total_files={}",
            threshold, effective_threshold, current_file_path, self.embeddings.len()).into());

        for (path, embedding) in &self.embeddings {
            // Skip the current file
            if path == current_file_path {
                self_link_skipped = true;
                web_sys::console::log_1(&format!("[DEBUG] Skipped self-link: {}", path).into());
                continue;
            }

            let mut similarity = cosine_similarity(&query_embedding, embedding);
            let mut force_include = false;  // Flag for mandatory inclusion

            let note_title = extract_title_from_path(path);
            let note_title_lower = note_title.to_lowercase();

            // PRIORITY 0: MANDATORY INCLUSION - Exact title match in text (as standalone word/phrase)
            // If text contains "turbulence" as a standalone word and note is named "turbulence",
            // ALWAYS include it regardless of embedding similarity
            let title_words: Vec<&str> = note_title_lower.split_whitespace().collect();
            let is_single_word_title = title_words.len() == 1;

            if is_single_word_title {
                // For single-word titles, check for exact word match with word boundaries
                let word = title_words[0];
                let word_regex_pattern = format!(r"\b{}\b", regex::escape(word));
                if let Ok(word_regex) = regex::Regex::new(&word_regex_pattern) {
                    if word_regex.is_match(&text_lower) {
                        // Exact word match: FORCE INCLUDE + huge boost
                        force_include = true;
                        similarity += 0.50;
                        web_sys::console::log_1(&format!("[DEBUG] MANDATORY: Exact title word '{}' found in text - forcing inclusion", note_title).into());
                    }
                }
            } else {
                // For multi-word titles, check if full title appears as a phrase
                if text_lower.contains(&note_title_lower) {
                    // Full phrase match: FORCE INCLUDE + moderate boost
                    force_include = true;
                    similarity += 0.30;
                    web_sys::console::log_1(&format!("[DEBUG] MANDATORY: Full phrase '{}' found in text - forcing inclusion", note_title).into());
                }
            }

            // PRIORITY 2: Boost similarity if document keywords appear in the text
            if let Some(keywords) = self.keywords.get(path) {
                let mut keyword_match_count = 0;
                for keyword in keywords {
                    if text_lower.contains(&keyword.to_lowercase()) {
                        keyword_match_count += 1;
                    }
                }
                // Boost by up to 0.2 based on keyword matches
                if keyword_match_count > 0 {
                    let boost = (keyword_match_count as f32 * 0.05).min(0.2);
                    similarity += boost;
                }
            }

            // PRIORITY 3: Bidirectional title relationship boosting for parent/child topics
            // Example: "turbulence" <-> "strong turbulence", "weak turbulence"
            // But with lower boost than exact matches
            let current_title_lower = extract_title_from_path(current_file_path).to_lowercase();

            // Check if current title is contained in candidate title (parent -> child)
            // e.g., current="turbulence", candidate="strong turbulence"
            if note_title_lower.contains(&current_title_lower) && note_title_lower != current_title_lower {
                similarity += 0.10;  // Reduced boost for child topics (was 0.15)
            }

            // Check if candidate title is contained in current title (child -> parent)
            // e.g., current="strong turbulence", candidate="turbulence"
            if current_title_lower.contains(&note_title_lower) && note_title_lower != current_title_lower {
                similarity += 0.10;  // Reduced boost for parent topics (was 0.15)
            }

            // Include if EITHER:
            // 1. Force include (title found in text) - ALWAYS include these
            // 2. Similarity above threshold (semantic match)
            if force_include || similarity > effective_threshold {
                candidates_above_threshold += 1;
                if let Some(content) = self.file_contents.get(path) {
                    // note_title already extracted above, reuse it
                    let link_pattern = format!("[[{}]]", note_title);
                    let link_exists = text.contains(&link_pattern);

                    web_sys::console::log_1(&format!("[DEBUG] Checking '{}': link_pattern='{}', exists={}, similarity={:.3}, forced={}",
                        note_title, link_pattern, link_exists, similarity, force_include).into());

                    if !link_exists {
                        suggestions.push(LinkSuggestion {
                            path: path.clone(),
                            title: note_title,
                            similarity,
                            context: extract_context(content, 100),
                        });
                    } else if force_include {
                        web_sys::console::log_1(&format!("[DEBUG] Skipping '{}' - link already exists despite force_include", note_title).into());
                    }
                } else {
                    // No file content loaded - this candidate is lost! Log a warning.
                    web_sys::console::warn_1(&format!("⚠️ No file content for '{}' - cannot check for existing links. Load file contents first!", note_title).into());
                }
            }
        }

        web_sys::console::log_1(&format!("[DEBUG] Candidates above threshold: {}, after dedup: {}, after truncate: {}",
            candidates_above_threshold, suggestions.len(), suggestions.len().min(top_k)).into());

        // Sort by similarity and take top K
        suggestions.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap());
        suggestions.truncate(top_k);

        // Debug: log if self-link was NOT found (potential path mismatch)
        if !self_link_skipped && !current_file_path.is_empty() {
            web_sys::console::warn_1(&format!("⚠️ Self-link filtering may have failed! Current file '{}' not found in embeddings. Available paths: {:?}",
                current_file_path,
                self.embeddings.keys().take(3).collect::<Vec<_>>()
            ).into());
        }

        serde_wasm_bindgen::to_value(&suggestions).unwrap()
    }

    // ============================================================
    // Cache Index Operations (Phase 1 Rust Conversion)
    // ============================================================

    /// Check if a file's embedding is fresh (mtime unchanged)
    pub fn is_embedding_fresh(&self, path: &str, current_mtime: f64) -> bool {
        self.cache_index.is_embedding_fresh(path, current_mtime as u64)
    }

    /// Check if a file's keywords are fresh
    pub fn is_keyword_fresh(&self, path: &str, current_mtime: f64) -> bool {
        self.cache_index.is_keyword_fresh(path, current_mtime as u64)
    }

    /// Check if a file's suggestions are fresh
    pub fn is_suggestion_fresh(&self, path: &str, current_mtime: f64) -> bool {
        self.cache_index.is_suggestion_fresh(path, current_mtime as u64)
    }

    /// Mark a file's embedding as processed
    pub fn mark_embedding_processed(&mut self, path: &str, mtime: f64) {
        self.cache_index.mark_embedding_processed(path, mtime as u64);
    }

    /// Mark a file's keywords as processed
    pub fn mark_keyword_processed(&mut self, path: &str, mtime: f64) {
        self.cache_index.mark_keyword_processed(path, mtime as u64);
    }

    /// Mark a file's suggestions as processed
    pub fn mark_suggestion_processed(&mut self, path: &str, mtime: f64) {
        self.cache_index.mark_suggestion_processed(path, mtime as u64);
    }

    /// Invalidate all caches for a specific file
    pub fn invalidate_file_caches(&mut self, path: &str) {
        self.cache_index.invalidate_file(path);
    }

    /// Clear all cache data
    pub fn clear_all_caches(&mut self) {
        self.cache_index.clear();
    }

    // --- Ignored Suggestions ---

    /// Check if a suggestion is ignored
    pub fn is_suggestion_ignored(&self, source_file: &str, target_file: &str) -> bool {
        self.cache_index.is_suggestion_ignored(source_file, target_file)
    }

    /// Ignore a suggestion
    pub fn ignore_suggestion(&mut self, source_file: &str, target_file: &str) {
        self.cache_index.ignore_suggestion(source_file, target_file);
    }

    /// Unignore a suggestion
    pub fn unignore_suggestion(&mut self, source_file: &str, target_file: &str) {
        self.cache_index.unignore_suggestion(source_file, target_file);
    }

    /// Get all ignored suggestions
    pub fn get_ignored_suggestions(&self) -> JsValue {
        let ignored = self.cache_index.get_ignored_suggestions();
        serde_wasm_bindgen::to_value(&ignored).unwrap_or(JsValue::NULL)
    }

    /// Clear all ignored suggestions
    pub fn clear_ignored_suggestions(&mut self) {
        self.cache_index.clear_ignored_suggestions();
    }

    // --- Insertion Cache ---

    /// Get a cached insertion result
    pub fn get_cached_insertion(&self, file_path: &str, link_title: &str) -> JsValue {
        match self.cache_index.get_cached_insertion(file_path, link_title) {
            Some(json_str) => {
                // Parse the JSON string and return as JsValue
                match serde_json::from_str::<serde_json::Value>(json_str) {
                    Ok(value) => serde_wasm_bindgen::to_value(&value).unwrap_or(JsValue::NULL),
                    Err(_) => JsValue::NULL,
                }
            }
            None => JsValue::NULL,
        }
    }

    /// Cache an insertion result
    pub fn cache_insertion(&mut self, file_path: &str, link_title: &str, result_json: &str) {
        self.cache_index.cache_insertion(file_path, link_title, result_json);
    }

    /// Invalidate insertion cache entries for a specific file
    pub fn invalidate_insertion_cache_for_file(&mut self, file_path: &str) -> usize {
        self.cache_index.invalidate_insertion_cache_for_file(file_path)
    }

    /// Clear all insertion cache
    pub fn clear_insertion_cache(&mut self) {
        self.cache_index.clear_insertion_cache();
    }

    // --- Unified Cache Serialization ---

    /// Serialize the entire cache index to binary MessagePack format
    pub fn serialize_cache_index(&self) -> Result<Vec<u8>, JsValue> {
        let versioned = VersionedCache::new(self.cache_index.clone(), "msgpack");
        versioned.to_msgpack()
            .map_err(|e| JsValue::from_str(&format!("Cache index serialization error: {}", e)))
    }

    /// Deserialize the cache index from binary MessagePack format
    pub fn deserialize_cache_index(&mut self, data: &[u8]) -> Result<(), JsValue> {
        match VersionedCache::<CacheIndex>::from_msgpack(data) {
            Ok(versioned) => {
                console_log!("[DEBUG] Loaded cache index: format={}, version={}",
                    versioned.header.format, versioned.header.version);
                self.cache_index = versioned.data;
                Ok(())
            }
            Err(e) => {
                // Try legacy format (raw CacheIndex without versioning)
                console_log!("[DEBUG] Attempting legacy cache index format");
                match rmp_serde::from_slice::<CacheIndex>(data) {
                    Ok(index) => {
                        self.cache_index = index;
                        Ok(())
                    }
                    Err(_) => Err(JsValue::from_str(&format!("Cache index deserialization error: {}", e)))
                }
            }
        }
    }

    // --- Content Utilities (Phase 4) ---

    /// Truncate content to a maximum length
    pub fn truncate_content(&self, content: &str, max_length: usize) -> String {
        if content.len() <= max_length {
            content.to_string()
        } else {
            content[..max_length].to_string()
        }
    }

    // --- Scan Planning (Phase 2) ---

    /// Plan a vault scan: determine which files need processing and in what order.
    /// Returns a ScanPlan with files sorted optimally (current file first, then by mtime desc).
    ///
    /// Parameters:
    /// - files_json: JSON array of FileInfo objects [{path, mtime}, ...]
    /// - current_file: Optional path of the currently open file (will be prioritized)
    /// - check_suggestions: Whether to check if suggestions need regeneration
    pub fn plan_scan(&self, files_json: &str, current_file: Option<String>, check_suggestions: bool) -> JsValue {
        let files: Vec<FileInfo> = match serde_json::from_str(files_json) {
            Ok(f) => f,
            Err(e) => {
                web_sys::console::error_1(&format!("[ERROR] plan_scan: Failed to parse files JSON: {}", e).into());
                return JsValue::NULL;
            }
        };

        let mut to_process: Vec<FileToProcess> = Vec::new();
        let mut to_skip: Vec<String> = Vec::new();

        for file in &files {
            let mtime = file.mtime as u64;
            let has_embedding = self.embeddings.contains_key(&file.path);
            let embedding_fresh = self.cache_index.is_embedding_fresh(&file.path, mtime);
            let keyword_fresh = self.cache_index.is_keyword_fresh(&file.path, mtime);
            let suggestion_fresh = self.cache_index.is_suggestion_fresh(&file.path, mtime);

            let needs_embedding = !has_embedding || !embedding_fresh;
            let needs_keywords = needs_embedding || !keyword_fresh;
            let needs_suggestions = check_suggestions && (needs_embedding || !suggestion_fresh);

            if needs_embedding || needs_keywords || needs_suggestions {
                to_process.push(FileToProcess {
                    path: file.path.clone(),
                    mtime: file.mtime,
                    needs_embedding,
                    needs_keywords,
                    needs_suggestions,
                });
            } else {
                to_skip.push(file.path.clone());
            }
        }

        // Sort: current file first, then by mtime descending (most recent first)
        let current_file_ref = current_file.as_ref();
        to_process.sort_by(|a, b| {
            // Current file always first
            let a_is_current = current_file_ref.map_or(false, |cf| &a.path == cf);
            let b_is_current = current_file_ref.map_or(false, |cf| &b.path == cf);

            if a_is_current && !b_is_current {
                std::cmp::Ordering::Less
            } else if !a_is_current && b_is_current {
                std::cmp::Ordering::Greater
            } else {
                // Then by mtime descending
                b.mtime.partial_cmp(&a.mtime).unwrap_or(std::cmp::Ordering::Equal)
            }
        });

        // Find current file index in sorted list
        let current_file_index = current_file_ref.and_then(|cf| {
            to_process.iter().position(|f| &f.path == cf)
        });

        let plan = ScanPlan {
            to_process,
            to_skip,
            current_file_index,
        };

        serde_wasm_bindgen::to_value(&plan).unwrap_or(JsValue::NULL)
    }

    /// Get the number of files that need processing (quick check)
    pub fn count_files_needing_processing(&self, files_json: &str) -> usize {
        let files: Vec<FileInfo> = match serde_json::from_str(files_json) {
            Ok(f) => f,
            Err(_) => return 0,
        };

        files.iter().filter(|file| {
            let mtime = file.mtime as u64;
            let has_embedding = self.embeddings.contains_key(&file.path);
            let embedding_fresh = self.cache_index.is_embedding_fresh(&file.path, mtime);
            !has_embedding || !embedding_fresh
        }).count()
    }
}

/// File information for scan planning
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FileInfo {
    pub path: String,
    pub mtime: f64,
}

/// File processing plan item
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FileToProcess {
    pub path: String,
    pub mtime: f64,
    pub needs_embedding: bool,
    pub needs_keywords: bool,
    pub needs_suggestions: bool,
}

/// Scan plan result
#[derive(Serialize, Deserialize, Debug)]
pub struct ScanPlan {
    pub to_process: Vec<FileToProcess>,
    pub to_skip: Vec<String>,
    pub current_file_index: Option<usize>,
}

#[derive(Serialize, Deserialize)]
pub struct SimilarityMatch {
    pub path: String,
    pub score: f32,
}

#[derive(Serialize, Deserialize)]
pub struct LinkSuggestion {
    pub path: String,
    pub title: String,
    pub similarity: f32,
    pub context: String,
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return 0.0;
    }

    let dot_product: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let magnitude_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let magnitude_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();

    if magnitude_a == 0.0 || magnitude_b == 0.0 {
        return 0.0;
    }

    dot_product / (magnitude_a * magnitude_b)
}

fn extract_title_from_path(path: &str) -> String {
    path.rsplit('/')
        .next()
        .unwrap_or(path)
        .trim_end_matches(".md")
        .to_string()
}

fn extract_context(content: &str, max_chars: usize) -> String {
    let lines: Vec<&str> = content.lines().take(5).collect();
    let context = lines.join(" ");

    if context.len() > max_chars {
        format!("{}...", &context[..max_chars])
    } else {
        context
    }
}
