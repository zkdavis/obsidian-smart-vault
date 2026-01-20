# Smart Organization

Smart Organization analyzes your note content and suggests the best folder location based on your vault's existing structure.

## How It Works

1. **Content analysis** - The note's content, title, and any existing tags are extracted
2. **Vault structure scan** - Existing folders and their contents are analyzed
3. **AI recommendation** - LLM suggests folders based on semantic fit
4. **Confidence scoring** - Multiple candidates ranked by relevance

## Features

### Folder Recommendations

The AI analyzes your note and suggests where it belongs based on:

- Content similarity to existing notes in each folder
- Folder naming conventions
- Topic clustering
- Your vault's organizational patterns

### Multiple Candidates

Instead of a single suggestion, you get ranked options:

```
1. Projects/Machine Learning (85% confidence)
   "Contains related ML notes and similar terminology"

2. Reference/Technical (72% confidence)
   "Technical reference material folder"

3. Inbox (45% confidence)
   "Default location for unsorted notes"
```

### One-Click Move

Click "Move" on any suggestion to relocate the file immediately.

## Usage

1. Open a note you want to organize
2. Open the Smart Vault sidebar (brain icon)
3. Click the "Organization" tab
4. Click "Analyze" to get folder suggestions
5. Review candidates and click "Move" on your choice

## Configuration

| Setting | Description | Default |
| ------- | ----------- | ------- |
| `organizationModel` | Model for analysis | `ministral-3:3b` |

## Tips

### Better Suggestions

- Maintain consistent folder naming in your vault
- Group similar notes together
- Use descriptive folder names (not just "Folder1", "Misc")

### Workflow Integration

- Use for notes in your Inbox folder
- Run after completing a draft
- Batch organize multiple notes

### Folder Structure

For best results, organize your vault with clear categories:

```
Vault/
├── Projects/
│   ├── Active/
│   └── Archive/
├── Reference/
│   ├── Technical/
│   └── Personal/
├── Daily/
└── Inbox/
```

## Troubleshooting

### No suggestions appearing

- Ensure your vault has multiple folders
- Check that Ollama is running
- Verify the note has content to analyze

### Poor recommendations

- Your folder structure may be too flat
- Try adding more notes to establish patterns
- Use more descriptive folder names

### "Note already in suggested folder"

The note is already well-organized according to the AI's analysis.
