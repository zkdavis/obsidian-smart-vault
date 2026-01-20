# Configuration

Complete reference for all Smart Vault Organizer settings.

## Connection Settings

### Ollama Endpoint

- **Setting**: `ollamaEndpoint`
- **Default**: `http://localhost:11434`
- **Description**: URL of your Ollama server

For remote Ollama instances:

```text
http://192.168.1.100:11434
```

## Model Settings

### Embedding Model

- **Setting**: `embeddingModel`
- **Default**: `nomic-embed-text`
- **Description**: Model used for generating semantic embeddings

Recommended options:

| Model | Dimensions | Speed | Quality |
| ----- | ---------- | ----- | ------- |
| `nomic-embed-text` | 768 | Fast | Good |
| `mxbai-embed-large` | 1024 | Slow | Better |
| `all-minilm` | 384 | Fastest | Basic |

### LLM Model

- **Setting**: `llmModel`
- **Default**: `ministral-3:3b`
- **Description**: Model used for reranking link suggestions.
- **Recommended**: `ministral-3:3b` (fast/balanced) or `qwen2.5:7b` (smarter).

### chatModel

- **Setting**: `chatModel`
- **Default**: `ministral-3:3b`
- **Description**: Model used for the Smart Chat interface.
- **Recommended**: `ministral-3:3b` for speed, `llama3.1` for depth.

### formattingModel

- **Setting**: `formattingModel`
- **Default**: `ministral-3:3b`
- **Description**: Model used for text analysis and formatting tools.

### organizationModel

- **Setting**: `organizationModel`
- **Default**: `ministral-3:3b`
- **Description**: Model used for folder recommendations.

### Recommended Models

| Model | Size | Speed | Notes |
| ----- | ---- | ----- | ----- |
| `ministral-3:3b` | 3B | Fast | Good balance (default) |
| `qwen3:8b` | 8B | Medium | Good reasoning (supports thinking) |
| `llama3:8b` | 8B | Medium | Good |
| `mistral:7b` | 7B | Fast | Good |
| `deepseek-r1:8b` | 8B | Medium | Better (reasoning model) |

### Vision Model

- **Setting**: `visionModel`
- **Default**: `ministral-3:3b`
- **Description**: Model used for handwritten note transcription

Options:

| Model | Speed | Accuracy |
| ----- | ----- | -------- |
| `ministral-3:3b` | Fast | Good |
| `ministral-3:8b` | Medium | Better |
| `qwen3-vl:7b` | Medium | Best for math/LaTeX |
| `llava:7b` | Medium | Good |
| `llava:13b` | Slow | Better |

## Link Suggestion Settings

### Similarity Threshold

- **Setting**: `similarityThreshold`
- **Default**: `0.7`
- **Range**: 0.0 - 1.0
- **Description**: Minimum embedding similarity for link suggestions

Lower values = more suggestions (potentially less relevant)
Higher values = fewer suggestions (more relevant)

### RAG Threshold (Vault Mode)

- **Setting**: `ragThresholdVault`
- **Default**: `0.5`
- **Description**: Similarity threshold for RAG retrieval in vault-focused chat

### RAG Threshold (General Mode)

- **Setting**: `ragThresholdGeneral`
- **Default**: `0.85`
- **Description**: Similarity threshold for RAG retrieval in general chat

### Max Suggestions

- **Setting**: `maxSuggestions`
- **Default**: `5`
- **Description**: Maximum suggestions to display per note

### Max Content Length

- **Setting**: `maxContentLength`
- **Default**: `2000`
- **Description**: Characters to use for embedding generation (~500 tokens)

Longer = better context but slower processing

## LLM Reranking Settings

### Enable LLM Reranking

- **Setting**: `useLLMReranking`
- **Default**: `true`
- **Description**: Use AI to re-rank suggestions by relevance

Disable for faster, embedding-only suggestions.

### LLM Candidate Count

- **Setting**: `llmCandidateCount`
- **Default**: `5`
- **Description**: Number of candidates sent to LLM for reranking

Higher = better coverage but slower and more resource-intensive

### LLM Temperature

- **Setting**: `llmTemperature`
- **Default**: `0.3`
- **Range**: 0.0 - 1.0
- **Description**: Controls LLM response randomness for reranking

Lower = more deterministic
Higher = more creative/varied

### Chat Temperature

- **Setting**: `chatTemperature`
- **Default**: `0.7`
- **Range**: 0.0 - 1.0
- **Description**: Controls creativity in Smart Chat responses

Higher default allows more natural conversation.

### LLM Timeout

- **Setting**: `llmTimeout`
- **Default**: `30000` (30 seconds)
- **Range**: 10000 - 120000
- **Description**: Maximum wait time for LLM responses

Increase for slower models or complex queries.

### LLM Concurrency

- **Setting**: `llmConcurrency`
- **Default**: `3`
- **Description**: Parallel LLM requests during vault scan

Higher = faster scans but more resource usage

## Advanced Settings

### Enable Thinking Mode

- **Setting**: `enableThinkingMode`
- **Default**: `false`
- **Description**: Enable chain-of-thought prompting

Improves reasoning quality for models that support it (qwen3, deepseek). Slower but more accurate for complex tasks.

### Enable Keyword Extraction

- **Setting**: `useKeywordExtraction`
- **Default**: `true`
- **Description**: Extract keywords for better matching

Helps with exact term matching alongside semantic similarity.

### Enable Smart Insertion

- **Setting**: `enableSmartInsertion`
- **Default**: `false`
- **Description**: Suggest where to insert links in note body

Experimental feature for suggesting link insertion points.

### Debug Mode

- **Setting**: `debugMode`
- **Default**: `false`
- **Description**: Enable verbose console logging

Useful for troubleshooting. Check Developer Console (Ctrl+Shift+I).

### Debug Folder Filter

- **Setting**: `debugFolderFilter`
- **Default**: `""` (empty, scan all)
- **Description**: Limit scanning to a specific folder (e.g., `Wiki/`)

## Vision Settings

### Handwritten Inbox

- **Setting**: `handwrittenInbox`
- **Default**: `Inbox/Handwritten`
- **Description**: Folder monitored for handwritten note images

### Transcript Folder

- **Setting**: `transcriptFolder`
- **Default**: `Inbox`
- **Description**: Output folder for transcribed notes

### Handwritten Attachments Folder

- **Setting**: `handwrittenAttachmentsFolder`
- **Default**: `Attachments/Handwritten`
- **Description**: Folder for storing processed image attachments

## Auto-Scan Settings

### Auto-Scan Enabled

- **Setting**: `autoScanEnabled`
- **Default**: `false`
- **Description**: Periodically rescan vault for new/changed files

### Scan Interval

- **Setting**: `scanInterval`
- **Default**: `30` (minutes)
- **Description**: Time between automatic scans

## Cache Files

The plugin creates these cache files in your vault root:

| File | Purpose |
| ---- | ------- |
| `smart-vault-embeddings.bin` | Binary embeddings cache |
| `smart-vault-keywords.json` | Extracted keywords |
| `smart-vault-suggestions.json` | Computed suggestions |
| `smart-vault-insertions.json` | Link insertion points |

These are auto-managed and can be safely deleted to force regeneration.

## Complete Defaults Reference

```typescript
DEFAULT_SETTINGS = {
    ollamaEndpoint: 'http://localhost:11434',
    embeddingModel: 'nomic-embed-text',
    similarityThreshold: 0.7,
    ragThresholdVault: 0.5,
    ragThresholdGeneral: 0.85,
    scanInterval: 30,
    autoScanEnabled: false,
    maxSuggestions: 5,
    maxContentLength: 2000,
    // LLM Defaults
    llmModel: 'ministral-3:3b',
    chatModel: 'ministral-3:3b',
    formattingModel: 'ministral-3:3b',
    organizationModel: 'ministral-3:3b',
    llmCandidateCount: 5,
    llmTemperature: 0.3,
    chatTemperature: 0.7,
    enableSmartInsertion: false,
    llmTimeout: 30000,
    llmConcurrency: 3,
    useKeywordExtraction: true,
    enableThinkingMode: false,
    visionModel: 'ministral-3:3b',
    handwrittenInbox: 'Inbox/Handwritten',
    transcriptFolder: 'Inbox',
    handwrittenAttachmentsFolder: 'Attachments/Handwritten',
    debugMode: false,
    debugFolderFilter: '',
}
```
