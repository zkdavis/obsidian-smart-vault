import { App, TFile } from 'obsidian';
import SmartVaultPlugin from '../../plugin/SmartVaultPlugin';

export abstract class BaseTab {
    app: App;
    plugin: SmartVaultPlugin;
    containerEl: HTMLElement;

    constructor(app: App, plugin: SmartVaultPlugin, containerEl: HTMLElement) {
        this.app = app;
        this.plugin = plugin;
        this.containerEl = containerEl;
    }

    abstract render(): void;
    abstract onOpen(): Promise<void>;
    abstract onClose(): Promise<void>;
    abstract setFileContext(file: TFile): void;
}
