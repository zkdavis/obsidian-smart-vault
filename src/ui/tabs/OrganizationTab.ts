
import { App, MarkdownView, Notice, TFile, TFolder } from 'obsidian';
import SmartVaultPlugin from '../../main';
import { BaseTab } from './BaseTab';

export class OrganizationTab extends BaseTab {
    private currentFile: TFile | null = null;
    private lastResult: any | null = null;
    private lastResultPath: string | null = null;
    private isLoading: boolean = false;

    constructor(app: App, plugin: SmartVaultPlugin, containerEl: HTMLElement) {
        super(app, plugin, containerEl);
    }

    async onOpen(): Promise<void> {
        this.render();
    }

    async onClose(): Promise<void> {
        this.containerEl.empty();
    }

    setFileContext(file: TFile): void {
        this.currentFile = file;
    }

    render(): void {
        this.containerEl.empty();
        const content = this.containerEl.createDiv({ cls: 'smart-vault-organization-tab' });

        content.createEl('h3', { text: 'Smart Organization' });

        const controls = content.createDiv({ cls: 'smart-vault-controls' });
        const analyzeBtn = controls.createEl('button', { text: 'Suggest Placement', cls: 'mod-cta' });

        const outputArea = content.createDiv({ cls: 'smart-vault-output' });

        analyzeBtn.onclick = async () => {
            await this.analyzePlacement(outputArea);
        };

        if (this.isLoading) {
            outputArea.empty();
            outputArea.createEl('div', { cls: 'smart-vault-loading', text: '📂 Analyzing vault structure... (switch tabs freely)' });
        } else if (this.currentFile && this.lastResult && this.lastResultPath === this.currentFile.path) {
            this.renderResult(outputArea, this.lastResult, this.currentFile);
        }
    }

    async analyzePlacement(container: HTMLElement) {
        if (!this.currentFile) {
            new Notice('No active file context');
            return;
        }

        const mtime = this.currentFile.stat.mtime;
        const cacheKey = this.currentFile.path;

        // CACHE CHECK (Optimized direct check)
        const cached = this.plugin.settings.organizationCache?.[cacheKey];
        if (cached && cached.mtime === mtime && cached.data) {
            if (this.plugin.settings.debugMode) {
                console.log(`[DEBUG] Cache hit for ${cacheKey}`);
            }
            this.lastResult = cached.data;
            this.lastResultPath = cacheKey;
            this.render();
            return;
        }

        this.isLoading = true;
        this.render();

        try {
            const content = await this.app.vault.read(this.currentFile);

            const allFolders = this.app.vault.getAllLoadedFiles()
                .filter(f => f instanceof TFolder)
                .map(f => f.path);

            const { wasmModule } = this.plugin;

            if (this.plugin.settings.debugMode) {
                console.log(`[DEBUG] analyze_organization called for ${this.currentFile.basename}`);
            }

            const model = this.plugin.settings.organizationModel || this.plugin.settings.llmModel;

            const llmCall = wasmModule.analyze_organization_with_llm(
                this.plugin.settings.ollamaEndpoint,
                model,
                this.currentFile.basename,
                content,
                allFolders,
                this.plugin.settings.llmTemperature,
                this.plugin.settings.enableThinkingMode,
                this.plugin.settings.debugMode
            );

            const timeoutMs = this.plugin.settings.llmTimeout || 30000;
            const timeoutPromise = new Promise<any>((_, reject) => {
                setTimeout(() => reject(new Error('Organization analysis timed out')), timeoutMs);
            });

            let result = await Promise.race([llmCall, timeoutPromise]);


            if (this.plugin.settings.debugMode) {
                console.log(`[DEBUG] analyze_organization completed`);
                console.log(`[DEBUG] Result Type:`, typeof result);
            }

            // Handle potential string return from WASM
            if (typeof result === 'string') {
                if (this.plugin.settings.debugMode) console.log(`[DEBUG] parsing string result:`, result);
                try {
                    // Clean Markdown code blocks if present
                    const clean = result.replace(/```json/g, '').replace(/```/g, '').trim();
                    result = JSON.parse(clean);
                } catch (e) {
                    console.error("Failed to parse organization JSON", e);
                    new Notice("Failed to parse AI response. Check console for details.");
                }
            } else {
                if (this.plugin.settings.debugMode) console.log(`[DEBUG] Received object result:`, result);
            }

            // Normalize Maps to Objects (caused by serde_wasm_bindgen with ES6 Maps)
            result = this.normalizeData(result);

            if (this.plugin.settings.debugMode) {
                console.log(`[DEBUG] Normalized result:`, result);
            }

            this.lastResult = result;
            this.lastResultPath = this.currentFile.path;

            // CACHE WRITE
            if (!this.plugin.settings.organizationCache) this.plugin.settings.organizationCache = {};

            const cacheEntry = {
                mtime: this.currentFile.stat.mtime,
                data: result
            };
            this.plugin.settings.organizationCache[this.currentFile.path] = cacheEntry;

            if (this.plugin.settings.debugMode) {
                console.log(`[DEBUG] Wrote to Organization Cache for ${this.currentFile.path}`, cacheEntry);
            }

            await this.plugin.saveSettings();

        } catch (e) {
            console.error(e);
            new Notice(`Analysis failed: ${e}`);
        } finally {
            this.isLoading = false;
            this.render();
        }
    }

    private normalizeData(data: any): any {
        if (data instanceof Map) {
            const obj: any = {};
            for (const [key, value] of data.entries()) {
                obj[key] = this.normalizeData(value);
            }
            return obj;
        }
        if (Array.isArray(data)) {
            return data.map(item => this.normalizeData(item));
        }
        if (typeof data === 'object' && data !== null) {
            const obj: any = {};
            for (const key in data) {
                obj[key] = this.normalizeData(data[key]);
            }
            return obj;
        }
        return data;
    }

    renderResult(container: HTMLElement, result: any, file: TFile) {
        container.empty();

        // Robust suggestion extraction
        let suggestions: any[] = [];
        if (Array.isArray(result)) {
            suggestions = result;
        } else if (result && Array.isArray(result.suggestions)) {
            suggestions = result.suggestions;
        } else if (result && typeof result === 'object') {
            suggestions = [result];
        }

        // Filter valid candidates
        suggestions = suggestions.filter(s => s && typeof s.folder === 'string' && typeof s.confidence === 'number');

        // Sort by confidence
        suggestions.sort((a: any, b: any) => b.confidence - a.confidence);

        const section = container.createDiv({ cls: 'smart-vault-section' });
        section.createEl('h4', { text: `Suggested Locations (${suggestions.length})` });

        const list = section.createDiv({ cls: 'smart-vault-scroll-view' });

        if (suggestions.length === 0) {
            list.createDiv({ text: "No valid suggestions found.", attr: { style: "font-style: italic; color: var(--text-muted);" } });
            return;
        }

        suggestions.forEach((candidate: any) => {
            const item = list.createDiv({ cls: 'smart-vault-structure-item', attr: { style: 'flex-direction: column; align-items: stretch; gap: 8px;' } });

            const header = item.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center;' } });
            header.createDiv({ text: `📂 ${candidate.folder}`, attr: { style: 'font-weight: 600; color: var(--interactive-accent);' } });
            header.createDiv({ text: `${Math.round(candidate.confidence * 100)}%`, attr: { style: 'font-size: 0.85em; color: var(--text-muted);' } });

            if (candidate.reason) {
                item.createDiv({ text: candidate.reason, cls: 'smart-vault-reason' });
            }

            const moveBtn = item.createEl('button', { text: 'Move Here', cls: 'mod-cta', attr: { style: 'align-self: flex-start; margin-top: 4px; font-size: 0.9em; padding: 4px 12px;' } });

            moveBtn.onclick = async () => {
                try {
                    const folderPath = candidate.folder;
                    // Create folder if new (recursive)
                    if (candidate.is_new_path) {
                        await this.ensureFolderExists(folderPath);
                    }

                    const newPath = `${folderPath}/${file.name}`;
                    await this.app.fileManager.renameFile(file, newPath);
                    new Notice(`Moved to ${newPath}`);
                    container.empty();
                    container.createDiv({ text: '✅ File moved successfully!' });
                } catch (err) {
                    new Notice(`Failed to move: ${err}`);
                }
            };
        });
    }

    private async ensureFolderExists(path: string) {
        if (!path || path === '/') return;

        // Strip leading/trailing slashes
        const cleanPath = path.replace(/^\/+|\/+$/g, '');
        const folders = cleanPath.split('/');
        let currentPath = '';

        for (const folder of folders) {
            currentPath = currentPath === '' ? folder : `${currentPath}/${folder}`;

            try {
                // Check if it exists (using adapter to be safe with cache/disk mismatch)
                const exists = await this.app.vault.adapter.exists(currentPath);
                if (!exists) {
                    await this.app.vault.createFolder(currentPath);
                }
            } catch (error: any) {
                // Ignore "Folder already exists" errors, fail on others
                if (error.message && error.message.includes("already exists")) {
                    // benign
                } else {
                    console.error(`Failed to create folder ${currentPath}:`, error);
                    throw error;
                }
            }
        }
    }
}
