# Handwritten Notes (Vision)

Smart Vault can automatically transcribe handwritten notes from images using vision-capable LLMs.

## How It Works

1. **Watch folder monitoring** - Images placed in `Inbox/Handwritten` are detected
2. **Image enhancement** - Contrast boost and sharpening improve OCR accuracy
3. **Vision LLM processing** - Image is sent to a vision model for transcription
4. **Markdown generation** - Clean markdown note created with extracted text

## Features

### Automatic Processing

Drop images into the watch folder and they're automatically transcribed:

- Supported formats: PNG, JPG, JPEG, PDF
- Multi-page PDFs are processed page by page
- Results saved as markdown notes

### Multi-Page Support

For multi-page documents:

- Up to 5 pages automatically stitched together
- Maintains reading order
- Single output file with page breaks

### Image Enhancement

Pre-processing improves accuracy:

- Contrast boosting for faded writing
- Sharpening for clearer text edges
- High-resolution rendering (3.5x scale for PDFs)

### Output Format

Generated notes include:

```yaml
---
source: "[[original-image.jpg]]"
created: 2024-01-15
type: handwritten
---

# AI-Generated Title

Transcribed content here...
```

## Setup

### 1. Install a Vision Model

```bash
ollama pull ministral-3:3b
# or for better accuracy:
ollama pull ministral-3:8b
```

### 2. Configure Settings

In Smart Vault settings:

- **Vision Model**: Set to your installed model (default: `ministral-3:3b`)
- **Handwritten Inbox**: Watch folder (default: `Inbox/Handwritten`)
- **Transcript Folder**: Output folder (default: `Inbox`)

### 3. Create Watch Folder

Create the folder in your vault:

```
Vault/
└── Inbox/
    └── Handwritten/
```

## Usage

### Automatic Mode

1. Drop image files into `Inbox/Handwritten`
2. Wait for processing (check status in sidebar)
3. Find transcribed note in the same folder

### Manual Mode

1. Open an image file in Obsidian
2. Command Palette → `Smart Vault: Process Current File (Debug)`
3. Check console for processing details

## Recommended Models

| Model | Speed | Accuracy | Best For |
| ----- | ----- | -------- | -------- |
| `ministral-3:3b` | Fast | Good | General handwriting (default) |
| `ministral-3:8b` | Medium | Better | High accuracy |
| `qwen3-vl:7b` | Medium | Best | Math/LaTeX content |
| `llava:7b` | Medium | Good | Mixed content |
| `llava:13b` | Slow | Better | Complex documents |

## Configuration

| Setting | Description | Default |
| ------- | ----------- | ------- |
| `visionModel` | Model for OCR | `ministral-3:3b` |
| `handwrittenInbox` | Folder to monitor | `Inbox/Handwritten` |
| `transcriptFolder` | Output folder | `Inbox` |
| `handwrittenAttachmentsFolder` | Attachments storage | `Attachments/Handwritten` |

## Tips

### Better Accuracy

- Use good lighting when photographing notes
- Keep handwriting reasonably neat
- Avoid heavy shadows or glare
- Use high contrast paper/ink combinations

### Batch Processing

- Drop multiple images at once
- They'll be processed sequentially
- Check console for progress

### Debugging

Use the debug command to see:

- Processing time per page
- Enhanced image artifacts (`debug_page1.jpg`)
- Detailed console output

## Troubleshooting

### No transcription appearing

1. Check that the vision model is installed: `ollama list`
2. Verify the watch folder exists
3. Check Developer Console for errors

### Poor transcription quality

- Try a larger vision model
- Improve image quality (lighting, focus)
- Use the debug command to see enhanced images

### Processing hangs

- Vision models can be slow; wait for completion
- Check Ollama isn't overloaded with other requests
- Reduce image resolution if very large

### Collision errors

Files are automatically renamed if a note with the same name exists. Check for numbered suffixes (e.g., `note-1.md`).
