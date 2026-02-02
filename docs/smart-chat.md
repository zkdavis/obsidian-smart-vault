# Smart Chat

Smart Chat provides context-aware Q&A about your notes using RAG (Retrieval-Augmented Generation) to pull in relevant information from your vault.

## How It Works

1. **Context gathering** - Current note content is extracted
2. **RAG retrieval** - Semantically similar notes are retrieved using embeddings
3. **Prompt construction** - Your question + context is formatted for the LLM
4. **Response generation** - LLM generates a contextual answer

### Chat Modes

Smart Chat supports three distinct modes for context retrieval:

- **🛡️ Strict Mode**: Only answers using the provided context (current file or selection). High precision, zero hallucination.
- **🌍 Vault Mode**: Automatically retrieves up to 5 relevant notes from your entire vault (RAG) using semantic similarity.
- **🧠 General Mode**: Uses the LLM's general knowledge combined with any available vault context. 

## Features

### Context-Aware Responses

The chat understands your current note and can answer questions about its content, suggest improvements, or explain concepts.

### RAG Integration

When enabled, the chat automatically retrieves relevant notes from your vault to provide more informed answers. This helps when asking questions like:

- "What other notes relate to this topic?"
- "Do I have any notes about X?"
- "What did I write about Y?"

### Agentic Tools & Actions

The chat is "agentic," meaning it can understand your intent and perform actions within your vault.

#### Smart Insert
Triggered by keywords like "Insert", "Write", "Generate".
- **Command**: `Insert a paragraph about the benefits of probiotics.`
- **Action**: The AI generates relevant text and inserts it directly at your current cursor position in the active note.

#### Cross-Link Analysis
Triggered by keywords like "Compare", "Connection", "Link".
- **Command**: `Compare [[Note A]] and [[Note B]]`
- **Action**: Performs a deep semantic analysis of both notes, identifying shared themes, contradictions, and potential "bridge note" connections.

#### Vault Queries
- **Recent Files**: "What did I work on today?"
- **Pending Tasks**: "Find my TODOs from my daily notes."
- **Vault Stats**: "How many notes do I have?"

#### Context Actions (Editor)
Directly available from the file/editor context menu:
- **Summarize**: Generates a concise summary based on the note's key points.
- **Extract Outline**: Identifies the logical structure and headings.

## Usage

1. Open the Smart Vault sidebar (brain icon)
2. Click the "Chat" tab
3. Select your **Mode** (Strict, Vault, or General) from the dropdown
4. Type your question or action in the input field
5. Press Enter or click **Send**

### Example Questions

- "What is the main argument in this note?"
- "Suggest improvements to the structure"
- "Find related notes about machine learning"
- "Insert a paragraph about the history of X"
- "Compare this note with [[Other Note]]"

## Configuration

| Setting | Description | Default |
| ------- | ----------- | ------- |
| `chatModel` | Model used for chat | `ministral-3:3b` |
| `chatTemperature` | Creativity (0.0-1.0) | `0.7` |
| `enableThinkingMode` | Chain-of-thought prompting | false |

## Tips

### Better Results

- Be specific in your questions
- Reference note names with `[[brackets]]` for cross-note queries
- Use "Insert" commands to add content directly

### Performance

- Larger models give better answers but are slower
- Reduce context length if responses are slow
- Enable thinking mode for complex reasoning tasks

## Troubleshooting

### "No active markdown file"

Open a markdown note before using chat. The chat requires context from the current file.

### Slow responses

- Use a smaller/faster LLM model
- Increase timeout in settings
- Reduce the number of RAG results

### Irrelevant answers

- Be more specific in your question
- Ensure the note has sufficient content
- Run a vault scan to update embeddings
