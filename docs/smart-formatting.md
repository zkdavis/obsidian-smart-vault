# Smart Formatting

Smart Formatting analyzes your note content and provides AI-powered suggestions for grammar, structure, flashcards, and tags.

## Features

### Grammar Check

Analyzes your writing and suggests improvements for:

- Spelling and grammar errors
- Sentence structure
- Clarity and readability
- Word choice

Click "Apply" on any suggestion to automatically fix the issue in your note.

### Zettelkasten Structure

Evaluates your note against Zettelkasten principles and suggests:

- Atomic note splitting (when content covers multiple topics)
- Link opportunities (concepts that should be connected)
- Title improvements (for better discoverability)
- Missing context (background information to add)

### Flashcard Generation

Automatically generates flashcards from your note content:

- Question-answer pairs extracted from key concepts
- Cloze deletions for important terms
- Review prompts for complex topics

Click "Add Card" to append a flashcard to your note in a standard format compatible with spaced repetition plugins.

### Tag Suggestions

AI-recommended tags based on note content:

- Topic tags (main subjects covered)
- Type tags (concept, project, reference, etc.)
- Status tags (draft, review, complete)

Click "Add Tag" to insert the tag into your note's frontmatter or body.

## Usage

1. Open the Smart Vault sidebar (brain icon)
2. Click the "Formatting" tab
3. Click "Analyze" to scan the current note
4. Review suggestions in each category
5. Apply changes with the action buttons

## Configuration

| Setting | Description | Default |
| ------- | ----------- | ------- |
| `formattingModel` | Model for analysis | `ministral-3:3b` |
| `enableThinkingMode` | Better analysis with reasoning | false |

## Example Output

### Grammar Suggestions

```
Line 15: "Their going to the store" → "They're going to the store"
[Apply]

Line 23: Consider rephrasing for clarity: "The thing that makes it work is..."
[Apply]
```

### Structure Suggestions

```
This note covers multiple topics. Consider splitting:
- "Machine Learning Basics" (paragraphs 1-3)
- "Neural Network Architecture" (paragraphs 4-6)
[Create Notes]

Missing link opportunity: "gradient descent" mentioned but not linked
[Add Link]
```

### Flashcards

```
Q: What is the primary function of a neural network's activation function?
A: To introduce non-linearity, allowing the network to learn complex patterns.
[Add Card]
```

### Tags

```
Suggested tags:
#machine-learning #neural-networks #concept
[Add Tags]
```

## Tips

- Run analysis after completing a draft for best results
- Use grammar check before sharing notes
- Generate flashcards for study-focused notes
- Let AI suggest tags for consistent taxonomy

## Troubleshooting

### Analysis returns empty

- Ensure the note has sufficient content (at least a few paragraphs)
- Check that Ollama is running with the configured LLM

### Suggestions don't apply correctly

- The apply function uses text matching; if you've edited the note since analysis, re-run the analysis
- Some complex suggestions may need manual application

### Slow analysis

- Use a faster model for quicker results
- Enable thinking mode only when quality matters more than speed
