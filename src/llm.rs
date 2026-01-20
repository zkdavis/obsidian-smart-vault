use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct OllamaOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_ctx: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_predict: Option<i32>, // -1 for infinite, otherwise positive integer
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
}

#[derive(Serialize, Deserialize)]
pub struct OllamaGenerateRequest {
    pub model: String,
    pub prompt: String,
    pub stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<OllamaOptions>,
}

#[derive(Serialize, Deserialize)]
pub struct OllamaGenerateResponse {
    pub response: String,
    pub done: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RankedSuggestion {
    pub path: String,
    pub title: String,
    pub similarity: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llm_score: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llm_reason: Option<String>,
    pub context: String,
}

// Input suggestion without LLM data
#[derive(Serialize, Deserialize, Clone)]
struct BaseSuggestion {
    pub path: String,
    pub title: String,
    pub similarity: f32,
    pub context: String,
}

#[derive(Serialize, Deserialize)]
struct LLMRankingItem {
    index: usize,
    score: f32,
    reason: String,
}

#[derive(Serialize, Deserialize)]
pub struct GrammarIssue {
    pub original: String,
    pub corrected: String,
    pub reason: String,
}

#[derive(Serialize, Deserialize)]
pub struct StructureChange {
    pub title: String,
    pub description: String,
    pub markdown_to_insert: String, // The actual text to insert
}

#[derive(Serialize, Deserialize)]
pub struct Flashcard {
    pub question: String,
    pub answer: String,
}

#[derive(Serialize, Deserialize)]
pub struct FormattingAnalysis {
    pub grammar: Vec<GrammarIssue>,
    pub structure_suggestions: Vec<StructureChange>,
    pub flashcards: Vec<Flashcard>,
    pub existing_tags: Vec<String>,
    pub new_tags: Vec<String>,
}

#[derive(Serialize, Deserialize)]
pub struct OrganizationCandidate {
    pub folder: String,
    pub confidence: f32, // 0.0 - 1.0
    pub reason: String,
    pub is_new_path: bool,
}

#[derive(Serialize, Deserialize)]
pub struct OrganizationResult {
    pub suggestions: Vec<OrganizationCandidate>,
}

/// Extract JSON array from text that might have extra content
/// Looks for the first `[` and last `]` to extract a JSON array
fn extract_json_array(text: &str) -> Option<String> {
    let first_bracket = text.find('[')?;
    let last_bracket = text.rfind(']')?;

    if last_bracket > first_bracket {
        Some(text[first_bracket..=last_bracket].to_string())
    } else {
        None
    }
}

/// Extract JSON object from text that might have extra content
/// Looks for the first `{` and last `}` to extract a JSON object
fn extract_json_object(text: &str) -> Option<String> {
    let first_brace = text.find('{')?;
    let last_brace = text.rfind('}')?;

    if last_brace > first_brace {
        Some(text[first_brace..=last_brace].to_string())
    } else {
        None
    }
}

/// Generate text completion using Ollama
#[wasm_bindgen]
pub async fn generate_text_ollama(
    endpoint: String,
    model: String,
    prompt: String,
    temperature: Option<f32>,
    json_format: bool,
) -> Result<String, JsValue> {
    let request = OllamaGenerateRequest {
        model,
        prompt,
        stream: false,
        format: if json_format { Some("json".to_string()) } else { None },
        images: None,
        options: Some(OllamaOptions {
            num_ctx: Some(4096),
            num_predict: Some(-1), // Infinite generation
            temperature,
        }),
    };

    let request_json = serde_json::to_string(&request).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))?;

    web_sys::console::log_1(&format!("[Rust] generate_text_ollama Request: {}", request_json).into());

    let client = gloo_net::http::Request::post(&format!("{}/api/generate", endpoint))
        .header("Content-Type", "application/json")
        .body(request_json)
        .map_err(|e| JsValue::from_str(&format!("Request error: {}", e)))?;

    let response = client
        .send()
        .await
        .map_err(|e| JsValue::from_str(&format!("Network error: {}", e)))?;

    if !response.ok() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(JsValue::from_str(&format!("HTTP {}: {}", status, error_text)));
    }

    let generate_response: OllamaGenerateResponse = response
        .json()
        .await
        .map_err(|e| JsValue::from_str(&format!("Parse error: {}", e)))?;

    Ok(generate_response.response)
}

pub async fn generate_text_with_images_ollama(
    endpoint: String,
    model: String,
    prompt: String,
    images: Vec<String>,
    temperature: Option<f32>,
) -> Result<String, JsValue> {
    let request = OllamaGenerateRequest {
        model,
        prompt,
        stream: false,
        format: None,
        images: Some(images),
        options: Some(OllamaOptions {
            num_ctx: Some(4096),
            num_predict: Some(-1),
            temperature,
        }),
    };

    let request_json = serde_json::to_string(&request).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))?;
    
    web_sys::console::log_1(&format!("[Rust] Sending request to Ollama: {}/api/generate", endpoint).into());
    web_sys::console::log_1(&format!("[Rust] Request Body: {}", request_json).into());

    let client = gloo_net::http::Request::post(&format!("{}/api/generate", endpoint))
        .header("Content-Type", "application/json")
        .body(request_json)
        .map_err(|e| JsValue::from_str(&format!("Request error: {}", e)))?;

    web_sys::console::log_1(&"[Rust] Request built, sending...".into());

    let response = client
        .send()
        .await
        .map_err(|e| JsValue::from_str(&format!("Network error: {}", e)))?;

    web_sys::console::log_1(&"[Rust] Response received, parsing...".into());

    if !response.ok() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(JsValue::from_str(&format!("HTTP {}: {}", status, error_text)));
    }

    let generate_response: OllamaGenerateResponse = response
        .json()
        .await
        .map_err(|e| JsValue::from_str(&format!("Parse error: {}", e)))?;

    Ok(generate_response.response)
}

/// Rerank link suggestions using LLM analysis
#[wasm_bindgen]
pub async fn rerank_suggestions_with_llm(
    endpoint: String,
    model: String,
    current_doc_title: String,
    current_doc_content: String,
    suggestions_json: String,
    temperature: f32,
    enable_thinking: bool,
    debug: bool,
) -> Result<JsValue, JsValue> {
    if debug {
        web_sys::console::log_1(&format!("[DEBUG] rerank_suggestions_with_llm called with {} suggestions",
            suggestions_json.matches("\"path\"").count()).into());
    }

    // Parse incoming suggestions (they don't have LLM scores yet)
    let base_suggestions: Vec<BaseSuggestion> = serde_json::from_str(&suggestions_json)
        .map_err(|e| {
            web_sys::console::log_1(&format!("[ERROR] Parse suggestions error: {}", e).into());
            web_sys::console::log_1(&format!("[ERROR] Suggestions JSON: {}", suggestions_json).into());
            JsValue::from_str(&format!("Parse suggestions error: {}", e))
        })?;

    if base_suggestions.is_empty() {
        if debug {
            web_sys::console::log_1(&"[DEBUG] No suggestions to rerank".into());
        }
        return serde_wasm_bindgen::to_value(&Vec::<RankedSuggestion>::new())
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)));
    }

    if debug {
        web_sys::console::log_1(&"[DEBUG] ========== INPUT SUGGESTIONS ==========".into());
        web_sys::console::log_1(&format!("[DEBUG] Successfully parsed {} base suggestions:", base_suggestions.len()).into());
        for (i, sugg) in base_suggestions.iter().enumerate() {
            web_sys::console::log_1(&format!(
                "[DEBUG]   {}. \"{}\" (similarity: {:.3}, path: {})",
                i + 1,
                sugg.title,
                sugg.similarity,
                sugg.path
            ).into());
        }
        web_sys::console::log_1(&"[DEBUG] ========== END INPUT SUGGESTIONS ==========".into());
    }

    // Truncate document content for LLM context (first 800 chars)
    let doc_preview = if current_doc_content.len() > 800 {
        format!("{}...", &current_doc_content[..800])
    } else {
        current_doc_content.clone()
    };

    if debug {
        web_sys::console::log_1(&format!("[DEBUG] Document preview length: {} chars", doc_preview.len()).into());
    }

    // Build candidate list for prompt
    let candidates_text: Vec<String> = base_suggestions
        .iter()
        .enumerate()
        .map(|(i, s)| {
            format!(
                "{}. Title: \"{}\"\n   Embedding Similarity: {:.2}\n   Context: {}",
                i + 1,
                s.title,
                s.similarity,
                s.context
            )
        })
        .collect();

    let thinking_instructions = if enable_thinking {
        r#"

THINKING MODE ENABLED: Before providing your final answer, think through your reasoning:
1. Analyze the current document's main topics and themes
2. For each candidate, identify semantic connections and relevance
3. Consider both direct topic matches and indirect conceptual relationships
4. Rank candidates by how valuable they would be for a reader

After thinking, provide your final rankings as a JSON array."#
    } else {
        ""
    };

    // Build the exact template the LLM should fill in
    let template_entries: Vec<String> = (1..=base_suggestions.len())
        .map(|i| format!(
            "  {{\"index\": {}, \"score\": <score>, \"reason\": \"<reason>\"}}{}",
            i,
            if i < base_suggestions.len() { "," } else { "" }
        ))
        .collect();

    let template = format!("[\n{}\n]", template_entries.join("\n"));

    // CREATIVE APPROACH: Ask for reasoning first, then structured output
    // This works better with smaller models that prefer natural language
    let prompt = format!(
        r#"You are ranking {} documents for relevance to the current document.

Current Document: "{}"
Content: {}

Documents to rank:
{}

{}

TASK: For EACH of the {} documents above, provide:
1. A relevance score (0.0 to 10.0, where 10 is most relevant)
2. A brief reason (max 15 words)

STRICT FORMATTING RULES:
- Output ONLY the rankings in the exact format below.
- Do NOT use Markdown formatting (no bolding, no italics).
- Do NOT surround text with asterisks (e.g. **Document 1** is FORBIDDEN).
- Do NOT include the document title in the output line.
- Keep each ranking on a SINGLE line.

Required Format:
Document 1: [score] - [reason]
Document 2: [score] - [reason]
...

Make sure you analyze ALL {} documents. Do not skip any!"#,
        base_suggestions.len(),
        current_doc_title,
        doc_preview,
        candidates_text.join("\n\n"),
        thinking_instructions,
        base_suggestions.len(),
        base_suggestions.len()
    );

    // Call LLM
    if debug {
        web_sys::console::log_1(&"[DEBUG] ========== LLM RERANKING REQUEST ==========".into());
        web_sys::console::log_1(&format!("[DEBUG] Model: {}", model).into());
        web_sys::console::log_1(&format!("[DEBUG] Temperature: {}", temperature).into());
        web_sys::console::log_1(&format!("[DEBUG] Candidates sent: {}", base_suggestions.len()).into());
        web_sys::console::log_1(&"[DEBUG] ========== FULL PROMPT ==========".into());
        web_sys::console::log_1(&prompt.clone().into());
        web_sys::console::log_1(&"[DEBUG] ========== END PROMPT ==========".into());
    }

    // CRITICAL: Use json_format=false for natural language responses
    // If true, the model will try to structure the prompt itself as JSON!
    let response_text = generate_text_ollama(
        endpoint,
        model,
        prompt,
        Some(temperature),
        false,  // Natural language output, not JSON
    )
    .await?;

    if debug {
        web_sys::console::log_1(&"[DEBUG] ========== LLM RESPONSE ==========".into());
        web_sys::console::log_1(&format!("[DEBUG] Response length: {} chars", response_text.len()).into());
        web_sys::console::log_1(&response_text.clone().into());
        web_sys::console::log_1(&"[DEBUG] ========== END RESPONSE ==========".into());
    }

    // Parse natural language response: "Document 1: 8.5 - Directly related to..."
    // Format: Document N: [score] - [reason]
    let mut llm_rankings: Vec<LLMRankingItem> = Vec::new();

    for line in response_text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Match patterns:
        // "Document 1: 8.5 - Reason"
        // "Doc 1: 8.5 - Reason"
        // "1. 8.5 - Reason"
        // "Source 1: 8.5"
        
        let lower = trimmed.to_lowercase();
        let mut index_part = "";
        let mut rest_part = "";

        // Try to identify the start
        if let Some(idx) = lower.find("document ") {
            let after = &trimmed[idx + 9..];
            if let Some(colon) = after.find(':') {
                index_part = &after[..colon];
                rest_part = &after[colon+1..];
            }
        } else if let Some(idx) = lower.find("doc ") {
            let after = &trimmed[idx + 4..];
            if let Some(colon) = after.find(':') {
                index_part = &after[..colon];
                rest_part = &after[colon+1..];
            }
        } else if let Some(idx) = lower.find("source ") {
            let after = &trimmed[idx + 7..];
            if let Some(colon) = after.find(':') {
                index_part = &after[..colon];
                rest_part = &after[colon+1..];
            }
        } else {
             // Try "1. 8.5" format
             if let Some(dot) = trimmed.find('.') {
                 let potential_idx = &trimmed[..dot];
                 if potential_idx.trim().parse::<usize>().is_ok() {
                     index_part = potential_idx;
                     rest_part = &trimmed[dot+1..];
                 }
             }
        }

        if !index_part.is_empty() {
            let index_str = index_part.trim().replace("#", "").replace("*", "");
             if let Ok(index) = index_str.parse::<usize>() {
                // Parse score/reason from rest_part
                let content = rest_part.trim();
                
                // Expect "8.5 - Reason" or "8.5: Reason" or just "8.5"
                // Find separator (dash or colon or space)
                let mut score_str = "";
                let mut reason = "";
                
                if let Some(dash) = content.find(" - ") {
                    score_str = &content[..dash];
                    reason = &content[dash+3..];
                } else if let Some(dash) = content.find('-') {
                     // check if it's a negative number or separator? 
                     // usually score is positive. assume separator.
                     score_str = &content[..dash];
                     reason = &content[dash+1..];
                } else if let Some(colon) = content.find(':') {
                     score_str = &content[..colon];
                     reason = &content[colon+1..];
                } else {
                    // Maybe just score?
                    score_str = content;
                    reason = "Relevant";
                }

                if let Ok(score) = score_str.trim().replace("*", "").parse::<f32>() {
                      llm_rankings.push(LLMRankingItem {
                            index,
                            score,
                            reason: reason.trim().to_string(),
                        });
                }
             }
        }
    }

    if debug {
        web_sys::console::log_1(&format!("[DEBUG] Parsed {} rankings from natural language response", llm_rankings.len()).into());
    }

    // Fallback: try JSON parsing if natural language failed
    if llm_rankings.is_empty() {
        if debug {
            web_sys::console::log_1(&"[DEBUG] Natural language parsing failed, trying JSON...".into());
        }

        let json_text = extract_json_array(&response_text).unwrap_or(response_text.clone());
        llm_rankings = match serde_json::from_str::<Vec<LLMRankingItem>>(&json_text) {
        Ok(rankings) => rankings,
        Err(array_err) => {
            if debug {
                web_sys::console::log_1(&format!("[DEBUG] Failed to parse as plain array: {}", array_err).into());
                web_sys::console::log_1(&"[DEBUG] Attempting to parse as single object...".into());
            }

            // Try parsing as a single LLMRankingItem (LLM returned just one object instead of array)
            match serde_json::from_str::<LLMRankingItem>(&json_text) {
                Ok(single_item) => {
                    if debug {
                        web_sys::console::log_1(&format!("[DEBUG] LLM returned single object instead of array - wrapping in array").into());
                    }
                    vec![single_item]
                },
                Err(single_err) => {
                    if debug {
                        web_sys::console::log_1(&format!("[DEBUG] Failed to parse as single object: {}", single_err).into());
                        web_sys::console::log_1(&"[DEBUG] Attempting to parse as wrapped object...".into());
                    }

                    // Try parsing as object with "candidates" field
                    #[derive(Deserialize)]
                    struct WrappedResponseCandidates {
                        candidates: Vec<LLMRankingItem>,
                    }

                    // Try parsing as object with "indexes" field
                    #[derive(Deserialize)]
                    struct WrappedResponseIndexes {
                        indexes: Vec<LLMRankingItem>,
                    }

                    match serde_json::from_str::<WrappedResponseCandidates>(&json_text) {
                        Ok(wrapped) => {
                            if debug {
                                web_sys::console::log_1(&format!("[DEBUG] Successfully parsed as wrapped object with {} candidates", wrapped.candidates.len()).into());
                            }
                            wrapped.candidates
                        },
                        Err(wrapped_err) => {
                            if debug {
                                web_sys::console::log_1(&format!("[DEBUG] Failed to parse with 'candidates' field: {}", wrapped_err).into());
                                web_sys::console::log_1(&"[DEBUG] Attempting to parse with 'indexes' field...".into());
                            }

                            // Try parsing with "indexes" field
                            match serde_json::from_str::<WrappedResponseIndexes>(&json_text) {
                                Ok(wrapped) => {
                                    if debug {
                                        web_sys::console::log_1(&format!("[DEBUG] Successfully parsed as wrapped object with {} indexes", wrapped.indexes.len()).into());
                                    }
                                    wrapped.indexes
                                },
                                Err(_indexes_err) => {
                                    // All formats failed - fall back to embedding-only suggestions
                                    if debug {
                                        web_sys::console::log_1(&format!("[WARNING] LLM reranking failed - invalid JSON format. Response: {}",
                                            if response_text.len() > 200 { &response_text[..200] } else { &response_text }).into());
                                        web_sys::console::log_1(&format!("[WARNING] Expected array of {} items, falling back to embedding-only", base_suggestions.len()).into());
                                    }
                                    return Err(JsValue::from_str("LLM returned invalid format"));
                                }
                            }
                        }
                    }
                }
            }
        }
        };
    }

    if debug {
        web_sys::console::log_1(&format!("[DEBUG] Successfully parsed {} LLM rankings (total)", llm_rankings.len()).into());
    }

    // Validate that LLM returned correct number of items
    if llm_rankings.len() != base_suggestions.len() {
        web_sys::console::log_1(&format!("[WARNING] LLM returned {} items but expected {}. Will include unranked items with embedding scores.",
            llm_rankings.len(), base_suggestions.len()).into());
    }

    // Track which indices were ranked by LLM
    let mut ranked_indices: std::collections::HashSet<usize> = std::collections::HashSet::new();

    // Create reranked suggestions from LLM rankings
    let mut reranked: Vec<RankedSuggestion> = Vec::new();

    for ranking in llm_rankings {
        let idx = ranking.index - 1; // Convert 1-indexed to 0-indexed
        if idx < base_suggestions.len() {
            ranked_indices.insert(idx);
            let original = &base_suggestions[idx];
            reranked.push(RankedSuggestion {
                path: original.path.clone(),
                title: original.title.clone(),
                similarity: original.similarity,
                llm_score: Some(ranking.score),
                llm_reason: Some(ranking.reason.clone()),
                context: original.context.clone(),
            });
        }
    }

    // Add unranked suggestions (LLM didn't process them) with embedding scores only
    for (idx, suggestion) in base_suggestions.iter().enumerate() {
        if !ranked_indices.contains(&idx) {
            if debug {
                web_sys::console::log_1(&format!("[DEBUG] Adding unranked suggestion '{}' with embedding score {:.3}",
                    suggestion.title, suggestion.similarity).into());
            }
            reranked.push(RankedSuggestion {
                path: suggestion.path.clone(),
                title: suggestion.title.clone(),
                similarity: suggestion.similarity,
                llm_score: None,  // No LLM score
                llm_reason: None,
                context: suggestion.context.clone(),
            });
        }
    }

    if debug {
        web_sys::console::log_1(&"[DEBUG] ========== OUTPUT SUGGESTIONS ==========".into());
        web_sys::console::log_1(&format!("[DEBUG] Created {} reranked suggestions ({} from LLM, {} from embeddings only)",
            reranked.len(), ranked_indices.len(), reranked.len() - ranked_indices.len()).into());

        web_sys::console::log_1(&"[DEBUG] Before sorting:".into());
        for (i, sugg) in reranked.iter().enumerate() {
            if let Some(llm_score) = sugg.llm_score {
                web_sys::console::log_1(&format!(
                    "[DEBUG]   {}. \"{}\" - LLM score: {:.2}, reason: {:?}",
                    i + 1,
                    sugg.title,
                    llm_score,
                    sugg.llm_reason.as_ref().unwrap_or(&"N/A".to_string())
                ).into());
            } else {
                web_sys::console::log_1(&format!(
                    "[DEBUG]   {}. \"{}\" - embedding only (similarity: {:.3})",
                    i + 1,
                    sugg.title,
                    sugg.similarity
                ).into());
            }
        }
    }

    // Sort: LLM-ranked items first (by score), then embedding-only items (by similarity)
    reranked.sort_by(|a, b| {
        match (a.llm_score, b.llm_score) {
            // Both have LLM scores - compare by score
            (Some(score_a), Some(score_b)) => {
                score_b.partial_cmp(&score_a).unwrap_or(std::cmp::Ordering::Equal)
            },
            // Only a has LLM score - a comes first
            (Some(_), None) => std::cmp::Ordering::Less,
            // Only b has LLM score - b comes first
            (None, Some(_)) => std::cmp::Ordering::Greater,
            // Neither has LLM score - compare by embedding similarity
            (None, None) => {
                b.similarity.partial_cmp(&a.similarity).unwrap_or(std::cmp::Ordering::Equal)
            }
        }
    });

    if debug {
        web_sys::console::log_1(&"[DEBUG] After sorting (final output):".into());
        for (i, sugg) in reranked.iter().enumerate() {
            if let Some(llm_score) = sugg.llm_score {
                web_sys::console::log_1(&format!(
                    "[DEBUG]   {}. \"{}\" - LLM score: {:.2}, reason: {:?}",
                    i + 1,
                    sugg.title,
                    llm_score,
                    sugg.llm_reason.as_ref().unwrap_or(&"N/A".to_string())
                ).into());
            } else {
                web_sys::console::log_1(&format!(
                    "[DEBUG]   {}. \"{}\" - embedding only (similarity: {:.3})",
                    i + 1,
                    sugg.title,
                    sugg.similarity
                ).into());
            }
        }
        web_sys::console::log_1(&"[DEBUG] ========== END OUTPUT SUGGESTIONS ==========".into());
    }

    serde_wasm_bindgen::to_value(&reranked)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

/// Generate smart insertion suggestions using LLM
#[wasm_bindgen]
pub async fn suggest_insertion_points_with_llm(
    endpoint: String,
    model: String,
    document_content: String,
    link_title: String,
    link_context: String,
    temperature: f32,
    enable_thinking: bool,
    debug: bool,
) -> Result<JsValue, JsValue> {
    if debug {
        web_sys::console::log_1(&format!("[DEBUG] suggest_insertion_points_with_llm called for link: {}", link_title).into());
        web_sys::console::log_1(&format!("[DEBUG] Document length: {} chars", document_content.len()).into());
    }

    // Truncate document if too long
    let doc_text = if document_content.len() > 2000 {
        format!("{}...\n\n[Content truncated]", &document_content[..2000])
    } else {
        document_content.clone()
    };

    let thinking_instructions = if enable_thinking {
        r#"

THINKING MODE: First, analyze the document structure and identify:
1. Where the link topic is most relevant
2. Which phrases naturally connect to the link
3. The best insertion point for reader flow

Then provide your answer as JSON."#
    } else {
        ""
    };

    let prompt = format!(
        r#"Find the best place to insert a link to "{}" in this document.

Document Content:
{}

Link Context (what the linked document is about):
{}{}

Task: Identify the specific phrase or sentence where this link would add most value. Consider:
- Where would a reader naturally want more information?
- Which sentence mentions concepts explained by the link?
- Where would the link flow naturally?

IMPORTANT: Return ONLY valid JSON, no other text.

Respond with this exact JSON format:
{{
  "phrase": "exact text from document to replace",
  "reason": "why this is the best insertion point",
  "confidence": 0.85
}}

If no good insertion point exists, return: {{"phrase": null, "reason": "No natural insertion point found", "confidence": 0.0}}"#,
        link_title,
        doc_text,
        link_context,
        thinking_instructions
    );

    if debug {
        web_sys::console::log_1(&format!("[DEBUG] Sending insertion request to LLM (model: {})", model).into());
        web_sys::console::log_1(&format!("[DEBUG] Prompt length: {} chars", prompt.len()).into());
    }

    let response_text = generate_text_ollama(
        endpoint,
        model,
        prompt,
        Some(temperature),
        true,
    )
    .await?;

    // Trim whitespace - LLM sometimes adds trailing newlines that break JSON parsing
    let response_text = response_text.trim();

    if debug {
        web_sys::console::log_1(&format!("[DEBUG] LLM insertion response length: {} chars", response_text.len()).into());
        web_sys::console::log_1(&format!("[DEBUG] LLM insertion response: {}", response_text).into());
    }

    // Parse and return the response
    let parsed: serde_json::Value = serde_json::from_str(response_text)
        .map_err(|e| {
            web_sys::console::log_1(&format!("[ERROR] LLM Insertion Response: {}", response_text).into());
            web_sys::console::log_1(&format!("[ERROR] Parse error: {}", e).into());
            JsValue::from_str(&format!("Failed to parse LLM insertion response: {}", e))
        })?;

    if debug {
        web_sys::console::log_1(&format!("[DEBUG] Successfully parsed insertion response").into());
    }

    serde_wasm_bindgen::to_value(&parsed)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}
/// Extract keywords and key concepts from a document using LLM
#[wasm_bindgen]
pub async fn extract_keywords_with_llm(
    endpoint: String,
    model: String,
    document_title: String,
    document_content: String,
    temperature: f32,
    enable_thinking: bool,
    debug: bool,
) -> Result<JsValue, JsValue> {
    if debug {
        web_sys::console::log_1(&format!("[DEBUG] extract_keywords_with_llm called for: {}", document_title).into());
    }

    // Truncate document if too long
    let doc_text = if document_content.len() > 3000 {
        format!("{}...\n\n[Content truncated]", &document_content[..3000])
    } else {
        document_content.clone()
    };

    let thinking_instructions = if enable_thinking {
        r#"

THINKING MODE: First, read through the document and identify:
1. Main topics and themes
2. Technical terms and concepts
3. Named entities
4. Cross-referencing keywords

Then provide your final keyword list as a JSON array."#
    } else {
        ""
    };

    let prompt = format!(
        r#"Extract the most important keywords, concepts, and topics from this document titled "{}".

Document Content:
{}{}

Task: Identify 5-15 key terms that represent the main concepts discussed in this document. These should be:
- Technical terms, theories, or concepts mentioned
- Named entities (people, places, specific things)
- Important topics or themes
- Terms that other related documents might reference

Return ONLY a JSON array of strings (no explanations):
["keyword1", "keyword2", "keyword3", ...]

Keywords:"#,
        document_title,
        doc_text,
        thinking_instructions
    );

    if debug {
        web_sys::console::log_1(&format!("[DEBUG] Keyword extraction prompt length: {} chars", prompt.len()).into());
    }

    // Call LLM
    let response_text = generate_text_ollama(
        endpoint,
        model,
        prompt,
        Some(temperature),
        true, // JSON format
    ).await?;

    // Trim whitespace - LLM sometimes adds trailing newlines that break JSON parsing
    let response_text = response_text.trim().to_string();

    if debug {
        web_sys::console::log_1(&format!("[DEBUG] LLM keyword response: {}", response_text).into());
    }

    // Parse the response - try as array first, then extract from object with "keywords" key
    let keywords: Vec<String> = match serde_json::from_str::<Vec<String>>(&response_text) {
        Ok(arr) => arr,
        Err(_) => {
            // Try parsing as object with "keywords" key containing an array
            match serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&response_text) {
                Ok(obj) => {
                    // Check for "keywords" key with array value
                    if let Some(serde_json::Value::Array(arr)) = obj.get("keywords") {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(|s| s.to_string()))
                            .collect()
                    } else {
                        // Try to find any array value in the object (LLM may use different key names)
                        let mut found_keywords: Vec<String> = Vec::new();
                        for (_key, value) in obj.iter() {
                            if let serde_json::Value::Array(arr) = value {
                                // Found an array - extract string values
                                for item in arr {
                                    if let Some(s) = item.as_str() {
                                        found_keywords.push(s.to_string());
                                    }
                                }
                                if !found_keywords.is_empty() {
                                    break; // Use the first array we find
                                }
                            }
                        }
                        if found_keywords.is_empty() {
                            // No array found - return error instead of extracting keys
                            if debug {
                                web_sys::console::log_1(&format!("[WARNING] No keyword array found in object, keys were: {:?}", obj.keys().collect::<Vec<_>>()).into());
                            }
                            return Err(JsValue::from_str("LLM returned object without keywords array"));
                        }
                        found_keywords
                    }
                },
                Err(e) => {
                    web_sys::console::log_1(&format!("[ERROR] Failed to parse keywords: {}", e).into());
                    web_sys::console::log_1(&format!("[ERROR] Response was: {}", response_text).into());
                    return Err(JsValue::from_str(&format!("Failed to parse keyword response: {}", e)));
                }
            }
        }
    };

    if debug {
        web_sys::console::log_1(&format!("[DEBUG] Extracted {} keywords", keywords.len()).into());
    }

    serde_wasm_bindgen::to_value(&keywords)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

/// Chat with LLM (Context-Aware)
#[wasm_bindgen]
pub async fn chat_with_llm(
    endpoint: String,
    model: String,
    system_prompt: String,
    user_message: String,
    context: String,
    temperature: f32,
) -> Result<String, JsValue> {
    let full_prompt = format!(
        "{}\n\nContext:\n{}\n\nUser: {}",
        system_prompt, context, user_message
    );

    // Reuse existing generation function
    generate_text_ollama(
        endpoint,
        model,
        full_prompt,
        Some(temperature),
        false, // Not forcing JSON for chat
    )
    .await
}

/// Analyze formatting, grammar, structure, and generate flashcards
#[wasm_bindgen]
pub async fn analyze_formatting_with_llm(
    endpoint: String,
    model: String,
    content: String,
    all_vault_tags: Vec<String>,
    temperature: f32,
    enable_thinking: bool,
    debug: bool,
) -> Result<JsValue, JsValue> {
    if debug {
        web_sys::console::log_1(&format!("[DEBUG] analyze_formatting called. Content len: {}", content.len()).into());
    }

    let doc_text = if content.len() > 2000 {
        format!("{}...\n\n[Content truncated]", &content[..2000])
    } else {
        content.clone()
    };

    let existing_tags_str = all_vault_tags.join(", ");
    
    let thinking_part = if enable_thinking {
        r#"
Thinking Process:
1. Scan for grammar/spelling errors.
2. Evaluate Zettelkasten atomic structure (is it focused? is it connected?).
3. Identify facts suitable for spaced repetition flashcards.
4. Select relevant tags from the existing list, and identify any necessary new tags.
"#
    } else { "" };

    // Use replace() to avoid format! macro escaping issues with JSON braces
    let template = r###"Analyze this note content for improvements.
        
Existing Vault Tags: [PLACEHOLDER_TAGS]

Content:
PLACEHOLDER_CONTENT

Tasks:
1. Grammar: Identify typos or grammar mistakes.
2. Structure: Suggest concrete improvements.
   - For each suggestion, provide the specific Markdown text to insert/append.
3. Flashcards: Generate 1-3 flashcards ("Question::Answer").
4. Tags: Suggest tags (existing vs new).
   - "new_tags": Limit to top 1-3 most relevant new tags.

Response Format (JSON ONLY, NO DUPLICATE KEYS):
{
  "grammar": [
    {"original": "typo", "corrected": "correction", "reason": "spelling"}
  ],
  "structure_suggestions": [
     {
        "title": "Add Summary", 
        "description": "Add a summary section at the end.", 
        "markdown_to_insert": "## Summary\n\nThis note discusses..."
     }
  ],
  "flashcards": [
     { "question": "What is the mitochondria?", "answer": "The powerhouse of the cell" }
  ],
  "existing_tags": ["existing-tag-1"],
  "new_tags": ["top-new-tag"]
}
PLACEHOLDER_THINKING
"###;

    let prompt = template
        .replace("PLACEHOLDER_TAGS", &existing_tags_str)
        .replace("PLACEHOLDER_CONTENT", &doc_text)
        .replace("PLACEHOLDER_THINKING", thinking_part);

    if debug {
        web_sys::console::log_1(&format!("[DEBUG] Formatting Prompt len: {}", prompt.len()).into());
    }

    let response = generate_text_ollama(
        endpoint, 
        model, 
        prompt, 
        Some(temperature), 
        true
    ).await?;

    if debug {
        web_sys::console::log_1(&format!("[DEBUG] Formatting Response: {}", response).into());
    }

    // Attempt to parse
    match serde_json::from_str::<FormattingAnalysis>(&response) {
        Ok(analysis) => serde_wasm_bindgen::to_value(&analysis)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e))),
        Err(e) => {
             // Fallback: try to extract JSON object if LLM ignored strictness
             let json_text = extract_json_object(&response).unwrap_or(response.clone());
             match serde_json::from_str::<FormattingAnalysis>(&json_text) {
                 Ok(analysis) => serde_wasm_bindgen::to_value(&analysis)
                    .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e))),
                 Err(e2) => Err(JsValue::from_str(&format!("Failed to parse formatting analysis: {}. Response: {}", e2, response)))
             }
        }
    }
}

/// Analyze organization and suggest placement
#[wasm_bindgen]
pub async fn analyze_organization_with_llm(
    endpoint: String,
    model: String,
    file_name: String,
    content: String,
    vault_folders: Vec<String>,
    temperature: f32,
    enable_thinking: bool,
    debug: bool,
) -> Result<JsValue, JsValue> {
    if debug {
        web_sys::console::log_1(&format!("[DEBUG] analyze_organization called for {}", file_name).into());
    }

    let doc_text = if content.len() > 1000 {
        format!("{}...", &content[..1000])
    } else {
        content.clone()
    };

    let folders_list = vault_folders.join("\n- ");

    let thinking_part = if enable_thinking {
        "Think about the semantic meaning of the note and how it aligns with the existing folder taxonomy."
    } else { "" };

    let template = r#"Suggest the best folder(s) for this note.

Note Title: "PLACEHOLDER_TITLE"
Content Snippet:
PLACEHOLDER_CONTENT

Existing Folders:
- PLACEHOLDER_FOLDERS

Task:
1. Identify the BEST existing folder.
2. Suggest an alternative or NEW folder path if appropriate.
3. Provide a confidence score (0.0 - 1.0) for each.

Response Format (JSON ONLY):
{
  "suggestions": [
     {
       "folder": "Selected/Folder",
       "is_new_path": false,
       "confidence": 0.9,
       "reason": "Matches gardening theme."
     },
     {
       "folder": "Another/Option",
       "is_new_path": true,
       "confidence": 0.6,
       "reason": "Alternative categorization."
     }
  ]
}
PLACEHOLDER_THINKING
"#;

    let prompt = template
        .replace("PLACEHOLDER_TITLE", &file_name)
        .replace("PLACEHOLDER_CONTENT", &doc_text)
        .replace("PLACEHOLDER_FOLDERS", &folders_list)
        .replace("PLACEHOLDER_THINKING", thinking_part);

    if debug {
        web_sys::console::log_1(&format!("[DEBUG] Organization Prompt len: {}", prompt.len()).into());
    }

    let response = generate_text_ollama(
        endpoint,
        model,
        prompt,
        Some(temperature),
        true
    ).await?;

    if debug {
        web_sys::console::log_1(&format!("[DEBUG] Organization Response: {}", response).into());
    }

    // Try to find JSON in the response (LLMs sometimes add chatter)
    // Prioritize object extraction since OrganizationResult is a struct
    let json_str = extract_json_object(&response)
        .or_else(|| extract_json_array(&response))
        .unwrap_or(response.clone());

    match serde_json::from_str::<serde_json::Value>(&json_str) {
        Ok(val) => serde_wasm_bindgen::to_value(&val)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e))),
        Err(e) => {
            // Fallback: try to fix common JSON errors?
            // For now just error out
             Err(JsValue::from_str(&format!("Failed to parse organization output: {}. Response was: {}", e, response)))
        }
    }
}

/// Generate a Map of Content (MOC)
#[wasm_bindgen]
pub async fn generate_moc_with_llm(
    endpoint: String,
    model: String,
    topic: String,
    related_notes_json: String,
    temperature: f32,
    enable_thinking: bool,
    debug: bool,
) -> Result<String, JsValue> {
     if debug {
        web_sys::console::log_1(&format!("[DEBUG] generate_moc called for topic: {}", topic).into());
    }

    let notes: Vec<serde_json::Value> = serde_json::from_str(&related_notes_json)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse related notes JSON: {}", e)))?;

    // Create a summarized list of notes for the prompt
    let mut notes_list = String::new();
    for note in notes {
        if let (Some(title), Some(path)) = (note["title"].as_str(), note["path"].as_str()) {
             // Optional: Include snippet if available?
             // For MOC, title is usually enough, maybe a tiny snippet.
             // let snippet = note["context"].as_str().unwrap_or("");
             notes_list.push_str(&format!("- [[{}]] (Path: {})\n", title, path));
        }
    }

    let thinking_part = if enable_thinking {
        "THINKING PROCESS: Analyze the list of notes. Identify 3-5 main sub-themes or categories. Group the notes accordingly."
    } else { "" };

    let prompt = format!(
        r#"You are an expert Knowledge Manager. Your task is to organize a chaotic list of notes into a structured "Map of Content" (MOC) for the topic: "{}"

List of Notes to Organize:
{}

Instructions:
1. Create a structured Markdown output.
2. Group the notes into logical categories/sub-headings (e.g., ## Concepts, ## History, ## Examples).
3. Use strict Obsidian WikiLink format: [[Note Title]].
4. Write a brief 1-sentence description for each link explaining why it is in that category.
5. If a note seems irrelevant to the topic, put it in a ## Uncategorized / Related section or omit it if completely unrelated.
6. Start with a ## Overview section summarizing the collection.

Output Format (Markdown);
# {} MOC

## Overview
(Brief summary of this knowledge cluster)

## Category 1
- [[Note A]] - Description...
- [[Note B]] - Description...

## Category 2
...

{}
"#,
        topic,
        notes_list,
        topic,
        thinking_part
    );

    if debug {
        web_sys::console::log_1(&format!("[DEBUG] MOC Prompt Length: {}", prompt.len()).into());
    }

    let response = generate_text_ollama(
        endpoint,
        model,
        prompt,
        Some(temperature),
        false // Markdown output, not JSON
    ).await?;

    Ok(response)
}


/// Transcribe image content (Handwritten/Math)
#[wasm_bindgen]
pub async fn transcribe_image_with_llm(
    endpoint: String,
    model: String,
    image_base64: String,
    debug: bool,
) -> Result<String, JsValue> {
    if debug {
        web_sys::console::log_1(&format!("[DEBUG] transcribe_image_with_llm called. Model: {}", model).into());
    }

    let prompt = r#"Transcribe the text in this image to Markdown verbatim.
1. The FIRST line must be a descriptive Markdown header.
2. Output ONLY the transcription. Do not summarize or explain.
3. Use LaTeX for math ($...$).
"#.to_string();

    generate_text_with_images_ollama(
        endpoint,
        model,
        prompt,
        vec![image_base64],
        Some(0.1), // Low temp for accurate OCR
    ).await
}

/// Detect objects (diagrams/drawings) in an image and return bounding boxes
#[wasm_bindgen]
pub async fn detect_objects_with_llm(
    endpoint: String,
    model: String,
    image_base64: String,
    debug: bool,
) -> Result<String, JsValue> {
    if debug {
        web_sys::console::log_1(&format!("[DEBUG] detect_objects_with_llm called. Model: {}", model).into());
    }

    let prompt = r#"Analyze this image and identify the bounding box of the main hand-drawn diagram, chart, or schematic.
Ignore lines of text. Focus on the visual illustration.

Return the coordinates as a JSON array in the format: [ymin, xmin, ymax, xmax]
- Values should be integers from 0 to 1000 (representing 0% to 100% of height/width).
- Example: [100, 200, 500, 800] means top 10%, left 20%, bottom 50%, right 80%.
- If there is NO diagram, return "null".
- Output ONLY the JSON array. Do not include any explanation.
"#.to_string();

    generate_text_with_images_ollama(
        endpoint,
        model,
        prompt,
        vec![image_base64],
        Some(0.1), // Low temp for precision
    ).await
}
