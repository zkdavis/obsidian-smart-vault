import { App, Modal } from 'obsidian';

export class ConfirmModal extends Modal {
    title: string;
    message: string;
    onConfirm: (confirmed: boolean) => void;

    constructor(app: App, title: string, message: string, onConfirm: (confirmed: boolean) => void) {
        super(app);
        this.title = title;
        this.message = message;
        this.onConfirm = onConfirm;
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

        const buttonContainer = contentEl.createEl('div', { cls: 'modal-button-container' });
        buttonContainer.style.display = 'flex';
        buttonContainer.style.gap = '10px';
        buttonContainer.style.marginTop = '20px';
        buttonContainer.style.justifyContent = 'flex-end';

        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.onclick = () => {
            this.onConfirm(false);
            this.close();
        };

        const confirmButton = buttonContainer.createEl('button', { text: 'Yes, Clear Everything', cls: 'mod-warning' });
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
