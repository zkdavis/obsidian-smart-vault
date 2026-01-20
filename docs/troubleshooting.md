# Troubleshooting

Common issues and solutions for Smart Vault Organizer.

## Installation Issues

### Plugin won't load

**Symptoms**: Plugin doesn't appear in Community Plugins list or shows error on enable.

**Solutions**:

1. Check all required files exist:
   - `main.js`
   - `manifest.json`
   - `styles.css`
   - `pkg/` directory with WASM files

2. Rebuild the plugin:

   ```bash
   npm run build
   ```

3. Check Developer Console (Ctrl+Shift+I) for specific errors

4. Verify Obsidian version compatibility in `manifest.json`

### "Failed to initialize WASM module"

**Cause**: WASM files missing or corrupted.

**Solutions**:

1. Verify `pkg/` directory contains:
   - `obsidian_smart_vault.js`
   - `obsidian_smart_vault_bg.wasm`

2. Rebuild WASM:

   ```bash
   npm run build:wasm
   ```

3. Check browser console for specific WASM errors

## Connection Issues

### "Network error" when generating embeddings

**Cause**: Can't reach Ollama server.

**Solutions**:

1. Verify Ollama is running:

   ```bash
   ollama list
   ```

2. Test connection:

   ```bash
   curl http://localhost:11434/api/tags
   ```

3. Check endpoint URL in settings (default: `http://localhost:11434`)

4. For remote Ollama, check firewall/network settings

### "Model not found"

**Cause**: Specified model not installed in Ollama.

**Solutions**:

1. List installed models:

   ```bash
   ollama list
   ```

2. Pull required models:

   ```bash
   ollama pull nomic-embed-text
   ollama pull ministral-3:3b
   ```

3. Verify model name matches exactly in settings

## Suggestion Issues

### No suggestions appearing

**Possible Causes**:

1. **Vault not scanned**: Run `Smart Vault: Scan vault for embeddings`

2. **Threshold too high**: Lower `similarityThreshold` in settings (try 0.5)

3. **Note too short**: Ensure notes have meaningful content

4. **Cache corrupted**: Delete cache files and rescan:
   - `smart-vault-embeddings.bin`
   - `smart-vault-suggestions.json`

### Suggestions disappear after editing

**Expected behavior**: Suggestions refresh 2 seconds after you stop editing to reflect content changes.

If suggestions don't return:

1. Wait a few seconds for processing
2. Check console for errors
3. Manually trigger: `Smart Vault: Suggest links for current note`

### LLM suggestions not showing (only embedding scores)

**Causes**:

1. LLM reranking disabled - check `useLLMReranking` setting
2. LLM model not available - verify model is installed
3. LLM timeout - increase `llmTimeout` setting

Check console for specific LLM errors.

### Poor suggestion quality

**Solutions**:

1. Run a fresh vault scan to regenerate embeddings
2. Try a different embedding model
3. Enable LLM reranking for better relevance
4. Adjust similarity threshold

## Performance Issues

### Slow vault scanning

**Causes**: Large vault, slow embedding model, or network latency.

**Solutions**:

1. Use faster embedding model (`nomic-embed-text` or `all-minilm`)
2. Reduce `maxContentLength` setting
3. Increase `llmConcurrency` (if CPU/GPU allows)
4. Run scan during off-hours

### LLM requests timing out

**Solutions**:

1. Increase `llmTimeout` in settings (up to 120 seconds)
2. Use a smaller/faster LLM model
3. Reduce `llmCandidateCount`
4. Check if Ollama is overloaded with other requests

### UI feels slow/laggy

**Causes**: Too many suggestions, complex rendering.

**Solutions**:

1. Reduce `maxSuggestions` setting
2. Disable LLM reranking for faster (embedding-only) results
3. Disable debug mode if enabled

### High memory usage

**Solutions**:

1. Reduce embedding dimensions (use smaller model)
2. Clear old cache files periodically
3. Reduce `maxContentLength`

## Cache Issues

### Suggestions not updating after file changes

**Cause**: Cache not invalidating properly.

**Solutions**:

1. Wait for 2-second debounce period
2. Manually rescan: `Smart Vault: Scan vault for embeddings`
3. Delete cache files to force regeneration

### Cache files growing too large

**Solutions**:

1. Delete and regenerate: `smart-vault-embeddings.bin`
2. Use smaller embedding model (fewer dimensions)
3. Exclude large/binary files from scanning

## Vision/Handwritten Notes Issues

### Images not being processed

**Solutions**:

1. Verify vision model is installed:

   ```bash
   ollama pull minicpm-v
   ```

2. Check watch folder exists: `Inbox/Handwritten`
3. Verify image format is supported (PNG, JPG, PDF)
4. Check console for processing errors

### Poor OCR accuracy

**Solutions**:

1. Improve image quality (lighting, focus, contrast)
2. Use larger vision model (`llava:13b`)
3. Use the debug command to see enhanced images
4. Ensure handwriting is reasonably legible

## Debug Mode

Enable debug mode in settings to get detailed logging:

1. Settings → Smart Vault Organizer → Debug Mode → Enable
2. Open Developer Console (Ctrl+Shift+I)
3. Filter by `[DEBUG]`, `[WARNING]`, `[ERROR]`

**Common log patterns**:

- `[DEBUG] Computing suggestions for: ...` - Processing started
- `[DEBUG] Found X candidates above threshold` - Similarity filtering
- `[DEBUG] LLM reranking completed` - Reranking success
- `[WARNING] LLM timeout` - Need to increase timeout
- `[ERROR] Failed to ...` - Check error message for cause

## Getting Help

If you can't resolve an issue:

1. Enable debug mode and capture console output
2. Note your settings configuration
3. Check existing issues on GitHub
4. Open a new issue with:
   - Obsidian version
   - Plugin version
   - Ollama version and models
   - Console error messages
   - Steps to reproduce
