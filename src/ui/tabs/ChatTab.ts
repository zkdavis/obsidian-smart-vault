import { App, TFile, setIcon, MarkdownView, MarkdownRenderer, Notice, Component } from 'obsidian';
import { BaseTab } from './BaseTab';
import SmartVaultPlugin from '../../plugin/SmartVaultPlugin';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { CONSTANTS } from '../../constants';
import { PROMPTS } from '../../prompts';

/**
 * Interface for a chat message
 */
export interface ChatMessage {
    role: string;
    content: string;
    sources?: string[];
}

/**
 * Interface for a chat action extracted from AI response
 */
interface ChatAction {
    type: string;
    title: string;
    content: string;
}

export class ChatTab extends BaseTab {
    private history: ChatMessage[] = [];
    private currentFile: TFile | null = null;
    private activeContextFiles: TFile[] | null = null;
    private chatMode: 'strict' | 'vault' | 'general' = 'vault';
    private showContextSources: boolean = false;
    public showHistory: boolean = false; // History Toggle State
    private contextDetached: boolean = false;
    private shouldFocusInput: boolean = false;

    private component: Component;

    constructor(app: App, plugin: SmartVaultPlugin, containerEl: HTMLElement, component: Component) {
        super(app, plugin, containerEl);
        this.component = component;
    }

    async onOpen(): Promise<void> {
        this.shouldFocusInput = true;
        this.render();
        await Promise.resolve();
    }

    async onClose(): Promise<void> {
        // Cleanup if needed
        await Promise.resolve();
    }

    setFileContext(file: TFile): void {
        this.activeContextFiles = null;
        if (this.currentFile?.path !== file.path) {
            this.currentFile = file;
            this.history = []; // Reset UI immediately
            this.render();

            // Load history
            if (this.plugin.cacheManager) {
                void this.plugin.cacheManager.loadChatHistory().then(history => {
                    const loaded = history[file.path];
                    if (loaded) {
                        this.history = loaded;
                        // If history exists, we might want to ensure mode consistency, or just default to vault
                        if (this.history.length > 0) this.contextDetached = false;
                        this.render();
                    }
                });
            }
            this.contextDetached = false; // Reset detachment on file switch
            this.chatMode = 'vault';
            this.render();
        }
    }

    setContextFiles(files: TFile[]) {
        if (files.length === 0) return;
        this.activeContextFiles = files;
        this.currentFile = files[0];
        this.history = [];

        // Attempt to load history if single file context
        if (files.length === 1 && this.plugin.cacheManager) {
            void this.plugin.cacheManager.loadChatHistory().then(history => {
                const loaded = history[files[0].path];
                if (loaded) {
                    this.history = loaded;
                    this.render();
                }
            });
        }

        this.chatMode = 'strict'; // Default for selection
        this.contextDetached = false;
        this.render();
    }

    render(): void {
        this.containerEl.empty();
        const content = this.containerEl.createDiv({ cls: 'smart-vault-chat-tab' });

        // --- Toolbar ---
        const toolBar = content.createDiv({ cls: 'smart-vault-toolbar' });

        // Row 1: Controls
        const controlsRow = toolBar.createDiv({ cls: 'smart-vault-toolbar-row' });

        // Mode Toggle GROUP
        const modeSelect = controlsRow.createEl('select', { cls: 'dropdown smart-vault-mode-select' });
        modeSelect.createEl('option', { value: 'strict', text: '🛡️ strict' });
        modeSelect.createEl('option', { value: 'vault', text: '🌍 vault' });
        modeSelect.createEl('option', { value: 'general', text: '🧠 general' });
        modeSelect.value = this.chatMode;
        modeSelect.onchange = () => {
            this.chatMode = modeSelect.value as 'strict' | 'vault' | 'general';
            this.render();
        };

        // New Chat Button
        const newChatBtn = controlsRow.createEl('button', { text: '✨ new chat', cls: 'smart-vault-mini-btn smart-vault-new-chat-btn' });
        newChatBtn.onclick = () => {
            this.history = [];
            this.contextDetached = false;
            this.activeContextFiles = null;
            this.chatMode = 'vault';
            this.render();
        };

        // History Toggle
        const historyBtn = controlsRow.createEl('button', { text: '📜', title: 'View history', cls: `smart-vault-icon-btn smart-vault-history-btn ${this.showHistory ? 'active' : ''}` });
        historyBtn.onclick = () => { this.showHistory = !this.showHistory; this.render(); };

        // Row 2: Context Indicator
        const contextRow = toolBar.createDiv({ cls: 'smart-vault-context-row' });

        if (this.contextDetached) {
            contextRow.createSpan({ text: '🚫 No active context', cls: 'smart-vault-context-status detached' });
            const attachBtn = contextRow.createEl('button', { text: 'Attach context', cls: 'smart-vault-mini-btn' });
            attachBtn.onclick = () => { this.contextDetached = false; this.render(); };
        }
        else if (this.activeContextFiles && this.activeContextFiles.length > 0) {
            const header = contextRow.createDiv({ cls: 'smart-vault-context-header' });
            header.createSpan({ text: `📌 ${this.activeContextFiles.length} Notes Selected`, cls: 'smart-vault-context-title' });

            // Detach Button
            const detachBtn = contextRow.createEl('button', { text: '✕', title: 'Detach context', cls: 'smart-vault-icon-btn smart-vault-detach-btn' });
            detachBtn.onclick = (e) => { e.stopPropagation(); this.contextDetached = true; this.activeContextFiles = null; this.render(); };

            // Toggle Details
            header.onclick = () => { this.showContextSources = !this.showContextSources; this.render(); };
        } else {
            contextRow.createSpan({ text: this.currentFile ? `📄 ${this.currentFile.basename}` : 'No active note', cls: 'smart-vault-context-status' });
            if (this.currentFile) {
                const detachBtn = contextRow.createEl('button', { text: '✕', title: 'Detach context', cls: 'smart-vault-icon-btn smart-vault-detach-btn' });
                detachBtn.onclick = () => { this.contextDetached = true; this.render(); };
            }
        }

        // Row 2: Context Indicator



        // --- Main Content Area ---
        if (this.showHistory) {
            void this.renderHistoryView(content);
        } else {
            this.renderMessages(content);
            this.renderInputArea(content);
        }
    }

    async renderHistoryView(container: HTMLElement) {
        // Null check for plugin/cacheManager
        if (!this.plugin.cacheManager) return;

        const historyContainer = container.createDiv({ cls: 'smart-vault-history-view smart-vault-padding-10 smart-vault-overflow-auto smart-vault-flex-grow' });
        historyContainer.createEl('h2', { text: 'Conversation history' });

        const history = await this.plugin.cacheManager.loadChatHistory();
        const files = Object.keys(history);

        if (files.length === 0) {
            historyContainer.createDiv({ text: 'No history found.', cls: 'smart-vault-italic' });
            return;
        }

        const list = historyContainer.createEl('ul', { cls: 'smart-vault-list-none' });

        for (const filePath of files) {
            const item = list.createEl('li', { cls: 'smart-vault-history-item smart-vault-padding-8 smart-vault-border-bottom smart-vault-flex-row smart-vault-space-between smart-vault-center' });

            const infoDiv = item.createDiv({ cls: 'smart-vault-flex-grow smart-vault-pointer' });
            infoDiv.createSpan({ text: filePath.split('/').pop()?.replace('.md', '') || filePath, cls: 'smart-vault-bold' });
            infoDiv.createSpan({ text: ` (${history[filePath].length} msgs)`, cls: 'smart-vault-small smart-vault-muted' });

            // Delete Button
            const deleteBtn = item.createEl('button', { text: '🗑️', title: 'Delete history', cls: 'smart-vault-mini-btn smart-vault-history-delete-btn' });

            infoDiv.onclick = () => {
                void (async () => {
                    const file = this.app.vault.getAbstractFileByPath(filePath);
                    if (file instanceof TFile) {
                        await this.plugin.activateSuggestionView(); // Ensure view is active
                        this.setContextFiles([file]);
                        this.showHistory = false;
                    } else {
                        new Notice(`File ${filePath} no longer exists.`);
                    }
                })();
            };

            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                new ConfirmModal(
                    this.app,
                    'Delete chat history',
                    `Are you sure you want to delete the chat history for ${filePath}?`,
                    async (confirmed) => {
                        if (confirmed && this.plugin.cacheManager) {
                            await this.plugin.cacheManager.deleteChatHistory(filePath);
                            await this.renderHistoryView(container); // Re-render
                        }
                    },
                    'Delete'
                ).open();
            };
        }


    }

    renderMessages(content: HTMLElement) {
        // Source List Render
        if (this.activeContextFiles && this.activeContextFiles.length > 0 && this.showContextSources && !this.contextDetached) {
            const list = content.createDiv({ cls: 'smart-vault-source-list smart-vault-overflow-auto smart-vault-padding-8 smart-vault-border-radius-4 smart-vault-small' });
            this.activeContextFiles.forEach(f => {
                list.createDiv({ text: f.basename, cls: 'smart-vault-padding-8' });
            });
        }

        // --- Chat Area ---
        const chatArea = content.createDiv({ cls: 'smart-vault-chat-area' });

        // Render history
        this.history.forEach((msg: ChatMessage) => {
            const msgDiv = chatArea.createDiv({ cls: `chat-message ${msg.role}` });
            const header = msgDiv.createDiv({ cls: 'chat-message-header' });
            header.createSpan({ text: msg.role === 'user' ? 'You' : 'AI', cls: 'chat-author' });

            const copyBtn = header.createEl('button', { cls: 'chat-copy-btn' });
            setIcon(copyBtn, 'copy');
            copyBtn.onclick = () => { void navigator.clipboard.writeText(msg.content); };

            if (msg.sources && msg.sources.length > 0) {
                const sourcesDiv = msgDiv.createDiv({ cls: 'chat-sources' });
                sourcesDiv.createSpan({ text: 'Sources: ', cls: 'source-label' });
                msg.sources.forEach(sourcePath => {
                    const sourceLink = sourcesDiv.createEl('a', { text: sourcePath.split('/').pop(), cls: 'source-link' });
                    sourceLink.onclick = () => { void this.app.workspace.openLinkText(sourcePath, '', true); };
                    sourcesDiv.createSpan({ text: ' ' });
                });
            }

            if (msg.role === 'assistant') {
                const contentDiv = msgDiv.createDiv({ cls: 'chat-content' });
                void MarkdownRenderer.render(this.app, msg.content, contentDiv, '', this.component);
            } else {
                msgDiv.createDiv({ text: msg.content, cls: 'chat-content' });
            }
        });

        chatArea.scrollTop = chatArea.scrollHeight;
    }

    // --- Input Area ---
    renderInputArea(content: HTMLElement) {
        const inputArea = content.createDiv({ cls: 'smart-vault-chat-input-area' });

        let placeholder = 'Ask about your notes...';
        if (this.contextDetached) placeholder = 'Ask (No Context)...';
        else {
            if (this.chatMode === 'strict') placeholder = 'Ask strictly about the selected notes...';
            if (this.chatMode === 'general') placeholder = 'Ask anything (General Knowledge + Context)...';
        }

        const input = inputArea.createEl('textarea', { attr: { placeholder } });
        const sendBtn = inputArea.createEl('button', { text: 'Send' });

        const handleSend = async () => {
            const text = input.value.trim();
            if (!text) return;
            input.value = '';
            this.history.push({ role: 'user', content: text });
            this.render();
            await this.processUserMessage(text);
        };

        sendBtn.onclick = () => { void handleSend(); };
        input.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
            }
        };
        if (this.shouldFocusInput) {
            setTimeout(() => {
                input.focus();
                this.shouldFocusInput = false;
            }, 50);
        }
    }

    public async runQuery(query: string) {
        this.history.push({ role: 'user', content: query });
        this.render();
        await this.processUserMessage(query);
    }

    private async processUserMessage(userMsg: string) {
        const loadingMsg: ChatMessage = { role: 'assistant', content: 'Thinking...' };
        this.history.push(loadingMsg);
        this.render();

        try {
            let context = "";
            let vaultContext = "";
            let agenticContext = ""; // Result of Tools
            const usedSources: string[] = [];
            const model = this.plugin.settings.chatModel || this.plugin.settings.llmModel;
            const { wasmModule } = this.plugin;

            // 0. Agentic Tools (Metadata/Intents)
            loadingMsg.content = "Checking vault metadata...";
            this.render();
            agenticContext = await this.detectIntents(userMsg);
            if (agenticContext) {
                loadingMsg.content = "Found metadata...";
                this.render();
            }

            // 1. Build Base Context (Selection or Current File) - SKIP IF DETACHED
            if (!this.contextDetached) {
                if (this.activeContextFiles && this.activeContextFiles.length > 0) {
                    loadingMsg.content = `Reading ${this.activeContextFiles.length} selected notes...`;
                    this.render();
                    context = "USER SELECTED CONTEXT:\n";
                    for (const file of this.activeContextFiles) {
                        const content = await this.app.vault.read(file);
                        context += `--- File: ${file.basename} ---\n${content}\n\n`;
                        usedSources.push(file.path);
                    }
                } else {
                    const activeFile = this.app.workspace.getActiveFile();
                    if (activeFile) {
                        this.currentFile = activeFile;
                        const fileContent = await this.app.vault.read(activeFile);
                        const view = this.getActiveEditor(activeFile);
                        const selection = view ? view.editor.getSelection() : "";

                        context = `CURRENT FILE: ${activeFile.basename}\n`;
                        if (selection) context += `USER SELECTION:\n"${selection}"\n\n`;
                        context += `FILE CONTENT:\n${fileContent}\n\n`;
                    }
                }
            } else {
                context = "NO CURRENT FILE CONTEXT (User Detached).\n";
            }

            // 2. RAG Retrieval (Vault or General Mode)
            if (this.chatMode === 'vault' || this.chatMode === 'general') {
                try {
                    const embeddingModel = this.plugin.settings.embeddingModel || "bge-m3";
                    loadingMsg.content = `Searching Vault (${embeddingModel})...`;
                    this.render();

                    const queryVec = await wasmModule.generate_embedding_ollama(
                        this.plugin.settings.ollamaEndpoint,
                        embeddingModel,
                        userMsg
                    );

                    // Smart Thresholds
                    // Vault Mode: Use setting (default 0.5)
                    // General Mode: Use setting (default 0.85)
                    const threshold = this.chatMode === 'general'
                        ? (this.plugin.settings.ragThresholdGeneral || CONSTANTS.RAG_THRESHOLD_GENERAL)
                        : (this.plugin.settings.ragThresholdVault || CONSTANTS.RAG_THRESHOLD_VAULT);

                    // Call find_similar on the smartVault INSTANCE, not the module
                    const similar = this.plugin.smartVault.find_similar(queryVec, threshold);
                    const topDocs = similar.slice(0, 5);

                    new Notice(`RAG Info:\nMode: ${this.chatMode}\nThreshold: ${threshold}\nFound: ${similar.length} docs\nTop: ${similar.length > 0 ? similar[0].score.toFixed(2) : 'N/A'}`);

                    if (topDocs.length > 0) {
                        vaultContext = "RELEVANT NOTES FROM VAULT:\n";
                        for (const doc of topDocs) {
                            const file = this.app.vault.getAbstractFileByPath(doc.path);
                            if (file instanceof TFile) {
                                if (usedSources.includes(file.path)) continue;
                                // if (file.path === this.currentFile?.path) continue; // Not needed if detached

                                usedSources.push(file.path);
                                const content = await this.app.vault.read(file);
                                const safeContent = content.length > CONSTANTS.CHAT_CONTEXT_LIMIT_RAG_NOTE ? content.substring(0, CONSTANTS.CHAT_CONTEXT_LIMIT_RAG_NOTE) + "..." : content;
                                vaultContext += `--- Note: ${file.basename} (Score: ${doc.score.toFixed(2)}) ---\n${safeContent}\n\n`;
                            }
                        }
                    } else {
                        if (this.chatMode === 'vault') {
                            vaultContext = "NO RELEVANT NOTES FOUND IN VAULT (Low Similarity).\n";
                        }
                        // In General Mode, if no results, we just don't add vaultContext (leave it empty)
                    }
                } catch (e) {
                    const error = e as Error;
                    if (this.plugin.settings.debugMode) {
                        console.warn("RAG failed:", error);
                    }
                    new Notice(`RAG Failed: ${error.message || error}`, 0); // 0 = Persistent
                }
            }

            // 3. Construct Prompt
            loadingMsg.content = "Thinking...";
            this.render();

            const fullContext = agenticContext + context + vaultContext;
            const finalContext = fullContext.length > CONSTANTS.CHAT_CONTEXT_LIMIT_TOTAL ? fullContext.substring(0, CONSTANTS.CHAT_CONTEXT_LIMIT_TOTAL) + "\n...[truncated]" : fullContext;

            let systemPrompt = "";

            if (this.chatMode === 'strict') {
                systemPrompt = PROMPTS.CHAT_SYSTEM_STRICT;
            } else if (this.chatMode === 'vault') {
                systemPrompt = PROMPTS.CHAT_SYSTEM_VAULT;
            } else {
                // GENERAL MODE
                systemPrompt = PROMPTS.CHAT_SYSTEM_GENERAL;
            }

            const prompt = `${systemPrompt}\n\nCONTEXT:\n${finalContext}\n\nUSER QUESTION:\n${userMsg}`;
            const temp = this.plugin.settings.chatTemperature ?? CONSTANTS.CHAT_TEMPERATURE;

            const response = await wasmModule.generate_text_ollama(
                this.plugin.settings.ollamaEndpoint,
                model,
                prompt,
                temp,
                false
            );

            this.history.pop();
            const { actions, cleanResponse } = this.extractActions(response);

            // Push response
            this.history.push({ role: 'assistant', content: cleanResponse, sources: usedSources });

            // Execute Actions
            if (actions.length > 0) {
                for (const action of actions) {
                    const result = await this.executeAction(action);
                    this.history.push({ role: 'assistant', content: `[SYSTEM] ${result}` });
                }
            }

            this.render();

            // Save History
            const fileToSave = this.currentFile;
            if (fileToSave && this.plugin.cacheManager) {
                const history = await this.plugin.cacheManager.loadChatHistory();
                history[fileToSave.path] = this.history;
                await this.plugin.cacheManager.saveChatHistory(history);
            }

        } catch (e) {
            const error = e as Error;
            this.history.pop();
            this.history.push({ role: 'assistant', content: `Error: ${error.message || error}` });
            this.render();
        }
    }

    // --- Agentic Tools ---

    private getRecentFiles(count: number = 10): string {
        const files = this.app.vault.getMarkdownFiles();
        files.sort((a, b) => b.stat.mtime - a.stat.mtime);

        let output = `### Recent Files (Last ${count})\n`;
        files.slice(0, count).forEach((f, i) => {
            const date = new Date(f.stat.mtime).toLocaleString();
            output += `${i + 1}. [[${f.basename}]] (Modified: ${date})\n`;
        });
        return output;
    }

    private async getDailyNote(offset: number = 0): Promise<string> {
        // Simple YYYY-MM-DD check for now. 
        // In a real plugin we might check the user's daily note settings format.
        const date = new Date();
        date.setDate(date.getDate() + offset);
        const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD

        // Try to find file with this name (fuzzy match)
        const files = this.app.vault.getMarkdownFiles();
        const match = files.find(f => f.basename === dateStr || f.path.includes(dateStr));

        if (match) {
            const content = await this.app.vault.read(match);
            return `### Daily Note for ${dateStr} ([[${match.basename}]])\n${content.substring(0, CONSTANTS.CHAT_CONTEXT_LIMIT_DAILY_NOTE)}\n...[truncated]`;
        }
        return `No daily note found for date: ${dateStr}`;
    }

    private async getPendingTasks(): Promise<string> {
        let output = "### Pending Tasks found in recent files:\n";
        let found = 0;

        // 1. Check Today's Daily Note
        const dateStr = new Date().toISOString().split('T')[0];
        const files = this.app.vault.getMarkdownFiles();
        const daily = files.find(f => f.basename === dateStr || f.path.includes(dateStr));

        const filesToCheck = daily ? [daily] : [];

        // 2. Add last 3 modified files (deduplicated)
        files.sort((a, b) => b.stat.mtime - a.stat.mtime);
        for (const f of files.slice(0, 5)) {
            if (!filesToCheck.includes(f)) filesToCheck.push(f);
            if (filesToCheck.length >= 4) break;
        }

        // 3. Scan
        for (const file of filesToCheck) {
            const content = await this.app.vault.read(file);
            const lines = content.split('\n');
            let fileTasks = "";
            lines.forEach((line, _i) => {
                // Match "- [ ] " or "* [ ] " ignoring indentation
                if (/^\s*[-*]\s*\[ \]\s+/.test(line)) {
                    fileTasks += `   - ${line.trim()} (in [[${file.basename}]])\n`;
                    found++;
                }
            });
            if (fileTasks) output += fileTasks;
        }

        if (found === 0) return "No pending tasks found in daily note or recent files.";
        return output;
    }

    private getVaultStats(): string {
        const mdFiles = this.app.vault.getMarkdownFiles();
        const allFiles = this.app.vault.getFiles();

        // Find newest
        const newest = mdFiles.reduce((a, b) => a.stat.mtime > b.stat.mtime ? a : b, mdFiles[0]);
        // Find oldest (by creation)
        const oldest = mdFiles.reduce((a, b) => a.stat.ctime < b.stat.ctime ? a : b, mdFiles[0]);

        return `### Vault Statistics
- Total Notes: ${mdFiles.length}
- Total Files (incl. attachments): ${allFiles.length}
- Newest Note: [[${newest?.basename}]] (${new Date(newest?.stat.mtime).toLocaleDateString()})
- Oldest Note: [[${oldest?.basename}]] (${new Date(oldest?.stat.ctime).toLocaleDateString()})
`;
    }

    private async performCreateNote(query: string): Promise<string> {
        // Regex to extract title: "Create note (called/about) X"
        // Patterns:
        // create note called "My Note"
        // create note about cats
        // make a new note named Project X

        const match = query.match(/(?:create|make|new)\s+(?:note|file)\s+(?:called|named|about|titled)?\s?["']?([^"']+)["']?/i);
        if (match && match[1]) {
            let title = match[1].trim();
            // Clean title
            title = title.replace(/[\\/:*?"<>|]/g, '-');

            const path = `${title}.md`;
            const file = this.app.vault.getAbstractFileByPath(path);

            // Handle duplicate
            if (file) {
                return `SYSTEM: Cannot create note. File "[[${title}]]" already exists.`;
            }

            try {
                await this.app.vault.create(path, `# ${title}\n\nCreated by smart vault ai.\n`);
                // Open the new file? Maybe not, just notify.
                return `SYSTEM ACTION: Successfully created new note [[${title}]].`;
            } catch (e) {
                const error = e as Error;
                return `SYSTEM ERROR: Failed to create note "${title}". ${error.message}`;
            }
        }
        return "";
    }

    private async performSmartInsert(query: string): Promise<string> {
        // Regex: "Insert (a) paragraph/text/code about X"
        const match = query.match(/(?:insert|write|generate)\s+(?:a\s+)?(?:paragraph|text|code|snippet|summary)\s+(?:about|on|for|of)\s+(.+)/i);

        if (!match || !match[1]) return "";

        const topic = match[1].trim();

        if (!this.currentFile) {
            return "SYSTEM ERROR: No active file context. Please select a note first.";
        }

        const view = this.getActiveEditor(this.currentFile);

        if (!view) {
            return "SYSTEM ERROR: Could not find active editor for current file. Please open the note.";
        }


        try {
            // Generate content
            const model = this.plugin.settings.chatModel || this.plugin.settings.llmModel;
            const prompt = `Write a concise ${query.includes('code') ? 'code snippet' : 'paragraph'} about: ${topic}.
            Output ONLY the content to be inserted. Do not include "Here is the text" or Markdown fences unless it is code.`;

            const content = await this.plugin.wasmModule.generate_text_ollama(
                this.plugin.settings.ollamaEndpoint,
                model,
                prompt,
                CONSTANTS.SMART_INSERT_TEMPERATURE,
                false
            );

            // Insert at cursor
            const cursor = view.editor.getCursor();
            view.editor.replaceRange(content + "\n", cursor);

            return `SYSTEM ACTION: Successfully inserted text about "${topic}" into [[${view.file?.basename}]].`;
        } catch (e) {
            const error = e as Error;
            return `SYSTEM ERROR: Failed to generate/insert text. ${error.message}`;
        }
    }

    private async detectIntents(query: string): Promise<string> {
        const q = query.toLowerCase();
        let context = "";

        // 1. Recent Files Intent
        if (q.includes("recent") || q.includes("last updated") || q.includes("worked on") || q.includes("latest note")) {
            context += this.getRecentFiles(CONSTANTS.CHAT_RECENT_FILES_COUNT) + "\n\n";
        }

        // 2. Daily Note Intent
        if (q.includes("today") || q.includes("daily note")) {
            context += await this.getDailyNote(0) + "\n\n";
        } else if (q.includes("yesterday")) {
            context += await this.getDailyNote(-1) + "\n\n";
        }

        // 3. Pending Tasks
        if (q.includes("todo") || q.includes("task") || q.includes("what do i need to do")) {
            context += await this.getPendingTasks() + "\n\n";
        }

        // 4. Vault Stats
        if (q.includes("stats") || q.includes("how many notes") || q.includes("word count")) {
            context += this.getVaultStats() + "\n\n";
        }

        // 5. Create Note Action
        if ((q.includes("create") || q.includes("make") || q.includes("new")) && (q.includes("note") || q.includes("file"))) {
            context += await this.performCreateNote(query) + "\n\n";
        }

        // 6. Smart Insert Action
        // Must contain "insert" and ("paragraph" or "text" or "code")
        if (q.includes("insert") && (q.includes("paragraph") || q.includes("text") || q.includes("code") || q.includes("snippet"))) {
            const result = await this.performSmartInsert(query);
            // If regex matched and action performed, return result
            if (result) context += result + "\n\n";
        }

        // 7. Cross-Link / Connection Agent
        if ((q.includes("connection") || q.includes("relation") || q.includes("link") || q.includes("compare")) &&
            (q.includes("between") || q.includes("and"))) {
            const result = await this.performCrossLinkAnalysis(query);
            if (result) context += result + "\n\n";
        }

        return context;
    }

    private async performCrossLinkAnalysis(query: string): Promise<string> {
        // Regex: "between Note A and Note B" or "connection of X and Y"
        // Try to capture [[Link]] syntax first, then loose words
        // Case 1: [[Note A]] and [[Note B]]
        const linkRegex = /\[\[(.*?)\]\].*?and.*?\[\[(.*?)\]\]/i;
        let match = query.match(linkRegex);

        let fileAStr = "";
        let fileBStr = "";

        if (match && match[1] && match[2]) {
            fileAStr = match[1];
            fileBStr = match[2];
        } else {
            // Case 2: between "Note A" and "Note B"
            const quoteRegex = /["'](.*?)["'].*?and.*?["'](.*?)["']/i;
            match = query.match(quoteRegex);
            if (match && match[1] && match[2]) {
                fileAStr = match[1];
                fileBStr = match[2];
            }
        }

        if (!fileAStr || !fileBStr) return "";

        // Find files
        const files = this.app.vault.getMarkdownFiles();
        const fileA = files.find(f => f.basename.toLowerCase() === fileAStr.toLowerCase());
        const fileB = files.find(f => f.basename.toLowerCase() === fileBStr.toLowerCase());

        if (!fileA || !fileB) return `SYSTEM: Could not find one or both files: "${fileAStr}", "${fileBStr}". Please check the names.`;

        // Read Content
        const contentA = await this.app.vault.read(fileA);
        const contentB = await this.app.vault.read(fileB);

        return `### Cross-Link Analysis Request
The user wants to find connections between:
1. [[${fileA.basename}]]
2. [[${fileB.basename}]]

CONTENT OF [[${fileA.basename}]]:
${contentA.substring(0, CONSTANTS.CHAT_CONTEXT_LIMIT_CROSS_LINK)}... (truncated)

CONTENT OF [[${fileB.basename}]]:
${contentB.substring(0, CONSTANTS.CHAT_CONTEXT_LIMIT_CROSS_LINK)}... (truncated)

INSTRUCTIONS:
Analyze the content of these two notes. Identify:
1. Shared concepts or themes.
2. Direct contradictions or distinct perspectives.
3. Potential "Bridge Note" ideas to connect them.
`;
    }

    // --- Agentic Actions ---

    private extractActions(response: string): { actions: ChatAction[], cleanResponse: string } {
        const actionRegex = /\[\[ACTION:(CreateNote|AppendNote)\|([^|]+)\|([\s\S]+?)\]\]/g;
        const actions: ChatAction[] = [];
        let cleanResponse = response;
        let match;

        while ((match = actionRegex.exec(response)) !== null) {
            actions.push({
                type: match[1],
                title: match[2].trim(),
                content: match[3].trim()
            });
            // Remove the tag from the visible response
            cleanResponse = cleanResponse.replace(match[0], `*[Action: ${match[1]} - ${match[2].trim()}]*`);
        }

        return { actions, cleanResponse };
    }

    private async executeAction(action: ChatAction): Promise<string> {
        try {
            const fileName = action.title.endsWith('.md') ? action.title : `${action.title}.md`;

            if (action.type === 'CreateNote') {
                const existing = this.app.vault.getAbstractFileByPath(fileName);
                if (existing) {
                    return `❌ Failed to create [[${fileName}]]: File already exists.`;
                }
                await this.app.vault.create(fileName, action.content);
                return `✅ Created note: [[${fileName}]]`;
            }

            if (action.type === 'AppendNote') {
                // Fuzzy find the file
                const files = this.app.vault.getMarkdownFiles();
                const file = files.find(f => f.basename === action.title || f.path === action.title || f.path === fileName);

                if (!file) {
                    return `❌ Failed to append: Could not find note "[[${action.title}]]".`;
                }

                const currentContent = await this.app.vault.read(file);
                await this.app.vault.modify(file, currentContent + "\n" + action.content);
                return `✅ Appended to NOTE: [[${file.basename}]]`;
            }

            return `❌ Unknown action type: ${action.type}`;
        } catch (e) {
            const error = e as Error;
            return `❌ Error executing ${action.type}: ${error.message}`;
        }
    }

    // --- End Tools ---

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
}
