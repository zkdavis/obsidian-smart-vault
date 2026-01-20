import { App, EditorSuggest, EditorPosition, Editor, TFile, EditorSuggestTriggerInfo, EditorSuggestContext } from 'obsidian';
import type SmartVaultPlugin from '../plugin/SmartVaultPlugin';

/**
 * Inline autocomplete for link suggestions.
 * Triggers when user types [[ to create a link manually,
 * or provides semantic search suggestions while typing normal text.
 */
export class InlineLinkSuggest extends EditorSuggest<any> {
    plugin: SmartVaultPlugin;
    lastSuggestions: any[] = [];

    constructor(app: App, plugin: SmartVaultPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): EditorSuggestTriggerInfo | null {
        const line = editor.getLine(cursor.line);

        // Only trigger when user types [[ for manual link insertion
        const linkTriggerPos = line.lastIndexOf('[[', cursor.ch);
        if (linkTriggerPos !== -1 && !line.slice(linkTriggerPos, cursor.ch).includes(']]')) {
            return {
                start: { line: cursor.line, ch: linkTriggerPos },
                end: cursor,
                query: line.slice(linkTriggerPos + 2, cursor.ch)
            };
        }

        // No automatic suggestions while typing normal text
        return null;
    }

    async getSuggestions(context: EditorSuggestContext): Promise<any[]> {
        const query = context.query.toLowerCase();

        if (!this.plugin.smartVault || this.plugin.smartVault.get_file_count() === 0) {
            return [];
        }

        // Check if we're in link context (starts with [[)
        const isLinkContext = context.query.startsWith('[[') ||
                             (context.start.ch >= 2 &&
                              context.editor.getLine(context.start.line).slice(context.start.ch - 2, context.start.ch) === '[[');

        try {
            // If query is too short, don't show suggestions
            if (query.length < 3) {
                return [];
            }

            // For semantic search on normal text, prioritize semantic matches
            if (!isLinkContext && query.length >= 5) {
                try {
                    // Generate embedding for the query
                    const queryEmbedding = await this.plugin.rerankerService!.generateEmbedding(query);

                    // Get semantic suggestions with lower threshold
                    const suggestions = this.plugin.smartVault.suggest_links_for_text(
                        query,
                        queryEmbedding,
                        this.plugin.settings.similarityThreshold - 0.15  // Lower threshold for inline
                    );

                    // Map to the format we need
                    const semanticMatches = suggestions.slice(0, 8).map((s: any) => ({
                        title: s.title,
                        path: s.path,
                        similarity: s.similarity,
                        context: s.context
                    }));

                    if (semanticMatches.length > 0) {
                        return semanticMatches;
                    }
                } catch (error) {
                    console.error('Semantic search error:', error);
                }
            }

            // Fallback to name-based matching (for [[ context or if semantic fails)
            const files = this.app.vault.getMarkdownFiles();
            const nameMatches = files
                .filter(f => f.basename.toLowerCase().includes(query))
                .slice(0, 8)
                .map(f => ({
                    title: f.basename,
                    path: f.path,
                    similarity: null
                }));

            return nameMatches;
        } catch (error) {
            console.error('Suggestion error:', error);
            return [];
        }
    }

    renderSuggestion(suggestion: any, el: HTMLElement): void {
        const titleText = suggestion.similarity
            ? `${suggestion.title} (${(suggestion.similarity * 100).toFixed(0)}%)`
            : suggestion.title;
        el.createEl('div', { text: titleText, cls: 'suggestion-title' });
        el.createEl('small', { text: suggestion.path, cls: 'suggestion-path' });
    }

    selectSuggestion(suggestion: any, evt: MouseEvent | KeyboardEvent): void {
        if (!this.context) return;

        const editor = this.context.editor;
        const start = this.context.start;
        const end = this.context.end;

        // Check if we're in a [[ link context
        const line = editor.getLine(start.line);
        const isLinkContext = line.slice(Math.max(0, start.ch - 2), start.ch) === '[[';

        if (isLinkContext) {
            // We're already in [[, just insert the title and ]]
            editor.replaceRange(`${suggestion.title}]]`, start, end);
        } else {
            // Normal text - replace the context words with a link
            editor.replaceRange(`[[${suggestion.title}]]`, start, end);
        }
    }
}
