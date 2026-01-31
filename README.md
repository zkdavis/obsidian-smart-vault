# Smart Vault Organizer

An Obsidian plugin powered by Rust/WebAssembly that uses local LLMs to intelligently organize your notes with semantic embeddings, AI-powered link suggestions, contextual chat, and smart formatting tools.

Development included the use of LLMs. 

## Features

### Link Suggestions

- **Semantic Embeddings** - Generate embeddings for your vault using local LLMs (Ollama)
- **LLM Reranking** - AI ranks suggestions by relevance with explanations
- **Sidebar Panel** - View and manage suggestions for the current note
- **Ignore System** - Hide unwanted suggestions permanently

### Smart Chat

- **Context-Aware Q&A** - Ask questions about your current note
- **RAG Integration** - Automatically retrieves relevant notes from your vault
- **Agentic Tools** - Execute actions: perform semantic comparisons, insert generated text directly into notes, summaries, and outlines

### Smart Formatting

- **Grammar Check** - Get writing improvement suggestions
- **Zettelkasten Structure** - Analyze note structure and get recommendations
- **Flashcard Generation** - Auto-generate flashcards from note content
- **Tag Suggestions** - AI-recommended tags based on content

### Smart Organization

- **Folder Recommendations** - AI suggests where to file your notes
- **Confidence Scoring** - Multiple candidates ranked by relevance

### Handwritten Notes (Vision)

- **Watch Folder** - Auto-process images in `Inbox/Handwritten`
- **Multi-Page Support** - Stitch up to 5 pages together
- **OCR with Vision Models** - Extract text from handwritten notes
- **Image Enhancement** - Pre-processing for better accuracy

## Prerequisites

1. **Rust & Cargo** (latest stable)

   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **wasm-pack**

   ```bash
   cargo install wasm-pack
   ```

3. **Node.js** (v16+) - [nodejs.org](https://nodejs.org/)

4. **Ollama** - [ollama.ai](https://ollama.ai/)

   ```bash
   ollama pull nomic-embed-text
   ollama pull ministral-3:3b
   ```

## Installation

### Build from Source

```

### Install from Community Plugins

1. Open **Settings** > **Community Plugins**
2. Turn off **Safe Mode**
3. Click **Browse** and search for **Smart Vault Organizer**
4. Click **Install** -> **Enable**

### Build from Source

```bash
cd /path/to/your/vault/.obsidian/plugins
git clone https://github.com/zkdavis/obsidian-smart-vault.git smart-vault-organizer
cd smart-vault-organizer
npm install
npm run build
```

### Install to Vault

#### Copy files

```bash
mkdir -p /path/to/vault/.obsidian/plugins/smart-vault-organizer
cp main.js manifest.json styles.css /path/to/vault/.obsidian/plugins/smart-vault-organizer/
cp -r pkg /path/to/vault/.obsidian/plugins/smart-vault-organizer/
```

#### Symlink (for development)

```bash
# macOS/Linux
ln -s /path/to/obsidian_app /path/to/vault/.obsidian/plugins/smart-vault-organizer

# Windows (PowerShell as Admin)
New-Item -ItemType SymbolicLink -Path "C:\vault\.obsidian\plugins\smart-vault-organizer" -Target "C:\path\to\obsidian_app"
```

### Enable in Obsidian

1. Settings → Community Plugins → Disable Safe Mode
2. Reload plugins
3. Enable "Smart Vault Organizer"

## Quick Start

1. **Configure** - Settings → Smart Vault Organizer
   - Verify Ollama endpoint (`http://localhost:11434`)
   - Set embedding model (`nomic-embed-text`)
   - Set LLM model (`ministral-3:3b`)

2. **Scan Vault** - Command Palette → `Smart Vault: Scan vault for embeddings`

3. **Get Suggestions** - Open any note and click the brain icon in the ribbon

## Configuration

| Setting | Description | Default |
| ------- | ----------- | ------- |
| Ollama Endpoint | URL of Ollama server | `http://localhost:11434` |
| Embedding Model | Model for embeddings | `nomic-embed-text` |
| LLM Model | Model for reranking | `ministral-3:3b` |
| Chat Model | Model for Smart Chat | `ministral-3:3b` |
| Formatting Model | Model for Smart Formatting | `ministral-3:3b` |
| Organization Model | Model for Smart Organization | `ministral-3:3b` |
| Vision Model | Model for handwritten notes | `ministral-3:3b` |
| Similarity Threshold | Minimum score (0-1) | 0.7 |
| Max Suggestions | Suggestions to show | 5 |
| Max Content Length | Characters for embeddings | 2000 |
| LLM Reranking | Enable AI ranking | true |
| LLM Candidate Count | Candidates sent to LLM | 5 |
| LLM Temperature | Reranking randomness | 0.3 |
| Chat Temperature | Chat creativity | 0.7 |
| LLM Timeout | Request timeout (ms) | 30000 |
| LLM Concurrency | Parallel requests during scan | 3 |
| Thinking Mode | Chain-of-thought for qwen3/deepseek | false |
| Keyword Extraction | Extract keywords for matching | true |
| Handwritten Inbox | Watch folder for images | `Inbox/Handwritten` |
| Transcript Folder | Output folder for transcripts | `Inbox` |

## Documentation

See the [docs/](docs/) folder for detailed guides:

- [Link Suggestions](docs/link-suggestions.md) - Embedding and reranking system
- [Smart Chat](docs/smart-chat.md) - RAG-based Q&A
- [Smart Formatting](docs/smart-formatting.md) - Grammar, flashcards, tags
- [Smart Organization](docs/smart-organization.md) - Folder recommendations
- [Handwritten Notes](docs/handwritten-notes.md) - Vision OCR setup
- [Configuration](docs/configuration.md) - All settings explained
- [Architecture](docs/architecture.md) - Technical deep-dive
- [Troubleshooting](docs/troubleshooting.md) - Common issues

## Development

### Project Structure

```text
src/
├── main.ts                 # Entry point
├── plugin/
│   ├── SmartVaultPlugin.ts # Core plugin
│   ├── cache/              # Cache management
│   └── scanning/           # Vault scanning, file processing
├── ui/
│   ├── LinkSuggestionView.ts # Main sidebar panel
│   └── tabs/               # Smart Chat, Formatting, Organization tabs
├── settings/               # Settings UI and types
├── llm/                    # LLM reranking service
├── suggest/                # Inline autocomplete
├── lib.rs                  # Rust: similarity calculations
├── llm.rs                  # Rust: LLM integration
└── links.rs                # Rust: link detection
```

### Commands

```bash
npm run build         # Full build (WASM + TypeScript)
npm run build:wasm    # Build Rust/WASM only
npm run build:plugin  # Build TypeScript only
npm run dev           # Watch mode
npx tsc --noEmit      # Type check
```

### Recommended Models

| Model | Use Case | Size |
| ----- | -------- | ---- |
| `nomic-embed-text` | Embeddings (fast, quality) | 768-dim |
| `mxbai-embed-large` | Embeddings (higher quality) | 1024-dim |
| `ministral-3:3b` | All tasks (default) | 3B |

## Troubleshooting

### Plugin won't load

- Check Developer Console (Ctrl+Shift+I) for errors
- Verify all files exist: `main.js`, `manifest.json`, `styles.css`, `pkg/`

### "Failed to initialize WASM module"

- Ensure `pkg/` directory contains `.wasm` file
- Run `npm run build` again

### No suggestions appearing

- Run vault scan first
- Check Ollama is running: `ollama list`
- Lower similarity threshold in settings

### LLM timeout errors

- Increase timeout in settings (up to 120s)
- Use a faster model
- Reduce LLM candidate count

## Contributing

Contributions welcome! Please ensure:

- Rust code passes `cargo clippy`
- TypeScript follows existing style
- Test with a real Obsidian vault

## Support
 
If you find this plugin useful, please consider supporting development:
 
- [GitHub Sponsors](https://github.com/sponsors/zkdavis)
- [Ko-fi](https://ko-fi.com/zkdavis)
- [Buy Me a Coffee](https://www.buymeacoffee.com/zkdavis)
 
## License

MIT License - See LICENSE file

## Acknowledgments

- Built with [wasm-bindgen](https://github.com/rustwasm/wasm-bindgen)
- Embeddings via [Ollama](https://ollama.ai/)
- Inspired by the Obsidian community
