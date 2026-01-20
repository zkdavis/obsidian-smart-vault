use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DetectedLink {
    pub source: String,
    pub target: String,
    pub line: usize,
}

#[wasm_bindgen]
pub struct LinkAnalyzer;

#[wasm_bindgen]
impl LinkAnalyzer {
    #[wasm_bindgen(constructor)]
    pub fn new() -> LinkAnalyzer {
        LinkAnalyzer
    }

    pub fn extract_links(&self, content: &str) -> JsValue {
        let mut links = Vec::new();

        for (line_num, line) in content.lines().enumerate() {
            let mut chars = line.chars().peekable();
            let mut current_pos = 0;

            while current_pos < line.len() {
                if let Some(link) = self.try_parse_wiki_link(&mut chars, line, &mut current_pos) {
                    links.push((link, line_num + 1));
                }
                if chars.peek().is_some() {
                    chars.next();
                    current_pos += 1;
                }
            }
        }

        serde_wasm_bindgen::to_value(&links).unwrap()
    }

    fn try_parse_wiki_link(
        &self,
        chars: &mut std::iter::Peekable<std::str::Chars>,
        line: &str,
        pos: &mut usize,
    ) -> Option<String> {
        if line[*pos..].starts_with("[[") {
            *pos += 2;
            let start = *pos;

            while *pos < line.len() && !line[*pos..].starts_with("]]") {
                *pos += 1;
            }

            if *pos < line.len() {
                let link_text = &line[start..*pos];
                *pos += 2;

                let link = link_text.split('|').next().unwrap_or(link_text);
                return Some(link.to_string());
            }
        }
        None
    }

    pub fn find_potential_link_positions(&self, content: &str, keywords: Vec<String>) -> JsValue {
        let mut positions = Vec::new();
        let keywords_set: HashSet<String> = keywords.iter().map(|k| k.to_lowercase()).collect();

        for (line_num, line) in content.lines().enumerate() {
            let line_lower = line.to_lowercase();

            for keyword in &keywords_set {
                // Find all occurrences of the keyword in the line
                let mut search_from = 0;
                while let Some(pos) = line_lower[search_from..].find(keyword) {
                    let actual_pos = search_from + pos;

                    // Check word boundaries to avoid matching partial words
                    // e.g., "number" should not match inside "Reynolds number"
                    let is_word_start = actual_pos == 0 ||
                        !line_lower.chars().nth(actual_pos - 1).map_or(false, |c| c.is_alphanumeric());
                    let is_word_end = actual_pos + keyword.len() >= line_lower.len() ||
                        !line_lower.chars().nth(actual_pos + keyword.len()).map_or(false, |c| c.is_alphanumeric());

                    if is_word_start && is_word_end && !self.is_inside_link(line, actual_pos) {
                        positions.push(serde_json::json!({
                            "line": line_num + 1,
                            "column": actual_pos,
                            "keyword": keyword,
                            "context": line.trim(),
                        }));
                        break; // Only add first occurrence per line
                    }

                    search_from = actual_pos + 1;
                }
            }
        }

        serde_wasm_bindgen::to_value(&positions).unwrap()
    }

    fn is_inside_link(&self, line: &str, pos: usize) -> bool {
        let before = &line[..pos];
        let after = &line[pos..];

        let open_brackets = before.rfind("[[");
        let close_brackets = before.rfind("]]");

        match (open_brackets, close_brackets) {
            (Some(open), Some(close)) => open > close && after.contains("]]"),
            (Some(_), None) => after.contains("]]"),
            _ => false,
        }
    }
}
