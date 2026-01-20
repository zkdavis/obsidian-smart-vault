use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct VaultFile {
    pub path: String,
    pub content: String,
    pub modified: f64,
}

#[derive(Serialize, Deserialize)]
pub struct ScanResult {
    pub files_scanned: usize,
    pub files_updated: usize,
    pub errors: Vec<String>,
}

#[wasm_bindgen]
pub struct VaultScanner {
    files: Vec<VaultFile>,
}

#[wasm_bindgen]
impl VaultScanner {
    #[wasm_bindgen(constructor)]
    pub fn new() -> VaultScanner {
        VaultScanner {
            files: Vec::new(),
        }
    }

    pub fn add_file(&mut self, path: String, content: String, modified: f64) {
        self.files.push(VaultFile {
            path,
            content,
            modified,
        });
    }

    pub fn get_files(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.files).unwrap()
    }

    pub fn filter_markdown_files(&self) -> JsValue {
        let md_files: Vec<&VaultFile> = self.files
            .iter()
            .filter(|f| f.path.ends_with(".md"))
            .collect();

        serde_wasm_bindgen::to_value(&md_files).unwrap()
    }
}
