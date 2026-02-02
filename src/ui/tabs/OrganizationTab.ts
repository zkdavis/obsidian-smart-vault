import { App, Notice, TFile, TFolder } from 'obsidian';
import SmartVaultPlugin from '../../plugin/SmartVaultPlugin';
import { BaseTab } from './BaseTab';
import type { OrganizationCacheData } from '../../settings/types';

/**
 * Interface for a suggested folder placement
 */
interface OrganizationSuggestion {
    folder: string;
    confidence: number;
    reason?: string;
    is_new_path?: boolean;
}

interface OrganizationAnalysisResult {
    suggestions: OrganizationSuggestion[];
    explanation?: string;
}

export class OrganizationTab extends BaseTab {
    private currentFile: TFile | null = null;
    private lastResult: OrganizationAnalysisResult | null = null;
    private lastResultPath: string | null = null;
    private isLoading: boolean = false;

    constructor(app: App, plugin: SmartVaultPlugin, containerEl: HTMLElement) {
        super(app, plugin, containerEl);
    }

    async onOpen(): Promise<void> {
        this.render();
        await Promise.resolve();
    }

    async onClose(): Promise<void> {
        this.containerEl.empty();
        await Promise.resolve();
    }

    setFileContext(file: TFile): void {
        this.currentFile = file;
    }

    render(): void {
        this.containerEl.empty();
        const content = this.containerEl.createDiv({ cls: 'smart-vault-organization-tab' });

        content.createEl('h3', { text: 'Smart organization' });

        const controls = content.createDiv({ cls: 'smart-vault-controls' });
        const analyzeBtn = controls.createEl('button', { text: 'Suggest placement', cls: 'mod-cta' });

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

    async analyzePlacement(_container: HTMLElement) {
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
                console.debug(`[DEBUG] Cache hit for ${cacheKey}`);
            }
            this.lastResult = cached.data as OrganizationAnalysisResult; // Cast cached data
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
                console.debug(`[DEBUG] analyze_organization called for ${this.currentFile.basename}`);
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
            const timeoutPromise = new Promise<unknown>((_, reject) => {
                setTimeout(() => reject(new Error('Organization analysis timed out')), timeoutMs);
            });

            let result = await Promise.race([llmCall, timeoutPromise]);


            if (this.plugin.settings.debugMode) {
                console.debug(`[DEBUG] analyze_organization completed`);
                console.debug(`[DEBUG] Result Type:`, typeof result);
            }

            // Handle potential string return from WASM
            if (typeof result === 'string') {
                if (this.plugin.settings.debugMode) console.debug(`[DEBUG] parsing string result:`, result);
                try {
                    // Clean Markdown code blocks if present
                    const clean = result.replace(/```json/g, '').replace(/```/g, '').trim();
                    result = JSON.parse(clean);
                } catch (e) {
                    console.error("Failed to parse organization JSON", e);
                    new Notice("Failed to parse AI response. Check console for details.");
                }
            } else {
                if (this.plugin.settings.debugMode) console.debug(`[DEBUG] Received object result:`, result);
            }

            // Normalize Maps to Objects (caused by serde_wasm_bindgen with ES6 Maps)
            result = this.normalizeData(result);

            if (this.plugin.settings.debugMode) {
                console.debug(`[DEBUG] Normalized result:`, result);
            }

            this.lastResult = result as OrganizationAnalysisResult; // Cast to the new type
            this.lastResultPath = this.currentFile.path;

            // CACHE WRITE
            if (!this.plugin.settings.organizationCache) this.plugin.settings.organizationCache = {};

            const cacheEntry = {
                mtime: this.currentFile.stat.mtime,
                data: result as OrganizationCacheData // Ensure this matches the cache data type
            };
            this.plugin.settings.organizationCache[this.currentFile.path] = cacheEntry;

            if (this.plugin.settings.debugMode) {
                console.debug(`[DEBUG] Wrote to Organization Cache for ${this.currentFile.path}`, cacheEntry);
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

    // This function needs to handle 'any' input because the WASM module might return various types
    // before normalization, and the cache might store 'any' if not strictly typed.
    // The return type should be 'any' or a more general type if it can return different structures.
    // For now, keeping it as 'any' to allow for flexible normalization.
    private normalizeData(data: unknown): unknown {
        if (data instanceof Map) {
            const obj: Record<string, unknown> = {};
            for (const [key, value] of data.entries()) {
                obj[String(key)] = this.normalizeData(value);
            }
            return obj;
        }
        if (Array.isArray(data)) {
            return data.map(item => this.normalizeData(item));
        }
        if (typeof data === 'object' && data !== null) {
            const obj: Record<string, unknown> = {};
            for (const key in data) {
                if (Object.prototype.hasOwnProperty.call(data, key)) {
                    obj[key] = this.normalizeData((data as Record<string, unknown>)[key]);
                }
            }
            return obj;
        }
        return data;
    }

    renderResult(container: HTMLElement, result: OrganizationAnalysisResult, file: TFile) {
        container.empty();

        // Robust suggestion extraction
        let suggestions: OrganizationSuggestion[] = [];
        if (result && Array.isArray(result.suggestions)) {
            suggestions = result.suggestions;
        }

        if (suggestions.length === 0) {
            container.createEl('p', { text: 'No organization suggestions found for this note.' });
            if (result.explanation) {
                container.createEl('p', { text: result.explanation, cls: 'smart-vault-explanation' });
            }
            return;
        }

        // Sort by confidence
        suggestions.sort((a, b) => b.confidence - a.confidence);

        const list = container.createDiv({ cls: 'smart-vault-suggestion-list' });

        if (result.explanation) {
            container.createEl('p', { text: result.explanation, cls: 'smart-vault-explanation' });
        }

        suggestions.forEach(suggestion => {
            const item = list.createDiv({ cls: 'smart-vault-suggestion-item' });

            const card = item.createDiv({ cls: 'suggestion-card' });

            const header = card.createDiv({ cls: 'suggestion-header' });
            header.createEl('span', { text: '📁 Suggested Folder:', cls: 'suggestion-label' });
            header.createEl('code', { text: suggestion.folder, cls: 'suggestion-value' });

            const confidence = card.createDiv({ cls: 'suggestion-confidence' });
            const percent = Math.round(suggestion.confidence * 100);
            confidence.createEl('span', { text: `Confidence: ${percent}%` });

            const meter = confidence.createDiv({
                cls: 'confidence-meter'
            });
            meter.createDiv({
                cls: 'confidence-fill',
                attr: { style: `width: ${percent}%` }
            });

            if (suggestion.reason) {
                card.createDiv({ text: suggestion.reason, cls: 'suggestion-reason' });
            }

            if (suggestion.is_new_path) {
                card.createDiv({ text: '✨ New folder path', cls: 'suggestion-badge' });
            }

            const actions = item.createDiv({ cls: 'suggestion-actions' });
            const moveBtn = actions.createEl('button', { text: 'Move File', cls: 'mod-cta' });

            moveBtn.onclick = async () => {
                await this.moveFile(file, suggestion.folder);
            };
        });
    }

    private async moveFile(file: TFile, targetPath: string): Promise<void> {
        try {
            // Ensure the target folder exists
            await this.ensureFolderExists(targetPath);

            const newPath = `${targetPath}/${file.name}`;
            await this.app.fileManager.renameFile(file, newPath);
            new Notice(`Moved ${file.name} to ${targetPath}`);

            // Clear result since file moved
            this.lastResult = null;
            this.lastResultPath = null;
            this.render();
        } catch (error) {
            console.error('Move failed:', error);
            new Notice(`Move failed: ${error.message}`);
        }
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
            } catch (error) {
                const e = error as Error;
                // Ignore "Folder already exists" errors, fail on others
                if (e.message && e.message.includes("already exists")) {
                    // benign
                } else {
                    console.error(`Failed to create folder ${currentPath}:`, e);
                    throw e;
                }
            }
        }
    }
}
