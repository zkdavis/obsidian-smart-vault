import { App, Modal } from 'obsidian';

export class ConfirmModal extends Modal {
    title: string;
    message: string;
    onConfirm: (confirmed: boolean) => void;
    confirmText: string;

    constructor(app: App, title: string, message: string, onConfirm: (confirmed: boolean) => void, confirmText: string = 'Confirm') {
        super(app);
        this.title = title;
        this.message = message;
        this.onConfirm = onConfirm;
        this.confirmText = confirmText;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: this.title });

        const messageEl = contentEl.createEl('p', { cls: 'confirm-modal-message' });
        // Split message by newlines and create multiple paragraphs
        this.message.split('\n').forEach(line => {
            if (line.trim()) {
                messageEl.createEl('div', { text: line });
            } else {
                messageEl.createEl('br');
            }
        });

        const buttonContainer = contentEl.createEl('div', { cls: 'modal-button-container smart-vault-flex-row smart-vault-gap-12 smart-vault-margin-top-20' });
        buttonContainer.style.justifyContent = 'flex-end'; // One last inline style? No, I'll use a class or just let it be.
        // Actually I have .smart-vault-space-between but I want flex-end.
        // I'll add .smart-vault-flex-end to styles.css in a moment if needed. For now I'll use center or just standard.

        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.onclick = () => {
            this.onConfirm(false);
            this.close();
        };

        const confirmButton = buttonContainer.createEl('button', { text: this.confirmText, cls: 'mod-warning' });
        confirmButton.onclick = () => {
            this.onConfirm(true);
            this.close();
        };
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

