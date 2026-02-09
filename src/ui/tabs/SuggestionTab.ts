import { App, TFile } from 'obsidian';
import SmartVaultPlugin from '../../plugin/SmartVaultPlugin';
import { BaseTab } from './BaseTab';
import { LinkSuggestionView } from '../LinkSuggestionView';

export class SuggestionTab extends BaseTab {
    private parentView: LinkSuggestionView;
    private currentFile: TFile | null = null;

    constructor(app: App, plugin: SmartVaultPlugin, containerEl: HTMLElement, parentView: LinkSuggestionView) {
        super(app, plugin, containerEl);
        this.parentView = parentView;
    }

    setFileContext(file: TFile): void {
        this.currentFile = file;
    }

    async onOpen(): Promise<void> {
        this.render();
        await Promise.resolve();
    }

    async onClose(): Promise<void> {
        // Nothing to clean up
    }

    render(): void {
        // Delegate rendering back to the parent view's logic, but targeted at this container
        this.parentView.renderSuggestionsToContainer(this.containerEl);
    }
}
