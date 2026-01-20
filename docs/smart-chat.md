# Smart Chat

Smart Chat provides context-aware Q&A about your notes using RAG (Retrieval-Augmented Generation) to pull in relevant information from your vault.

## How It Works

1. **Context gathering** - Current note content is extracted
2. **RAG retrieval** - Semantically similar notes are retrieved using embeddings
3. **Prompt construction** - Your question + context is formatted for the LLM
4. **Response generation** - LLM generates a contextual answer

## Features

### Context-Aware Responses

The chat understands your current note and can answer questions about its content, suggest improvements, or explain concepts.

### RAG Integration

When enabled, the chat automatically retrieves relevant notes from your vault to provide more informed answers. This helps when asking questions like:

- "What other notes relate to this topic?"
- "Do I have any notes about X?"
- "What did I write about Y?"

### Agentic Tools

Smart Chat includes special commands for direct actions:

| Command | Description |
| ------- | ----------- |
| `Insert paragraph about X` | Writes content directly to your note |
| `Compare Note A and B` | Performs semantic comparison between notes |
| `Summarize` | Creates a summary of the current note |

## Usage

1. Open the Smart Vault sidebar (brain icon)
2. Click the "Chat" tab
3. Type your question in the input field
4. Press Enter or click Send

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
