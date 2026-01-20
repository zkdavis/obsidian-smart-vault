
import { App, TFile, WorkspaceLeaf } from 'obsidian';
import SmartVaultPlugin from '../../main';
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
    }

    async onClose(): Promise<void> {
        // Nothing to clean up
    }

    render(): void {
        // Delegate rendering back to the parent view's logic, but targeted at this container
        // Note: We need to adapt the parent view's render method to accept a container, 
        // or we just move the logic here.
        // For now, let's call a new method on parentView: renderSuggestions(container)
        this.parentView.renderSuggestionsToContainer(this.containerEl);
    }
}
