import { ItemView, WorkspaceLeaf, TFile, MarkdownView, Notice, Editor, Modal } from 'obsidian';
import type SmartVaultPlugin from '../plugin/SmartVaultPlugin';
import { ChatTab } from './tabs/ChatTab';
import { FormattingTab } from './tabs/FormattingTab';
import { OrganizationTab } from './tabs/OrganizationTab';
import { SuggestionTab } from './tabs/SuggestionTab';
import { BaseTab } from './tabs/BaseTab';

export const VIEW_TYPE_LINK_SUGGESTIONS = 'smart-vault-link-suggestions';

/**
 * Interface for a link suggestion
 */
export interface LinkSuggestion {
    path: string;
    title: string;
    similarity: number;
    context: string;
    llm_score?: number;
    llm_reason?: string;
}

/**
 * Interface for insertion point
 */
interface InsertionPoint {
    line: number;
    ch: number;
    originalText: string;
    linkText: string;
    useSeeAlso: boolean;
    reason?: string;
    originalLine?: string; // for preview restoration
}

/**
 * Main UI panel for displaying link suggestions.
 */
export class LinkSuggestionView extends ItemView {
    plugin: SmartVaultPlugin;
    currentFile: TFile | null = null;
    currentSuggestions: LinkSuggestion[] = [];
    allDocumentSuggestions: Map<string, LinkSuggestion[]> = new Map();
    // Track documents where LLM reranking failed (for visual warning)
    llmFailedDocuments: Map<string, string> = new Map();
    // Track LLM scanning progress
    llmScanningInProgress: boolean = false;
    llmScanningTotal: number = 0;
    llmScanningCompleted: number = 0;

    // Tabs
    activeTab: string = 'suggestions';
    tabs: Map<string, BaseTab> = new Map();
    tabContentContainer: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: SmartVaultPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_LINK_SUGGESTIONS;
    }

    getDisplayText(): string {
        return 'Link Suggestions';
    }

    getIcon(): string {
        return 'link';
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('smart-vault-suggestions');

        this.render();
        await Promise.resolve();
    }

    async updateForFile(file: TFile) {
        this.currentFile = file;

        // Propagate to all tabs
        this.tabs.forEach(tab => tab.setFileContext(file));

        try {
            // Check if plugin is initialized
            if (!this.plugin.smartVault) {
                if (this.plugin.settings.debugMode) {
                    console.debug('Smart Vault not initialized yet, skipping update');
                }
                return;
            }

            const content = await this.app.vault.read(file);

            // Check if we already have suggestions cached (including empty arrays)
            const cachedSuggestions = this.allDocumentSuggestions.get(file.path);

            // If we have cached suggestions (even if empty), use them
            if (cachedSuggestions !== undefined) {
                if (this.plugin.settings.debugMode) {
                    console.debug(`[DEBUG] Using cached suggestions for ${file.path} (${cachedSuggestions.length} suggestions)`);
                }
                this.setSuggestions(cachedSuggestions, file);
                return;
            }

            if (this.plugin.settings.debugMode) {
                console.debug(`[DEBUG] No cached suggestions for ${file.path}, will check for embedding`);
            }

            // No cache entry - check if we have an embedding and regenerate suggestions
            if (this.plugin.smartVault.has_embedding(file.path)) {
                if (this.plugin.settings.debugMode) {
                    console.debug(`Generating suggestions from existing embedding for ${file.path}`);
                }

                // Use the existing embedding instead of regenerating
                const embedding = this.plugin.smartVault.get_embedding(file.path);

                // SKIP LLM if Manual Rerank is ON
                const skipLLM = this.plugin.settings.manualLLMRerank;

                if (this.plugin.settings.debugMode && skipLLM) {
                    console.debug(`[DEBUG] Manual Rerank ON: Skipping auto-LLM rerank for ${file.path}`);
                }

                const suggestions = await this.plugin.getSuggestionsForFile(file, content, Array.from(embedding), skipLLM);

                // Cache the suggestions
                this.allDocumentSuggestions.set(file.path, suggestions);

                // Save suggestions to disk
                await this.plugin.saveSuggestions();

                this.setSuggestions(suggestions, file);
                return;
            }

            // No embedding exists - just render empty state
            if (this.plugin.settings.debugMode) {
                console.debug(`No embedding found for ${file.path}`);
            }
            this.setSuggestions([], file);
        } catch (error) {
            console.error('Error updating suggestions:', error);
        }
    }

    setSuggestions(suggestions: LinkSuggestion[], file: TFile) {
        this.currentSuggestions = suggestions;
        this.currentFile = file;
        this.render();
    }

    /**
     * Start LLM scanning indicator
     */
    startLLMScanning(totalFiles: number) {
        this.llmScanningInProgress = true;
        this.llmScanningTotal = totalFiles;
        this.llmScanningCompleted = 0;
        this.render();
    }

    /**
     * Update LLM scanning progress
     */
    updateLLMScanningProgress(completed: number) {
        this.llmScanningCompleted = completed;
        this.render();
    }

    /**
     * Stop LLM scanning indicator
     */
    stopLLMScanning() {
        this.llmScanningInProgress = false;
        this.llmScanningTotal = 0;
        this.llmScanningCompleted = 0;
        this.render();
    }

    render() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('smart-vault-view');

        // Render Tab Headers
        const header = container.createDiv({ cls: 'smart-vault-tab-header' });

        const tabs = [
            { id: 'suggestions', icon: 'link', name: 'Links' },
            { id: 'chat', icon: 'message-square', name: 'Chat' },
            { id: 'formatting', icon: 'pencil', name: 'Format' },
            { id: 'organization', icon: 'folder', name: 'Organize' }
        ];

        tabs.forEach(tab => {
            const btn = header.createEl('button', {
                cls: `smart-vault-tab-btn ${this.activeTab === tab.id ? 'active' : ''}`
            });
            // btn.createSpan({ cls: 'smart-vault-tab-icon', text: tab.icon }); // If using lucide icons?
            // setIcon(btn, tab.icon); // requires importing setIcon
            btn.setText(tab.name);

            btn.onclick = () => {
                this.activeTab = tab.id;
                this.render();
            };
        });

        // Tab Content Container
        this.tabContentContainer = container.createDiv({ cls: 'smart-vault-tab-content' });

        // Instantiate tabs if needed (lazy or on refresh?) 
        // Better to re-instantiate or reuse? Reusing is better for state.
        if (this.tabs.size === 0) {
            this.tabs.set('suggestions', new SuggestionTab(this.app, this.plugin, this.tabContentContainer, this));
            this.tabs.set('chat', new ChatTab(this.app, this.plugin, this.tabContentContainer));
            this.tabs.set('formatting', new FormattingTab(this.app, this.plugin, this.tabContentContainer));
            this.tabs.set('organization', new OrganizationTab(this.app, this.plugin, this.tabContentContainer));
        } else {
            // Update container for all tabs (since it was recreated)
            this.tabs.forEach(t => t.containerEl = this.tabContentContainer!);
        }

        // Render Active Tab
        const activeTabObj = this.tabs.get(this.activeTab);
        if (activeTabObj) {
            // Ensure context is set before rendering
            if (this.currentFile) {
                activeTabObj.setFileContext(this.currentFile);
            }
            activeTabObj.render();
        }
    }

    openChatWithFiles(files: TFile[]) {
        this.activeTab = 'chat';
        this.render(); // Ensure tabs are instantiated and active tab is switched

        const chatTab = this.tabs.get('chat');
        if (chatTab && chatTab instanceof ChatTab) {
            chatTab.setContextFiles(files);
        }
    }

    openChatWithAction(files: TFile[], actionPrompt: string) {
        this.activeTab = 'chat';
        this.render();

        const chatTab = this.tabs.get('chat');
        if (chatTab && chatTab instanceof ChatTab) {
            chatTab.setContextFiles(files);
            // Wait slightly for UI to settle?
            setTimeout(() => {
                chatTab.runQuery(actionPrompt);
            }, 100);
        }
    }

    renderSuggestionsToContainer(container: HTMLElement) {
        container.empty();

        // Show LLM scanning indicator if in progress
        if (this.llmScanningInProgress) {
            const scanningIndicator = container.createDiv({ cls: 'smart-vault-llm-scanning' });
            const progress = this.llmScanningTotal > 0
                ? ` (${this.llmScanningCompleted}/${this.llmScanningTotal})`
                : '';
            scanningIndicator.createSpan({ text: `🤖 AI ranking in progress${progress}...` });
        }

        // Header with title and action buttons
        const header = container.createDiv({ cls: 'suggestion-panel-header' });
        header.createEl('h4', { text: 'Link suggestions' });

        const actionsDiv = header.createDiv({ cls: 'suggestion-header-actions' });

        // View Ignored button (Icon only)
        const viewIgnoredButton = actionsDiv.createEl('button', {
            text: '👁',
            cls: 'suggestion-button-secondary suggestion-mini-btn',
            attr: { title: 'View ignored suggestions' }
        });
        viewIgnoredButton.onclick = async () => {
            this.showIgnoredSuggestionsModal();
        };

        if (this.currentFile) {
            // "Rerank AI" Button (Only if LLM Reranking is Enabled)
            if (this.plugin.settings.useLLMReranking) {
                const rerankBtn = actionsDiv.createEl('button', {
                    text: '✨ AI',
                    cls: 'suggestion-button suggestion-mini-btn',
                    attr: { title: 'Manually trigger LLM reranking' }
                });
                rerankBtn.onclick = () => {
                    void (async () => {
                        if (!this.currentFile) return;
                        rerankBtn.disabled = true;
                        rerankBtn.textContent = '...';
                        try {
                            const content = await this.app.vault.read(this.currentFile);
                            // Force LLM = true (pass skipLLM=false), Force Refresh = true
                            const suggestions = await this.plugin.getSuggestionsForFile(this.currentFile, content, undefined, false, true);
                            this.allDocumentSuggestions.set(this.currentFile.path, suggestions);
                            await this.plugin.saveSuggestions();
                            this.setSuggestions(suggestions, this.currentFile);
                        } catch (e) {
                            console.error("Manual rerank failed", e);
                            new Notice("Manual rerank failed: " + e);
                        } finally {
                            rerankBtn.disabled = false;
                            rerankBtn.textContent = '✨ AI';
                        }
                    })();
                };
            }

            const refreshButton = actionsDiv.createEl('button', {
                text: '↻',
                cls: 'suggestion-button suggestion-mini-btn',
                attr: { title: 'Refresh embeddings (vector only)' }
            });
            refreshButton.onclick = () => {
                void (async () => {
                    if (this.plugin.settings.debugMode) {
                        console.log('[DEBUG] Refresh button clicked!');
                    }
                    refreshButton.disabled = true;
                    refreshButton.addClass('spinning');
                    try {
                        // Try to get the active view, but fall back to using this.currentFile
                        let view = this.app.workspace.getActiveViewOfType(MarkdownView);

                        // If no active view, try to find the leaf with our current file
                        if (!view && this.currentFile) {
                            const leaves = this.app.workspace.getLeavesOfType('markdown');
                            for (const leaf of leaves) {
                                const leafView = leaf.view;
                                if (leafView instanceof MarkdownView && leafView.file?.path === this.currentFile.path) {
                                    view = leafView;
                                    break;
                                }
                            }
                        }

                        if (view && view.file) {
                            // Clear cached suggestions to force regeneration
                            this.allDocumentSuggestions.delete(view.file.path);
                            await this.plugin.suggestLinksForCurrentNote(view);
                            // Refresh our view in case suggestLinks didn't trigger it (it usually does via events)
                            const suggestions = this.allDocumentSuggestions.get(view.file.path);
                            if (suggestions) this.setSuggestions(suggestions, view.file);

                        } else if (this.currentFile) {
                            // Fallback refesh by file
                            const content = await this.app.vault.read(this.currentFile);
                            const embedding = await this.plugin.fileProcessor!.rerankerService.generateEmbedding(content); // force regen embedding
                            const skipLLM = this.plugin.settings.manualLLMRerank;
                            const suggestions = await this.plugin.getSuggestionsForFile(this.currentFile, content, embedding, skipLLM);
                            this.allDocumentSuggestions.set(this.currentFile.path, suggestions);
                            this.setSuggestions(suggestions, this.currentFile);
                        }

                    } catch (error) {
                        console.error("Refresh failed", error);
                    } finally {
                        refreshButton.disabled = false;
                        refreshButton.removeClass('spinning');
                    }
                })();
            };
        }


        if (!this.currentFile) {
            container.createEl('p', { text: 'Open a note to see suggestions', cls: 'smart-vault-empty' });
            return;
        }

        // Current file suggestions
        const currentSection = container.createDiv({ cls: 'suggestion-section' });
        currentSection.createEl('h5', { text: `Current: ${this.currentFile.basename}` });

        // Show LLM failure warning if this document had a timeout
        const llmFailureReason = this.llmFailedDocuments.get(this.currentFile.path);
        if (llmFailureReason) {
            const warningDiv = currentSection.createDiv({ cls: 'smart-vault-llm-warning' });
            warningDiv.createEl('span', { text: '⚠️ ' });
            warningDiv.createEl('span', {
                text: `LLM reranking failed: ${llmFailureReason}. Showing embedding-only results.`,
                cls: 'warning-text'
            });
            const retryBtn = warningDiv.createEl('button', {
                text: '↻ Retry',
                cls: 'suggestion-button-secondary smart-vault-label-tag'
            });
            retryBtn.onclick = () => {
                void (async () => {
                    retryBtn.disabled = true;
                    retryBtn.textContent = 'Retrying...';
                    try {
                        if (this.plugin.settings.debugMode) {
                            console.log(`[DEBUG] Retry button clicked for: ${this.currentFile!.path}`);
                        }
                        // Clear the failure and suggestion cache to force regeneration
                        this.llmFailedDocuments.delete(this.currentFile!.path);
                        this.allDocumentSuggestions.delete(this.currentFile!.path);
                        if (this.plugin.settings.debugMode) {
                            console.log(`[DEBUG] Cleared failure tracking and suggestion cache for: ${this.currentFile!.path}`);
                        }

                        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                        if (view && view.file) {
                            if (this.plugin.settings.debugMode) {
                                console.log(`[DEBUG] Found active view, calling refreshCurrentDocument...`);
                            }
                            await this.plugin.refreshCurrentDocument(view);
                            if (this.plugin.settings.debugMode) {
                                console.log(`[DEBUG] refreshCurrentDocument completed`);
                            }
                        } else {
                            if (this.plugin.settings.debugMode) {
                                console.log(`[DEBUG] No active markdown view found!`);
                            }
                        }
                    } catch (error) {
                        console.error('Retry failed:', error);
                    } finally {
                        retryBtn.disabled = false;
                        retryBtn.textContent = '↻ Retry';
                    }
                })();
            };
        }

        if (this.currentSuggestions.length === 0) {
            const emptyDiv = currentSection.createDiv({ cls: 'smart-vault-empty' });

            // Check if vault has embeddings (not just files)
            const embeddingCount = this.plugin.smartVault.get_embedding_count();

            if (embeddingCount === 0) {
                emptyDiv.createEl('p', { text: 'Vault has not been scanned yet.' });
                const scanButton = emptyDiv.createEl('button', {
                    text: 'Scan Vault Now',
                    cls: 'suggestion-button mod-cta'
                });
                scanButton.onclick = () => {
                    void (async () => {
                        scanButton.disabled = true;
                        scanButton.textContent = 'Scanning...';
                        try {
                            await this.plugin.scanVault();
                        } finally {
                            scanButton.disabled = false;
                            scanButton.textContent = 'Scan vault now';
                        }
                    })();
                };
            } else {
                emptyDiv.createEl('p', { text: 'No suggestions found for this note.' });
            }
        } else {
            const list = currentSection.createEl('div', { cls: 'smart-vault-suggestion-list' });

            if (this.plugin.settings.debugMode) {
                console.debug(`[DEBUG] Rendering ${this.currentSuggestions.length} suggestions (max: ${this.plugin.settings.maxSuggestions})`);
                console.debug(`[DEBUG] Current suggestions:`, this.currentSuggestions);
            }

            let renderedCount = 0;
            // Filter out ignored suggestions
            const filteredSuggestions = this.currentSuggestions.filter(suggestion => {
                const isIgnored = this.plugin.cacheManager!.isIgnored(this.currentFile!.path, suggestion.path);
                if (isIgnored && this.plugin.settings.debugMode) {
                    console.debug(`[DEBUG] Filtering out ignored suggestion: ${suggestion.title}`);
                }
                return !isIgnored;
            });

            // Track if we've shown the embedding-only divider
            let shownEmbeddingDivider = false;
            const hasLLMSuggestions = filteredSuggestions.some(s => s.llm_score !== undefined);

            filteredSuggestions.slice(0, this.plugin.settings.maxSuggestions).forEach((suggestion, index) => {
                if (this.plugin.settings.debugMode) {
                    console.debug(`[DEBUG] Rendering suggestion ${index + 1}: ${suggestion.title}, similarity=${suggestion.similarity}, llm_score=${suggestion.llm_score}`);
                }

                // Add section divider when transitioning from LLM-ranked to embedding-only
                if (hasLLMSuggestions && !shownEmbeddingDivider && suggestion.llm_score === undefined) {
                    shownEmbeddingDivider = true;
                    const divider = list.createEl('div', { cls: 'embedding-only-divider' });
                    divider.createEl('span', { text: '📊 Embedding-only suggestions (not AI-ranked)' });
                }

                this.renderSuggestionItem(list, suggestion, this.currentFile!);
                renderedCount++;
            });

            if (this.plugin.settings.debugMode) {
                console.debug(`[DEBUG] Filtered ${this.currentSuggestions.length - filteredSuggestions.length} ignored, rendered ${renderedCount} suggestions to DOM`);
            }
        }

        // Other documents with suggestions
        if (this.plugin.settings.debugMode) {
            console.debug(`[DEBUG] Rendering other documents section: allDocumentSuggestions.size=${this.allDocumentSuggestions.size}`);
        }

        if (this.allDocumentSuggestions.size > 0) {
            const otherSection = container.createDiv({ cls: 'suggestion-section' });
            otherSection.createEl('h5', { text: 'Other Documents with Suggestions' });

            const otherList = otherSection.createEl('div', { cls: 'smart-vault-other-docs' });

            // Show up to 10 other documents
            let count = 0;
            for (const [path, suggestions] of this.allDocumentSuggestions) {
                if (count >= 10) break;
                if (path === this.currentFile.path || suggestions.length === 0) continue;

                if (this.plugin.settings.debugMode && count === 0) {
                    console.debug(`[DEBUG] Showing other doc: ${path} (${suggestions.length} suggestions)`);
                }

                const docItem = otherList.createDiv({ cls: 'other-doc-item' });
                const file = this.app.vault.getAbstractFileByPath(path);
                const title = file instanceof TFile ? file.basename : path;

                const header = docItem.createDiv({ cls: 'other-doc-header' });
                header.createEl('span', { text: title, cls: 'other-doc-title' });
                header.createEl('span', { text: ` (${suggestions.length} suggestions)`, cls: 'other-doc-count' });

                docItem.onclick = () => {
                    if (file instanceof TFile) {
                        this.app.workspace.getLeaf().openFile(file);
                    }
                };

                count++;
            }
        }
    }

    renderSuggestionItem(container: HTMLElement, suggestion: LinkSuggestion, targetFile: TFile) {
        // Only show suggestions above 60% confidence (0.6 threshold) or if LLM reranked
        // Note: Check if llm_score exists using !== undefined (not just !llm_score)
        // because a score of 0 is still a valid LLM score
        if (suggestion.similarity && suggestion.similarity < 0.6 && suggestion.llm_score === undefined) {
            if (this.plugin.settings.debugMode) {
                console.debug(`[DEBUG] Skipping render of '${suggestion.title}': similarity=${suggestion.similarity}, llm_score=${suggestion.llm_score}`);
            }
            return;
        }

        const item = container.createEl('div', { cls: 'smart-vault-suggestion-item' });

        const header = item.createEl('div', { cls: 'suggestion-header' });
        const titleEl = header.createEl('strong', {
            text: suggestion.title,
            cls: 'smart-vault-pointer smart-vault-underline'
        });
        titleEl.onclick = (e) => {
            e.stopPropagation();
            const file = this.app.vault.getAbstractFileByPath(suggestion.path);
            if (file instanceof TFile) {
                this.app.workspace.getLeaf().openFile(file);
            }
        };

        // Show both scores if LLM reranking was used
        if (suggestion.llm_score !== undefined) {
            const scoreText = ` 🤖 AI: ${suggestion.llm_score.toFixed(1)}/10 · 📊 Similarity: ${(suggestion.similarity * 100).toFixed(0)}%`;
            header.createEl('span', { text: scoreText, cls: 'similarity-score' });
        } else {
            const scoreText = ` 📊 ${(suggestion.similarity * 100).toFixed(0)}%`;
            header.createEl('span', { text: scoreText, cls: 'similarity-score' });
        }

        // Show LLM reasoning if available
        if (suggestion.llm_reason) {
            const reasonEl = item.createEl('div', { cls: 'suggestion-llm-reason' });
            reasonEl.createEl('strong', { text: '💡 Why: ' });
            reasonEl.createSpan({ text: suggestion.llm_reason });
        }

        item.createEl('p', { text: suggestion.context, cls: 'suggestion-context' });

        // Button container for multiple buttons
        const buttonContainer = item.createEl('div', { cls: 'suggestion-buttons' });

        const button = buttonContainer.createEl('button', { text: 'Insert link', cls: 'suggestion-button' });

        const ignoreButton = buttonContainer.createEl('button', { text: '✕ Ignore', cls: 'suggestion-button-secondary' });
        ignoreButton.title = 'Hide this suggestion permanently';
        ignoreButton.onclick = (e) => {
            e.stopPropagation();
            this.plugin.cacheManager!.ignoreSuggestion(targetFile.path, suggestion.path);
            // Remove from DOM immediately
            item.remove();
        };

        let previewTimeout: number | null = null;
        let isShowingPreview = false;
        let cachedInsertPoint: InsertionPoint | null = null;

        // Pre-calculate insertion point (fast, rule-based only)
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view && view.file?.path === targetFile.path) {
            const editor = view.editor;
            const content = editor.getValue();
            const fallback = this.findBestInsertionPoint(content, suggestion.title);
            if (fallback && fallback.replaceText) {
                const linkText = `[[${suggestion.title}]]`;
                cachedInsertPoint = {
                    line: fallback.line,
                    ch: fallback.ch,
                    originalText: fallback.replaceText,
                    linkText: linkText,
                    useSeeAlso: false
                };
                // Show preview info in button title
                button.title = `Will replace "${fallback.replaceText}" with "${linkText}"`;
            } else {
                cachedInsertPoint = { line: -1, ch: -1, originalText: '', linkText: '', useSeeAlso: true };
                button.title = 'Will add to see also section';
            }
        } else {
            button.title = 'Hover to preview, click to insert';
        }

        // Mouse enter - show preview immediately (no LLM call)
        button.onmouseenter = () => {
            const previewPoint = cachedInsertPoint;
            if (!previewPoint) return;

            previewTimeout = window.setTimeout(() => {
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (!view || view.file?.path !== targetFile.path) return;

                const editor = view.editor;

                // Highlight and show the replacement
                if (!previewPoint.useSeeAlso) {
                    const line = editor.getLine(previewPoint.line);
                    const before = line.substring(0, previewPoint.ch);
                    const after = line.substring(previewPoint.ch + previewPoint.originalText.length);
                    const previewLine = before + previewPoint.linkText + after;

                    // Temporarily replace the line to show preview
                    editor.replaceRange(
                        previewLine,
                        { line: previewPoint.line, ch: 0 },
                        { line: previewPoint.line, ch: line.length }
                    );

                    // Select the inserted link
                    editor.setSelection(
                        { line: previewPoint.line, ch: previewPoint.ch },
                        { line: previewPoint.line, ch: previewPoint.ch + previewPoint.linkText.length }
                    );

                    // Ensure preview is visible
                    editor.scrollIntoView({
                        from: { line: previewPoint.line, ch: previewPoint.ch },
                        to: { line: previewPoint.line, ch: previewPoint.ch + previewPoint.linkText.length }
                    });

                    isShowingPreview = true;
                    // Store original line so we can restore it
                    previewPoint.originalLine = line;

                    // Show what changed in button
                    button.textContent = `"${previewPoint.originalText}" → "${previewPoint.linkText}"`;
                } else {
                    // Show See Also preview
                    button.textContent = '→ See Also';
                    isShowingPreview = true;
                }
            }, 200); // Reduced to 200ms for faster feedback
        };

        // Mouse leave - clear preview
        button.onmouseleave = () => {
            if (previewTimeout !== null) {
                clearTimeout(previewTimeout);
                previewTimeout = null;
            }

            if (isShowingPreview) {
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (view && cachedInsertPoint) {
                    const editor = view.editor;

                    // Restore original line if we modified it
                    if (cachedInsertPoint.originalLine && !cachedInsertPoint.useSeeAlso) {
                        editor.replaceRange(
                            cachedInsertPoint.originalLine,
                            { line: cachedInsertPoint.line, ch: 0 },
                            { line: cachedInsertPoint.line, ch: editor.getLine(cachedInsertPoint.line).length }
                        );
                    }

                    // Clear selection
                    const cursor = editor.getCursor();
                    editor.setCursor(cursor);
                }
                button.textContent = 'Insert Link';
                isShowingPreview = false;
            }
        };

        button.onclick = () => {
            void (async () => {
                // Clear preview state
                if (previewTimeout !== null) {
                    clearTimeout(previewTimeout);
                }
                isShowingPreview = false;

                if (this.plugin.settings.debugMode) {
                    console.debug('Insert link clicked for:', suggestion.title);
                }
                await this.insertLink(suggestion.title, targetFile);
            })();
        };
    }

    findBestInsertionPoint(content: string, linkTitle: string): { line: number, ch: number, replaceText: string | null, newText: string } | null {
        const lines = content.split('\n');
        const titleLower = linkTitle.toLowerCase();
        const titleWords = titleLower.split(/\s+/).filter(w => w.length >= 4); // Only significant words

        if (this.plugin.settings.debugMode) {
            console.debug('Finding insertion point for:', linkTitle);
            console.debug('Title words to search:', titleWords);
        }

        // Strategy 1: Find exact phrase match to replace
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx];
            const lineLower = line.toLowerCase();

            // Skip if already has a link
            if (line.includes('[[')) continue;

            // Try to find the title as a whole phrase (case insensitive)
            const titleIndex = lineLower.indexOf(titleLower);
            if (titleIndex !== -1 && titleIndex >= 0) {
                // Extract the actual text from the original line (preserves case)
                const matchedText = line.substring(titleIndex, titleIndex + linkTitle.length);
                const beforeMatch = line.substring(0, titleIndex);
                const afterMatch = line.substring(titleIndex + linkTitle.length);

                if (this.plugin.settings.debugMode) {
                    console.debug(`Found exact phrase match at line ${lineIdx}: "${matchedText}"`);
                }

                return {
                    line: lineIdx,
                    ch: titleIndex,
                    replaceText: matchedText,
                    newText: `${beforeMatch}[[${linkTitle}]]${afterMatch}`
                };
            }
        }

        // Strategy 2: Find individual significant words from the title
        // BUT only if it makes sense to replace (i.e., the matched word is the same as the link title)
        const isSingleWordTitle = titleWords.length === 1;

        if (isSingleWordTitle) {
            // For single-word titles, we can safely replace matching words
            for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
                const line = lines[lineIdx];

                // Skip if already has a link
                if (line.includes('[[')) continue;

                // Try to find the single word
                const word = titleWords[0];
                const wordRegex = new RegExp(`\\b${this.escapeRegex(word)}\\b`, 'i');
                const match = line.match(wordRegex);

                if (match && match.index !== undefined) {
                    const beforeMatch = line.substring(0, match.index);
                    const afterMatch = line.substring(match.index + match[0].length);

                    if (this.plugin.settings.debugMode) {
                        console.debug(`Found word match at line ${lineIdx}: "${match[0]}" (single-word title: "${linkTitle}")`);
                    }

                    return {
                        line: lineIdx,
                        ch: match.index,
                        replaceText: match[0],
                        newText: `${beforeMatch}[[${linkTitle}]]${afterMatch}`
                    };
                }
            }
        }

        if (this.plugin.settings.debugMode) {
            console.debug('No good inline insertion point found - will use See Also');
        }
        return null;
    }

    escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    addToSeeAlso(editor: Editor, title: string) {
        const content = editor.getValue();
        const lines = content.split('\n');

        // Find existing "See Also" section
        let seeAlsoIndex = -1;
        for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].match(/^##?\s*See Also/i)) {
                seeAlsoIndex = i;
                break;
            }
        }

        const linkLine = `- [[${title}]]`;

        if (seeAlsoIndex !== -1) {
            // Check if link already exists in See Also section
            let endOfSection = lines.length;
            for (let i = seeAlsoIndex + 1; i < lines.length; i++) {
                if (lines[i].includes(`[[${title}]]`)) {
                    new Notice(`${title} already in See Also`);
                    return;
                }
                // Stop at next heading
                if (lines[i].match(/^#/)) {
                    endOfSection = i;
                    break;
                }
            }

            // Find the last non-empty line in the See Also section to insert after
            let insertLine = seeAlsoIndex + 1;
            for (let i = seeAlsoIndex + 1; i < endOfSection; i++) {
                if (lines[i].trim().length > 0) {
                    insertLine = i + 1;
                }
            }

            // Insert after the last entry in See Also
            editor.replaceRange(`${linkLine}\n`, { line: insertLine, ch: 0 });

            // Highlight the new link
            editor.setSelection(
                { line: insertLine, ch: 0 },
                { line: insertLine, ch: linkLine.length }
            );
        } else {
            // Create new See Also section at the end
            const lastLine = lines.length;
            const seeAlsoSection = `\n## See Also\n\n${linkLine}\n`;

            editor.replaceRange(seeAlsoSection, { line: lastLine, ch: 0 });

            // Highlight the new link
            editor.setSelection(
                { line: lastLine + 3, ch: 0 },
                { line: lastLine + 3, ch: linkLine.length }
            );
        }

        new Notice(`Added ${title} to See Also section`);
    }

    async insertLink(title: string, targetFile: TFile) {
        if (this.plugin.settings.debugMode) {
            console.debug('insertLink called for:', title, 'target file:', targetFile.path);
        }

        // Get the active view
        let view = this.app.workspace.getActiveViewOfType(MarkdownView);

        // If no active view or wrong file, open the target file
        if (!view || view.file?.path !== targetFile.path) {
            if (this.plugin.settings.debugMode) {
                console.debug('Opening target file:', targetFile.path);
            }
            const leaf = this.app.workspace.getLeaf(false);
            await leaf.openFile(targetFile);
            view = this.app.workspace.getActiveViewOfType(MarkdownView);
        }

        if (!view) {
            console.error('Failed to get markdown view');
            new Notice('Failed to open file for link insertion');
            return;
        }

        const editor = view.editor;
        const content = editor.getValue();

        let insertPoint: InsertionPoint | null = null;

        // Try LLM-powered insertion first if enabled
        if (this.plugin.settings.enableSmartInsertion) {
            try {
                if (this.plugin.settings.debugMode) {
                    console.debug('[DEBUG] Using LLM to find insertion point');
                }

                // Check cache first
                const currentFile = view.file;
                if (currentFile) {
                    const cached = this.plugin.getCachedInsertion(currentFile.path, title);
                    if (cached) {
                        if (this.plugin.settings.debugMode) {
                            console.debug('[DEBUG] Using cached LLM insertion suggestion');
                        }
                        // Use cached result
                        const llmResult = cached;

                        if (llmResult && llmResult.phrase && llmResult.phrase !== null && llmResult.confidence > 0.5) {
                            const phrase = llmResult.phrase;
                            const lines = content.split('\n');

                            // Find the phrase in the document
                            for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
                                const line = lines[lineIdx];
                                let phraseIndex = line.indexOf(phrase);

                                if (phraseIndex === -1) {
                                    const lineLower = line.toLowerCase();
                                    const phraseLower = phrase.toLowerCase();
                                    phraseIndex = lineLower.indexOf(phraseLower);

                                    if (phraseIndex !== -1) {
                                        const actualPhrase = line.substring(phraseIndex, phraseIndex + phrase.length);
                                        insertPoint = {
                                            line: lineIdx,
                                            ch: phraseIndex,
                                            originalText: actualPhrase,
                                            linkText: `[[${title}]]`,
                                            useSeeAlso: false,
                                            reason: llmResult.reason
                                        };
                                        break;
                                    }
                                } else {
                                    insertPoint = {
                                        line: lineIdx,
                                        ch: phraseIndex,
                                        originalText: phrase,
                                        linkText: `[[${title}]]`,
                                        useSeeAlso: false,
                                        reason: llmResult.reason
                                    };
                                    break;
                                }
                            }
                        }
                    }
                }

                // If no cache hit or cached result didn't work, call LLM
                if (!insertPoint) {
                    // Get context about the link from suggestions
                    const suggestions = this.allDocumentSuggestions.get(targetFile.path) || [];
                    const linkSuggestion = suggestions.find((s) => s.title === title);
                    const linkContext = linkSuggestion?.context || 'Related document';

                    const llmResult = await this.plugin.wasmModule.suggest_insertion_points_with_llm(
                        this.plugin.settings.ollamaEndpoint,
                        this.plugin.settings.llmModel,
                        content,
                        title,
                        linkContext,
                        this.plugin.settings.llmTemperature,
                        this.plugin.settings.enableThinkingMode,
                        this.plugin.settings.debugMode
                    );

                    // Cache the result
                    if (currentFile && llmResult) {
                        this.plugin.cacheInsertion(currentFile.path, title, llmResult);
                    }

                    // Parse LLM response
                    if (llmResult && llmResult.phrase && llmResult.phrase !== null && llmResult.confidence > 0.5) {
                        const phrase = llmResult.phrase;
                        const lines = content.split('\n');

                        // Find the phrase in the document
                        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
                            const line = lines[lineIdx];
                            let phraseIndex = line.indexOf(phrase);

                            if (phraseIndex === -1) {
                                const lineLower = line.toLowerCase();
                                const phraseLower = phrase.toLowerCase();
                                phraseIndex = lineLower.indexOf(phraseLower);

                                if (phraseIndex !== -1) {
                                    const actualPhrase = line.substring(phraseIndex, phraseIndex + phrase.length);
                                    insertPoint = {
                                        line: lineIdx,
                                        ch: phraseIndex,
                                        originalText: actualPhrase,
                                        linkText: `[[${title}]]`,
                                        useSeeAlso: false,
                                        reason: llmResult.reason
                                    };
                                    break;
                                }
                            } else {
                                insertPoint = {
                                    line: lineIdx,
                                    ch: phraseIndex,
                                    originalText: phrase,
                                    linkText: `[[${title}]]`,
                                    useSeeAlso: false,
                                    reason: llmResult.reason
                                };
                                break;
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('LLM insertion error:', error);
            }
        }

        // Fallback to rule-based insertion if LLM didn't find a good spot
        if (!insertPoint) {
            const result = this.findBestInsertionPoint(content, title);
            if (result) {
                insertPoint = {
                    line: result.line,
                    ch: result.ch,
                    originalText: result.replaceText || "",
                    linkText: `[[${title}]]`,
                    useSeeAlso: false
                };
            } else {
                insertPoint = { line: -1, ch: -1, originalText: '', linkText: '', useSeeAlso: true };
            }
        }

        if (insertPoint && !insertPoint.useSeeAlso) {
            // Replace ALL occurrences of the phrase throughout the document
            const replacePhrase = insertPoint.originalText;
            if (replacePhrase) {
                const lines = content.split('\n');
                const phraseLower = replacePhrase.toLowerCase();
                let replacementCount = 0;
                let lastLineIdx = -1;
                let lastChIdx = -1;

                // Process from bottom to top to avoid position shifts
                for (let lineIdx = lines.length - 1; lineIdx >= 0; lineIdx--) {
                    const line = lines[lineIdx];
                    const lineLower = line.toLowerCase();

                    // Skip lines that already have links
                    if (line.includes('[[')) continue;

                    // Find all occurrences in this line (from right to left)
                    const occurrences: number[] = [];
                    let searchIdx = 0;
                    let foundIdx = lineLower.indexOf(phraseLower, searchIdx);
                    while (foundIdx !== -1) {
                        occurrences.push(foundIdx);
                        searchIdx = foundIdx + 1;
                        foundIdx = lineLower.indexOf(phraseLower, searchIdx);
                    }

                    // Replace from right to left
                    for (let i = occurrences.length - 1; i >= 0; i--) {
                        const foundIdx = occurrences[i];
                        const beforePhrase = line.substring(0, foundIdx);
                        const afterPhrase = line.substring(foundIdx + replacePhrase.length);
                        const newLine = `${beforePhrase}[[${title}]]${afterPhrase}`;

                        editor.replaceRange(newLine,
                            { line: lineIdx, ch: 0 },
                            { line: lineIdx, ch: line.length }
                        );

                        replacementCount++;
                        lastLineIdx = lineIdx;
                        lastChIdx = foundIdx;
                    }
                }

                // Highlight the last insertion
                if (lastLineIdx !== -1) {
                    const finalLine = editor.getLine(lastLineIdx);
                    const linkStart = finalLine.indexOf('[[', lastChIdx);
                    const linkEnd = linkStart + title.length + 4;

                    editor.setSelection(
                        { line: lastLineIdx, ch: linkStart },
                        { line: lastLineIdx, ch: linkEnd }
                    );

                    setTimeout(() => {
                        editor.setCursor({ line: lastLineIdx, ch: linkEnd });
                    }, 1500);
                }

                const noticeMessage = insertPoint.reason
                    ? `Added ${replacementCount} link(s): ${insertPoint.reason}`
                    : `Added ${replacementCount} link(s) to ${title} (replaced "${replacePhrase}")`;
                new Notice(noticeMessage);
            } else {
                // No phrase to replace, just insert at the insertion point
                editor.replaceRange(insertPoint.linkText,
                    { line: insertPoint.line, ch: insertPoint.ch },
                    { line: insertPoint.line, ch: insertPoint.ch + insertPoint.originalText.length }
                );

                const linkStart = insertPoint.ch;
                const linkEnd = linkStart + insertPoint.linkText.length;

                editor.setSelection(
                    { line: insertPoint.line, ch: linkStart },
                    { line: insertPoint.line, ch: linkEnd }
                );

                const finalLineIdx = insertPoint.line;
                setTimeout(() => {
                    editor.setCursor({ line: finalLineIdx, ch: linkEnd });
                }, 1500);

                new Notice(`Added link to ${title}`);
            }
        } else {
            // No good insertion point found - add to See Also section instead
            this.addToSeeAlso(editor, title);
        }
    }

    showIgnoredSuggestionsModal() {
        const ignored = this.plugin.cacheManager!.getIgnoredSuggestions();

        const modal = new Modal(this.app);
        modal.titleEl.setText(`Ignored Suggestions (${ignored.length})`);

        if (ignored.length === 0) {
            modal.contentEl.createEl('p', { text: 'No ignored suggestions yet.' });
        } else {
            const list = modal.contentEl.createEl('div', { cls: 'smart-vault-ignored-list' });

            ignored.forEach(({ sourceFile, targetFile, timestamp }) => {
                const item = list.createEl('div', { cls: 'smart-vault-ignored-item' });

                const sourceName = sourceFile.split('/').pop()?.replace('.md', '') || sourceFile;
                const targetName = targetFile.split('/').pop()?.replace('.md', '') || targetFile;

                const text = item.createEl('div', { cls: 'ignored-text' });
                text.createEl('strong', { text: sourceName });
                text.createSpan({ text: ' → ' });
                text.createSpan({ text: targetName });

                const date = new Date(timestamp);
                const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
                item.createEl('div', { text: `Ignored: ${dateStr}`, cls: 'ignored-date' });

                const unignoreBtn = item.createEl('button', {
                    text: '↻ Restore',
                    cls: 'suggestion-button-secondary'
                });
                unignoreBtn.onclick = () => {
                    this.plugin.cacheManager!.unignoreSuggestion(sourceFile, targetFile);
                    item.remove();
                    modal.titleEl.setText(`Ignored Suggestions (${this.plugin.cacheManager!.getIgnoredSuggestions().length})`);
                    // Refresh the current view to show the restored suggestion
                    if (this.currentFile && this.currentFile.path === sourceFile) {
                        this.render();
                    }
                };
            });

            // Add clear all button
            const footer = modal.contentEl.createEl('div', { cls: 'modal-button-container' });
            const clearAllBtn = footer.createEl('button', {
                text: 'Clear All',
                cls: 'mod-warning'
            });
            clearAllBtn.onclick = () => {
                this.plugin.cacheManager!.clearIgnoredSuggestions();
                modal.close();
                this.render();
            };
        }

        modal.open();
    }

    async onClose() {
        // Cleanup
    }
}
