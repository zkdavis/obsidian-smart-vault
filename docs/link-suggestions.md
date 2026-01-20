# Link Suggestions

Smart Vault Organizer uses a two-stage system to suggest relevant links for your notes: semantic embeddings for initial candidates, followed by LLM reranking for intelligent scoring.

## How It Works

### Stage 1: Embedding Generation

Each note in your vault is converted into a semantic embedding (a vector representation) using a local embedding model via Ollama.

1. **Content extraction** - Note content is read and truncated to `maxContentLength` (default: 2000 characters)
2. **Embedding generation** - Content is sent to Ollama's embedding endpoint
3. **Caching** - Embeddings are stored in `smart-vault-embeddings.bin` with file modification times

### Stage 2: Similarity Calculation

When you open a note, the plugin calculates cosine similarity between its embedding and all other notes in your vault.

- Notes above the `similarityThreshold` (default: 0.7) become candidates
- Exact title matches are force-included regardless of score
- Already-linked notes are filtered out

### Stage 3: LLM Reranking (Optional)

If `useLLMReranking` is enabled, the top candidates are sent to an LLM for intelligent scoring:

1. **Context preparation** - Source note content + candidate summaries are formatted
2. **LLM analysis** - Model evaluates semantic relevance and provides reasoning
3. **Score extraction** - Natural language response is parsed for scores (0-10)
4. **Result merging** - LLM-ranked items appear first, followed by embedding-only candidates

## Configuration

| Setting | Description | Default |
| ------- | ----------- | ------- |
| `similarityThreshold` | Minimum embedding similarity (0-1) | 0.7 |
| `maxSuggestions` | Maximum suggestions to display | 5 |
| `useLLMReranking` | Enable AI-powered reranking | true |
| `llmCandidateCount` | Candidates sent to LLM | 5 |
| `llmTimeout` | LLM request timeout (ms) | 30000 |

## UI Features

### Sidebar Panel

- **AI Score** (when LLM enabled) - Shows relevance score with reasoning
- **Similarity** (embedding only) - Shows cosine similarity percentage
- **Insert Link** - Adds `[[note-name]]` at cursor position
- **Ignore** - Permanently hides unwanted suggestions

### Ignore System

Click the "✕ Ignore" button on any suggestion to hide it permanently. Access ignored suggestions via the "Ignored" button in the panel header to restore them if needed.

### Visual Indicators

- Items with LLM scores show a reasoning tooltip on hover
- A divider separates AI-ranked suggestions from embedding-only ones
- Warning banner appears if LLM reranking fails (with retry option)

## Caching

The plugin maintains several caches for performance:

| Cache | File | Purpose |
| ----- | ---- | ------- |
| Embeddings | `smart-vault-embeddings.bin` | Vector representations |
| Keywords | `smart-vault-keywords.json` | Extracted keywords per file |
| Suggestions | `smart-vault-suggestions.json` | Computed suggestions per file |
| Ignored | Part of suggestions cache | User-ignored suggestions |

Caches auto-invalidate when files are modified (2-second debounce).

## Troubleshooting

### No suggestions appearing

1. Run vault scan: Command Palette → `Smart Vault: Scan vault for embeddings`
2. Lower `similarityThreshold` in settings
3. Ensure notes have sufficient content

### LLM suggestions not showing

1. Verify Ollama is running with an LLM model
2. Check `llmModel` setting matches an installed model
3. Increase `llmTimeout` for slower models
4. Check Developer Console for error messages

### Suggestions disappearing after edit

This is expected behavior. The plugin refreshes suggestions 2 seconds after you stop editing to reflect content changes.
