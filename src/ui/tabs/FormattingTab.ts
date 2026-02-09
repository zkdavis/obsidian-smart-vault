import { App, MarkdownView, Notice, TFile, setIcon } from 'obsidian';
import SmartVaultPlugin from '../../plugin/SmartVaultPlugin';
import { BaseTab } from './BaseTab';
import type { FormattingCacheData } from '../../settings/types';

/**
 * Interface for a grammar correction
 */
interface GrammarIssue {
    original: string;
    corrected: string;
    reason: string;
}

/**
 * Interface for a structure suggestion
 */
interface StructureSuggestion {
    title: string;
    description: string;
    markdown_to_insert: string;
}

/**
 * Interface for a flashcard
 */
interface Flashcard {
    question: string;
    answer: string;
}

interface FormattingAnalysisResult {
    grammar_issues: GrammarIssue[];
    structure_suggestions: StructureSuggestion[];
    flashcards: (string | Flashcard)[];
    tags: string[];
    existing_tags?: string[]; // Add existing_tags and new_tags as they are used in renderResults
    new_tags?: string[];
}

export class FormattingTab extends BaseTab {
    private currentFile: TFile | null = null;
    private lastAnalysis: FormattingAnalysisResult | null = null;
    private lastAnalysisPath: string | null = null;
    private isLoading: boolean = false;
    private previewMarker: { lineStart: number, content: string } | null = null;

    constructor(app: App, plugin: SmartVaultPlugin, containerEl: HTMLElement) {
        super(app, plugin, containerEl);
    }

    setFileContext(file: TFile): void {
        this.currentFile = file;
    }

    async onOpen(): Promise<void> {
        this.render();
        await Promise.resolve();
    }

    async onClose(): Promise<void> {
        this.containerEl.empty();
        await Promise.resolve();
    }

    render(): void {
        this.containerEl.empty();
        const content = this.containerEl.createDiv({ cls: 'smart-vault-formatting-tab' });

        content.createEl('h3', { text: 'Smart formatting & quality' });

        const controls = content.createDiv({ cls: 'smart-vault-controls' });

        const analyzeBtn = controls.createEl('button', {
            text: 'Analyze current note',
            cls: 'mod-cta'
        });

        // Add "Analyze Inbox" button if Inbox path is set
        // const analyzeInboxBtn = controls.createEl('button', { text: 'Process Inbox' });

        const outputArea = content.createDiv({ cls: 'smart-vault-output' });
        outputArea.createEl('p', { text: 'Open a note and click analyze to see suggestions for grammar, structure, flashcards, and tags.', cls: 'smart-vault-helper-text' });

        analyzeBtn.onclick = async () => {
            await this.analyzeCurrentNote(outputArea);
        };

        // State Machine Rendering
        // State Machine Rendering
        if (this.isLoading) {
            outputArea.empty();
            outputArea.createEl('div', { cls: 'smart-vault-loading', text: '🤖 Analyzing note quality... (switch tabs freely)' });
        } else if (this.currentFile && this.lastAnalysis && this.lastAnalysisPath === this.currentFile.path) {
            this.renderResults(outputArea, this.lastAnalysis, this.currentFile);
        }
        // We need to render based on state, and the async task should strictly update state, not DOM.
    }


    async analyzeCurrentNote(_container: HTMLElement) {
        if (!this.currentFile) {
            new Notice('No active file context');
            return;
        }

        const mtime = this.currentFile.stat.mtime;
        const cacheKey = this.currentFile.path;

        // CACHE CHECK (Optimized direct check)
        const cached = this.plugin.settings.formattingCache?.[cacheKey];
        if (cached && cached.mtime === mtime && cached.data) {
            if (this.plugin.settings.debugMode) {
                console.debug(`[DEBUG] Cache hit for ${cacheKey}`);
            }
            this.lastAnalysis = cached.data as FormattingAnalysisResult;
            this.lastAnalysisPath = cacheKey;
            this.render();
            return;
        }

        this.isLoading = true;
        this.render(); // Update UI to "Loading" state

        try {
            const content = await this.app.vault.read(this.currentFile);


            // Get all tags from vault (simple implementation)
            // @ts-ignore - getAllTags is part of metadataCache
            const allTags = Object.keys(this.app.metadataCache.getTags()).map(t => t.replace('#', ''));

            const { wasmModule } = this.plugin;

            if (this.plugin.settings.debugMode) {
                console.debug(`[DEBUG] analyze_formatting called for ${this.currentFile.path}`);
            }

            const model = this.plugin.settings.formattingModel || this.plugin.settings.llmModel;

            // Call Rust with Timeout
            const llmCall = wasmModule.analyze_formatting_with_llm(
                this.plugin.settings.ollamaEndpoint,
                model,
                content,
                allTags,
                this.plugin.settings.llmTemperature,
                this.plugin.settings.enableThinkingMode,
                this.plugin.settings.debugMode
            );

            const timeoutMs = this.plugin.settings.llmTimeout || 30000;
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Formatting analysis timed out')), timeoutMs);
            });

            const result = await Promise.race([llmCall, timeoutPromise]);


            if (this.plugin.settings.debugMode) {
                console.debug(`[DEBUG] analyze_formatting completed for ${this.currentFile.path}`);
            }

            this.lastAnalysis = result as FormattingAnalysisResult;
            this.lastAnalysisPath = this.currentFile.path;

            // CACHE WRITE
            if (!this.plugin.settings.formattingCache) this.plugin.settings.formattingCache = {};
            this.plugin.settings.formattingCache[this.currentFile.path] = {
                mtime: this.currentFile.stat.mtime,
                data: result as unknown as FormattingCacheData
            };
            await this.plugin.saveSettings();

        } catch (e) {
            console.error(e);
            new Notice(`Analysis failed: ${e}`);
            // We could store error state too
        } finally {
            this.isLoading = false;
            this.render(); // Re-render with results (or empty if failed)
        }
    }

    renderResults(container: HTMLElement, result: FormattingAnalysisResult, file: TFile) {
        container.empty();

        // 1. Tags
        if ((result.existing_tags && result.existing_tags.length > 0) || (result.new_tags && result.new_tags.length > 0)) {
            const tagSection = container.createDiv({ cls: 'smart-vault-section' });
            tagSection.createEl('h4', { text: '🏷️ Tags' });

            // Scrollable Tags
            const tagContainer = tagSection.createDiv({
                cls: 'smart-vault-scroll-view smart-vault-flex-column smart-vault-gap-12'
            });

            if (result.existing_tags?.length) {
                const existingDiv = tagContainer.createDiv();
                existingDiv.createEl('h6', { text: 'Existing tags', cls: 'smart-vault-margin-0 smart-vault-muted' });
                const btnContainer = existingDiv.createDiv({ cls: 'smart-vault-flex-row smart-vault-flex-wrap smart-vault-gap-6' });

                result.existing_tags.forEach((tag: string) => {
                    // Existing tags button (maybe click to remove? For now just visual consistency)
                    btnContainer.createEl('button', { text: `#${tag}`, cls: 'tag-pill smart-vault-tag-btn', title: 'Existing tag' });
                });
            }

            if (result.new_tags?.length) {
                const newDiv = tagContainer.createDiv();
                newDiv.createEl('h6', { text: 'Suggested tags', cls: 'smart-vault-margin-0 smart-vault-accent' });
                const btnContainer = newDiv.createDiv({ cls: 'smart-vault-flex-row smart-vault-flex-wrap smart-vault-gap-6' });

                result.new_tags.forEach((tag: string) => {
                    const tagBtn = btnContainer.createEl('button', { text: `+ #${tag}`, cls: 'tag-pill new smart-vault-tag-btn' });
                    tagBtn.onclick = async () => {
                        await this.addTagToNote(file, tag);
                        tagBtn.remove();
                    }
                });
            }
        }

        // 2. Grammar Issues
        if (result.grammar_issues && result.grammar_issues.length > 0) {
            const section = container.createDiv({ cls: 'smart-vault-section' });
            section.createEl('h4', { text: '💎 Grammar & style' });

            const list = section.createDiv({ cls: 'smart-vault-grammar-list' });

            result.grammar_issues.forEach((issue) => {
                const item = list.createDiv({ cls: 'smart-vault-grammar-item' });

                const diff = item.createDiv({ cls: 'grammar-diff' });
                diff.createSpan({ text: issue.original, cls: 'grammar-original' });
                diff.createSpan({ text: ' → ', cls: 'grammar-arrow' });
                diff.createSpan({ text: issue.corrected, cls: 'grammar-corrected' });

                if (issue.reason) {
                    item.createDiv({ text: issue.reason, cls: 'grammar-reason' });
                }

                const applyBtn = item.createEl('button', { text: 'Apply' });
                applyBtn.onclick = async () => {
                    await this.applyGrammarFix(file, issue.original, issue.corrected);
                    item.addClass('is-applied');
                    applyBtn.disabled = true;
                    applyBtn.setText('Applied');

                    // Update cache
                    if (this.lastAnalysis) {
                        const idx = this.lastAnalysis.grammar_issues.indexOf(issue);
                        if (idx > -1) {
                            this.lastAnalysis.grammar_issues.splice(idx, 1);
                        }
                    }
                };
            });
        }

        // 3. Structure
        if (result.structure_suggestions?.length > 0) {
            const structureSection = container.createDiv({ cls: 'smart-vault-section' });
            structureSection.createEl('h4', { text: '🏗️ Structure' });
            const ul = structureSection.createEl('ul', { cls: 'smart-vault-scroll-view' });
            result.structure_suggestions.forEach((s) => {
                const li = ul.createEl('li', { cls: 'smart-vault-structure-item' });

                // Handle both string (legacy/fallback) and object formats
                const title = typeof s === 'string' ? s : s.title;
                const desc = typeof s === 'string' ? '' : s.description;
                const content = typeof s === 'string' ? s : s.markdown_to_insert;

                const textDiv = li.createDiv();
                textDiv.createDiv({ text: title, cls: 'smart-vault-bold' });
                if (desc) textDiv.createDiv({ text: desc, cls: 'smart-vault-small smart-vault-muted' });

                const addBtn = li.createEl('button', { cls: 'smart-vault-mini-btn', title: 'Append content to note' });
                setIcon(addBtn, 'plus-circle');

                // Hover Preview (Live insertion)
                // Hover Preview (Live insertion)
                addBtn.onmouseenter = () => {
                    if (!this.plugin.settings.enableHoverPreviews) return;

                    const view = this.getActiveEditor(file);
                    if (view) {
                        const editor = view.editor;
                        const lineCount = editor.lineCount();

                        // Use a distinct Callout for visibility
                        const previewContent = `\n\n> [!NOTE] PREVIEW: ${title}\n> ${content.replace(/\n/g, "\n> ")}\n`;

                        editor.replaceRange(previewContent, { line: lineCount, ch: 0 });

                        const newLastLine = editor.lineCount();
                        editor.scrollIntoView({
                            from: { line: lineCount, ch: 0 },
                            to: { line: newLastLine, ch: 0 }
                        }, true);

                        // We track IF we are previewing. 
                        this.previewMarker = { lineStart: lineCount, content: previewContent };
                    }
                };

                addBtn.onmouseleave = () => {
                    if (this.previewMarker) {
                        const view = this.getActiveEditor(file);
                        if (view) {
                            const editor = view.editor;
                            // ROBUST REMOVAL: Just Undo.
                            editor.undo();
                        }
                        this.previewMarker = null;
                    }
                };

                addBtn.onclick = async () => {
                    // Clicked: WE WANT IT PERMANENT.
                    if (this.previewMarker) {
                        const view = this.getActiveEditor(file);
                        if (view) {
                            const editor = view.editor;
                            // 1. Undo the PREVIEW (Callout)
                            editor.undo();
                            this.previewMarker = null;

                            // 2. Append the REAL content (Clean)
                            await this.app.vault.append(file, `\n\n${content}`);

                            // 3. Scroll to it
                            setTimeout(() => {
                                const lastLine = editor.lineCount();
                                editor.scrollIntoView({ from: { line: lastLine, ch: 0 }, to: { line: lastLine, ch: 0 } }, true);
                            }, 100);

                            new Notice('Appended structure to note');
                        }
                    } else {
                        // Fallback (no preview was active)
                        await this.app.vault.append(file, `\n\n${content}`);
                        new Notice('Appended structure to note');
                    }
                };
            });
        }

        // 4. Flashcards
        if (result.flashcards?.length > 0) {
            const flashcardSection = container.createDiv({ cls: 'smart-vault-section' });
            const header = flashcardSection.createDiv({ cls: 'smart-vault-section-header' });
            header.createEl('h4', { text: '🧠 Flashcards' });

            const appendBtn = header.createEl('button', { text: 'Append all', cls: 'mod-cta' });

            const cardList = flashcardSection.createEl('div', { cls: 'smart-vault-flashcards' });

            result.flashcards.forEach((card) => {
                const cardEl = cardList.createDiv({ cls: 'smart-vault-flashcard' });

                let q: string = '', a: string = '';
                if (typeof card === 'string') {
                    [q, a] = card.split('::');
                } else {
                    q = card.question || '';
                    a = card.answer || '';
                }

                cardEl.createDiv({ text: `Q: ${q}`, cls: 'flashcard-q' });
                cardEl.createDiv({ text: `A: ${a}`, cls: 'flashcard-a' });

                const addBtn = cardEl.createEl('button', { text: 'Add', cls: 'smart-vault-mini-btn smart-vault-flashcard-add-btn' });
                addBtn.onclick = async () => {
                    const cardText = typeof card === 'string' ? card : `${q}::${a}`;
                    await this.app.vault.append(file, `\n${cardText}\n`);
                    new Notice('Flashcard added');
                    cardEl.remove();
                };
            });

            appendBtn.onclick = async () => {
                const cardsText = '\n\n### Flashcards\n' + result.flashcards.map((c) => {
                    if (typeof c === 'string') return c;
                    return `${c.question}::${c.answer}`;
                }).join('\n') + '\n';
                await this.app.vault.append(file, cardsText);
                new Notice('Flashcards appended!');
            };
        }
    }

    private getActiveEditor(file: TFile): MarkdownView | null {
        // Strategy 1: Active View
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view && view.file && view.file.path === file.path) {
            return view;
        }

        // Strategy 2: Find ANY leaf with this file open
        let foundView: MarkdownView | null = null;
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (!foundView && leaf.view instanceof MarkdownView && leaf.view.file && leaf.view.file.path === file.path) {
                foundView = leaf.view;
            }
        });
        return foundView;
    }

    private highlightTextInEditor(text: string) {
        if (!this.currentFile) return;
        const view = this.getActiveEditor(this.currentFile);
        if (!view) return;

        const editor = view.editor;
        const content = editor.getValue();
        const idx = content.indexOf(text);

        if (idx !== -1) {
            const start = editor.offsetToPos(idx);
            const end = editor.offsetToPos(idx + text.length);

            // Scroll into view
            editor.scrollIntoView({ from: start, to: end }, true);

            // Optional: Select it to highlight (user can click away to clear)
            editor.setSelection(start, end);
        }
    }

    private async applyGrammarFix(file: TFile, original: string, corrected: string) {
        const view = this.getActiveEditor(file);

        if (view) {
            // Use editor API for seamless update (undo history, etc)
            const editor = view.editor;
            const content = editor.getValue();
            const idx = content.indexOf(original);
            if (idx !== -1) {
                const start = editor.offsetToPos(idx);
                const end = editor.offsetToPos(idx + original.length);
                editor.replaceRange(corrected, start, end);
                new Notice('Applied fix');
            } else {
                new Notice('Could not find original text (has it changed?)');
            }
        } else {
            // Fallback to vault Modify (risky if file is open elsewhere, but safeish)
            const content = await this.app.vault.read(file);
            if (content.includes(original)) {
                const newContent = content.replace(original, corrected);
                await this.app.vault.modify(file, newContent);
                new Notice('Applied fix');
            } else {
                new Notice('Could not find original text');
            }
        }
    }

    private async addTagToNote(file: TFile, tag: string) {
        try {
            await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                if (!frontmatter['tags']) {
                    frontmatter['tags'] = [];
                }
                // Handle both string and array formats for tags
                let tags = frontmatter['tags'];
                if (typeof tags === 'string') {
                    tags = tags.split(',').map((t: string) => t.trim());
                }
                if (!Array.isArray(tags)) tags = [];

                if (!tags.includes(tag)) {
                    tags.push(tag);
                    frontmatter['tags'] = tags;
                    new Notice(`Added tag #${tag}`);
                } else {
                    new Notice(`Tag #${tag} already exists`);
                }
            });
        } catch (error) {
            const e = error as Error;
            new Notice(`Failed to add tag: ${e.message || e}`);
        }
    }
}
