use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct OllamaEmbeddingRequest {
    pub model: String,
    pub prompt: String,
}

#[derive(Serialize, Deserialize)]
pub struct OllamaEmbeddingResponse {
    pub embedding: Vec<f32>,
}

#[wasm_bindgen]
pub async fn generate_embedding_ollama(
    endpoint: String,
    model: String,
    text: String,
) -> Result<JsValue, JsValue> {
    let request = OllamaEmbeddingRequest {
        model,
        prompt: text,
    };

    let client = gloo_net::http::Request::post(&format!("{}/api/embeddings", endpoint))
        .json(&request)
        .map_err(|e| JsValue::from_str(&format!("Request error: {}", e)))?;

    let response = client
        .send()
        .await
        .map_err(|e| JsValue::from_str(&format!("Network error: {}", e)))?;

    // Check if response is successful
    if !response.ok() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(JsValue::from_str(&format!("HTTP {}: {}", status, error_text)));
    }

    let embedding_response: OllamaEmbeddingResponse = response
        .json()
        .await
        .map_err(|e| JsValue::from_str(&format!("Parse error: {}", e)))?;

    serde_wasm_bindgen::to_value(&embedding_response.embedding)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}
