import { TAbstractFile, TFile, TFolder, Notice, Platform } from 'obsidian';
import * as pdfjsLib from 'pdfjs-dist';
import SmartVaultPlugin from '../SmartVaultPlugin';

// Set worker source for PDF.js
// We copied 'pdf.worker.min.js' to the plugin folder during build.
if (Platform.isDesktopApp) {
    // We can't set it here easily because we need 'app' to get the resource path.
    // We will set it in the constructor/register method instead.
}

export class HandwrittenNoteWatcher {
    private processingQueue: Set<string> = new Set();

    constructor(private plugin: SmartVaultPlugin) { }

    register() {
        const workerPath = this.plugin.app.vault.adapter.getResourcePath(
            `${this.plugin.manifest.dir}/pdf.worker.min.js`
        );
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;
        if (this.plugin.settings.debugMode) {
            console.log(`[HandwrittenWatcher] Set PDF worker path: ${workerPath}`);
        }

        this.plugin.registerEvent(
            this.plugin.app.vault.on('create', (file) => {
                this.processFile(file);
            })
        );

        // Register manual command
        this.plugin.addCommand({
            id: 'process-handwritten-inbox',
            name: 'Process Handwritten Inbox Now',
            callback: () => this.processInboxNow()
        });

        // Register DEBUG command
        this.plugin.addCommand({
            id: 'debug-current-handwritten-file',
            name: 'Debug: Process Current File (Vision)',
            checkCallback: (checking: boolean) => {
                const file = this.plugin.app.workspace.getActiveFile();
                if (file && ['png', 'jpg', 'jpeg', 'webp', 'pdf'].includes(file.extension.toLowerCase())) {
                    if (!checking) {
                        this.transcribeAndMove(file, true);
                    }
                    return true;
                }
                return false;
            }
        });

        if (this.plugin.settings.debugMode) {
            console.log("HandwrittenNoteWatcher registered");
        }
    }

    async processInboxNow() {
        const settings = this.plugin.settings;
        const folder = this.plugin.app.vault.getAbstractFileByPath(settings.handwrittenInbox);

        if (!(folder instanceof TFolder)) {
            new Notice(`Inbox folder not found or invalid: ${settings.handwrittenInbox}`);
            return;
        }

        let count = 0;
        for (const file of folder.children) {
            if (file instanceof TFile) {
                this.processFile(file);
                count++;
            }
        }
        new Notice(`Processing ${count} files in inbox...`);
    }

    private async processFile(file: TAbstractFile) {
        if (!(file instanceof TFile)) return;

        const settings = this.plugin.settings;

        if (!settings.handwrittenInbox || !file.path.startsWith(settings.handwrittenInbox)) {
            return;
        }

        // Support Images AND PDF
        const validExtensions = ['png', 'jpg', 'jpeg', 'webp', 'pdf'];
        if (!validExtensions.includes(file.extension.toLowerCase())) {
            return;
        }

        if (settings.debugMode) {
            console.log(`[HandwrittenWatcher] Detected new file: ${file.path}`);
        }

        // specific debounce for new files
        setTimeout(() => this.transcribeAndMove(file), 1000);
    }

    // allow force debug
    private async transcribeAndMove(file: TFile, forceDebug = false) {
        if (this.processingQueue.has(file.path)) return;
        this.processingQueue.add(file.path);

        new Notice(`✍️ Processing: ${file.name}`);

        try {
            const { settings, wasmModule } = this.plugin;
            let imagesBase64: string[] = [];

            // Handle PDF vs Image
            if (file.extension.toLowerCase() === 'pdf') {
                new Notice(`📄 Converting PDF key pages...`);
                imagesBase64 = await this.convertPdfToImages(file);
            } else {
                const arrayBuffer = await this.plugin.app.vault.readBinary(file);
                // Enhance single image? Ideally yes, but need canvas. 
                // For now, raw image for non-PDFs (or we can add image-enhance later).
                // Let's keep it simple for single images for now.
                imagesBase64 = [this.arrayBufferToBase64(arrayBuffer)];
            }

            let fullTranscript = "";
            let generatedTitle = "";

            // Loop through pages
            for (let i = 0; i < imagesBase64.length; i++) {
                const image = imagesBase64[i];
                if (forceDebug || settings.debugMode) {
                    console.log(`[HandwrittenDebug] Page ${i + 1}: Image Base64 length ${image.length}`);
                    new Notice(`Debug: Sending Page ${i + 1} to ${settings.visionModel}...`);

                    // Save the debug image to attachment folder so user can see what AI sees
                    const attachmentFolder = settings.handwrittenAttachmentsFolder || 'Attachments/Handwritten';
                    // Sanitize filename
                    const safeName = file.basename.replace(/[^a-zA-Z0-9-_]/g, '');
                    const debugPath = `${attachmentFolder}/debug_${safeName}_page${i + 1}.jpg`;

                    const buffer = Buffer.from(image, 'base64');
                    try {
                        // Ensure folder exists
                        if (!(await this.plugin.app.vault.adapter.exists(attachmentFolder))) {
                            await this.plugin.app.vault.createFolder(attachmentFolder);
                        }

                        if (await this.plugin.app.vault.adapter.exists(debugPath)) await this.plugin.app.vault.adapter.remove(debugPath);
                        await this.plugin.app.vault.adapter.writeBinary(debugPath, buffer.buffer);
                        new Notice(`Debug: Saved pre-processed image to ${debugPath}`);
                        console.log(`[HandwrittenDebug] Saved ${debugPath}`);
                    } catch (err) {
                        console.error("[HandwrittenDebug] Failed to save debug image", err);
                    }
                }

                new Notice(`🧠 Reading Page ${i + 1}/${imagesBase64.length}...`);
                const startTime = Date.now();

                // Slow Model Warning: Notify user if it takes > 20 seconds (likely loading or heavy)
                const checkTimer = setTimeout(() => {
                    new Notice(`⚠️ Model is taking a while (${Math.round((Date.now() - startTime) / 1000)}s)...`);
                    new Notice(`If it hangs > 60s, check console or switch to a smaller model (e.g. qwen2.5vl:3b).`);
                }, 20000);

                let pageTranscript = "";
                try {
                    pageTranscript = await wasmModule.transcribe_image_with_llm(
                        settings.ollamaEndpoint,
                        settings.visionModel,
                        image,
                        settings.debugMode || forceDebug
                    );
                } finally {
                    clearTimeout(checkTimer);
                }

                if (forceDebug || settings.debugMode) {
                    console.log(`[HandwrittenDebug] Response received in ${Date.now() - startTime}ms`);
                    console.log(`[HandwrittenDebug] Raw Output:\n${pageTranscript}`);
                }

                // Clean up conversational filler
                const conversationalRegex = /^(Here is|Sure|Okay|I can|Transcribing|The image|This text|The transcription).*/i;
                let lines = pageTranscript.split('\n');
                while (lines.length > 0 && (conversationalRegex.test(lines[0]) || lines[0].trim() === '')) {
                    lines.shift();
                }

                // Title extraction (only from Page 1)
                if (i === 0) {
                    const joined = lines.join('\n').trim();
                    const headerMatch = joined.match(/^#\s+(.*)/);
                    if (headerMatch && headerMatch[1]) {
                        const candidate = headerMatch[1].trim();
                        if (candidate.length > 2 && !candidate.toLowerCase().includes('transcription')) {
                            generatedTitle = candidate;
                            // Formatting: If we found a title, keep it as the main header of the doc
                        }
                    }
                }

                fullTranscript += `\n\n## Page ${i + 1}\n\n` + lines.join('\n').trim();
            }

            // Cleanup
            fullTranscript = fullTranscript.trim();
            if (!fullTranscript || fullTranscript.length < 10) {
                fullTranscript = "_[No text transcribed. Verify image quality or model capabilities.]_";
            }

            // Move Original File
            const attachmentFolder = settings.handwrittenAttachmentsFolder || 'Attachments/Handwritten';

            // Ensure folder exists
            if (!(await this.plugin.app.vault.adapter.exists(attachmentFolder))) {
                await this.plugin.app.vault.createFolder(attachmentFolder);
            }

            // Handle collision for moved file
            let newPath = `${attachmentFolder}/${file.name}`;
            let moveCounter = 1;
            while (await this.plugin.app.vault.adapter.exists(newPath)) {
                const nameParts = file.name.split('.');
                const extension = nameParts.pop();
                const basename = nameParts.join('.');
                newPath = `${attachmentFolder}/${basename} (${moveCounter}).${extension}`;
                moveCounter++;
            }

            await this.plugin.app.fileManager.renameFile(file, newPath);

            // Create Transcript file
            const safeTitle = generatedTitle ? generatedTitle.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() : (file.basename.replace(/[^a-zA-Z0-9-_ ]/g, '') || 'Untitled');
            let targetPath = `${settings.transcriptFolder}/${safeTitle}.md`;

            // Handle collision
            let counter = 1;
            while (await this.plugin.app.vault.adapter.exists(targetPath)) {
                targetPath = `${settings.transcriptFolder}/${safeTitle} (${counter}).md`;
                counter++;
            }

            const content = `---
source: "[[${newPath}]]"
model: ${settings.visionModel}
---
# ${safeTitle}

${fullTranscript}
`;

            const newFile = await this.plugin.app.vault.create(targetPath, content);
            new Notice(`✅ Transcript created: ${newFile.basename}`);

        } catch (e: any) {
            console.error("Transcription failed:", e);
            new Notice(`❌ Failed to process ${file.name}: ${e.message || e}`);
        } finally {
            this.processingQueue.delete(file.path);
        }
    }

    private async convertPdfToImages(file: TFile): Promise<string[]> {
        const arrayBuffer = await this.plugin.app.vault.readBinary(file);
        const data = new Uint8Array(arrayBuffer);

        // Load PDF
        const loadingTask = pdfjsLib.getDocument({ data });
        const pdf = await loadingTask.promise;
        const totalPages = pdf.numPages;
        const results: string[] = [];

        // Limit to 5 pages to prevent timeouts/OOM for now
        const maxPages = Math.min(totalPages, 5);

        for (let i = 1; i <= maxPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 3.5 }); // High Res

            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            if (!context) continue;

            canvas.height = viewport.height;
            canvas.width = viewport.width;

            const renderContext: any = {
                canvasContext: context,
                viewport: viewport
            };

            await page.render(renderContext).promise;

            // --- IMAGE ENHANCEMENT (Contrast Boost) ---
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            const factor = (259 * (128 + 255)) / (255 * (259 - 128)); // High contrast factor

            for (let j = 0; j < data.length; j += 4) {
                // RGB
                data[j] = factor * (data[j] - 128) + 128;
                data[j + 1] = factor * (data[j + 1] - 128) + 128;
                data[j + 2] = factor * (data[j + 2] - 128) + 128;
            }
            context.putImageData(imageData, 0, 0);
            // ------------------------------------------

            results.push(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
        }

        return results;
    }

    private arrayBufferToBase64(buffer: ArrayBuffer): string {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }
}
