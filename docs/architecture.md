# Architecture

Technical overview of Smart Vault Organizer's architecture for contributors and advanced users.

## Overview

Smart Vault Organizer uses a hybrid TypeScript/Rust architecture:

- **TypeScript**: Obsidian plugin API, UI, event handling
- **Rust/WASM**: Performance-critical operations (similarity, LLM calls)

```text
┌─────────────────────────────────────────────────────────────┐
│                    Obsidian Plugin API                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   UI Layer   │  │   Settings   │  │    Cache     │       │
│  │  TypeScript  │  │  TypeScript  │  │  TypeScript  │       │
│  └──────┬───────┘  └──────────────┘  └──────┬───────┘       │
│         │                                    │               │
│         ▼                                    ▼               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Rust/WASM Module                        │    │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐        │    │
│  │  │ Similarity│  │    LLM    │  │   Links   │        │    │
│  │  │   lib.rs  │  │  llm.rs   │  │  links.rs │        │    │
│  │  └───────────┘  └───────────┘  └───────────┘        │    │
│  └─────────────────────────────────────────────────────┘    │
│                            │                                 │
│                            ▼                                 │
│                    ┌───────────────┐                        │
│                    │    Ollama     │                        │
│                    │   (External)  │                        │
│                    └───────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

## Directory Structure

```text
src/
├── main.ts                      # Entry point (minimal)
├── plugin/
│   ├── SmartVaultPlugin.ts      # Core plugin class
│   ├── cache/
│   │   ├── CacheManager.ts      # Cache operations
│   │   └── types.ts             # Cache type definitions
│   └── scanning/
│       ├── FileProcessor.ts     # Individual file processing
│       ├── VaultScanner.ts      # Batch vault scanning
│       └── HandwrittenNoteWatcher.ts  # Vision file watcher
├── ui/
│   ├── LinkSuggestionView.ts    # Main sidebar panel
│   ├── ConfirmModal.ts          # Confirmation dialogs
│   └── tabs/                    # Feature tabs (Chat, Formatting, etc.)
├── settings/
│   ├── types.ts                 # Settings interface
│   └── SmartVaultSettings.ts    # Settings tab UI
├── llm/
│   ├── RerankerService.ts       # LLM reranking logic
│   └── types.ts                 # LLM type definitions
├── suggest/
│   └── InlineLinkSuggest.ts     # Inline autocomplete
├── utils/
│   └── content.ts               # Content utilities
├── lib.rs                       # Rust: similarity calculations
├── llm.rs                       # Rust: LLM API integration
└── links.rs                     # Rust: link detection
```

## Component Responsibilities

### TypeScript Layer

#### SmartVaultPlugin.ts

Core plugin orchestration:

- Plugin lifecycle (onload, onunload)
- Command registration
- Event listeners (file open, modify, create, delete)
- Debouncing and deduplication
- Service coordination

#### CacheManager.ts

Persistent storage:

- Binary MessagePack serialization for embeddings
- JSON serialization for other caches
- File locking and retry logic
- Cache invalidation on file changes

#### VaultScanner.ts

Batch processing:

- Vault-wide embedding generation
- Progress tracking
- Concurrency control
- Error handling per file

#### FileProcessor.ts

Single-file operations:

- Embedding generation for one file
- LLM reranking calls
- Suggestion computation

#### LinkSuggestionView.ts

Main UI panel:

- Tabbed interface (Links, Chat, Formatting, Organization)
- Suggestion display and interaction
- Loading states and error handling

### Rust/WASM Layer

#### lib.rs

Core algorithms:

- Cosine similarity calculation
- Candidate filtering and sorting
- Keyword matching with boosting
- Title relationship detection

#### llm.rs

Ollama integration:

- Embedding generation
- LLM chat/completion calls
- Response parsing (natural language format)
- Timeout handling

#### links.rs

Link utilities:

- Existing link detection
- Link format parsing
- Wikilink extraction

## Data Flow

### Embedding Generation

```text
Note Content
    │
    ▼
TypeScript: Extract content (maxContentLength)
    │
    ▼
Rust: Call Ollama /api/embeddings
    │
    ▼
TypeScript: Cache embedding with mtime
```

### Suggestion Generation

```text
File Open Event
    │
    ▼
TypeScript: Check cache validity
    │
    ▼
Rust: Calculate similarities (lib.rs)
    │
    ▼
Rust: LLM reranking (llm.rs) [if enabled]
    │
    ▼
TypeScript: Cache and display results
```

### LLM Reranking

```text
Candidates (top N by embedding)
    │
    ▼
Rust: Format prompt with source + candidates
    │
    ▼
Rust: Call Ollama /api/generate
    │
    ▼
Rust: Parse natural language response
    │
    "Document 1: 8/10 - Strong topical connection..."
    │
    ▼
TypeScript: Merge LLM scores with embedding scores
```

## Caching Strategy

### Embeddings Cache

- **Format**: MessagePack binary
- **Key**: File path
- **Value**: Embedding vector + mtime
- **Invalidation**: File modification

### Suggestions Cache

- **Format**: JSON
- **Key**: File path
- **Value**: Suggestions array + timestamp
- **Invalidation**: Source file change, linked file change, 2s debounce

### LLM Reranking Cache

- **Format**: In-memory Map
- **Key**: Hash of (source path + candidate paths)
- **TTL**: 60 seconds
- **Purpose**: Prevent duplicate LLM calls

## Performance Considerations

### WASM Benefits

- Cosine similarity: ~10x faster than pure JS
- Batch processing: Parallel iteration in Rust
- Memory efficiency: Direct array operations

### Caching Benefits

- Binary cache: 2.4x faster load, 53% smaller files
- Suggestions cache: Instant display on file open
- LLM cache: Prevents redundant API calls

### Debouncing

- File modify events: 2s debounce
- File open events: 500ms deduplication
- LLM requests: In-flight request tracking

## Build System

### WASM Build

```bash
wasm-pack build --target web --out-dir pkg
```

Outputs:

- `pkg/obsidian_smart_vault.js` - JS bindings
- `pkg/obsidian_smart_vault_bg.wasm` - WASM binary

### TypeScript Build

```bash
esbuild src/main.ts --bundle --outfile=main.js
```

### Full Build

```bash
npm run build  # Runs both WASM and TypeScript builds
```

## Testing

### Manual Testing

1. Build plugin: `npm run build`
2. Reload in Obsidian
3. Check Developer Console for errors
4. Test with debug mode enabled

### Debug Mode

Enable in settings to see:

- Detailed logging of all operations
- Timing information
- Cache hit/miss statistics
- LLM request/response details

## Extension Points

### Adding a New Tab

1. Create tab class in `src/ui/tabs/`
2. Implement render and event handlers
3. Register in `LinkSuggestionView.ts`

### Adding a New LLM Feature

1. Add Rust function in `llm.rs`
2. Export via `wasm-bindgen`
3. Call from TypeScript service layer

### Adding a New Setting

1. Add to interface in `src/settings/types.ts`
2. Add default in `DEFAULT_SETTINGS`
3. Add UI in `SmartVaultSettings.ts`
