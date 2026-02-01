import { TAbstractFile, TFile, TFolder, Notice, Platform } from 'obsidian';
import * as pdfjsLib from 'pdfjs-dist';
import SmartVaultPlugin from '../SmartVaultPlugin';
import pdfWorkerSource from '../../pdf.worker.min.workerjs';

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
        // Initialize PDF.js worker from bundled source
        const blob = new Blob([pdfWorkerSource], { type: 'application/javascript' });
        const workerPath = URL.createObjectURL(blob);

        pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;
        if (this.plugin.settings.debugMode) {
            console.log(`[HandwrittenWatcher] Initialized PDF worker from bundled source`);
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

    public async forceTranscribe(file: TFile) {
        if (this.processingQueue.has(file.path)) {
            new Notice(`Already processing ${file.name}`);
            return;
        }
        // Force process, skip inbox check = true
        await this.transcribeAndMove(file, false, true);
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

    private async findExistingTranscript(sourcePath: string): Promise<TFile | null> {
        const markdownFiles = this.plugin.app.vault.getMarkdownFiles();
        for (const md of markdownFiles) {
            const cache = this.plugin.app.metadataCache.getFileCache(md);
            if (cache?.frontmatter && cache.frontmatter.source) {
                // Check if source matches [[path]] or just path
                const source = cache.frontmatter.source;
                if (source.includes(sourcePath) || source === sourcePath) {
                    return md;
                }
            }
        }
        return null;
    }

    // allow force debug and force execution (skipping inbox check)
    private async transcribeAndMove(file: TFile, forceDebug = false, forceExecution = false) {
        if (this.processingQueue.has(file.path)) return;
        this.processingQueue.add(file.path);

        new Notice(`✍️ Processing: ${file.name}`);

        try {
            const { settings, wasmModule } = this.plugin;

            // 1. Move file if it's in the inbox (SKIP if force execution and not in inbox)
            let currentFile = file;
            const attachmentFolder = settings.handwrittenAttachmentsFolder || 'Attachments/Handwritten';


            if (!currentFile.path.startsWith(attachmentFolder)) {
                // Ensure folder exists
                await this.ensureFolder(attachmentFolder);

                // Handle collision for moved file
                let newPath = `${attachmentFolder}/${currentFile.name}`;
                let moveCounter = 1;
                while (await this.plugin.app.vault.adapter.exists(newPath)) {
                    const nameParts = currentFile.name.split('.');
                    const extension = nameParts.pop();
                    const basename = nameParts.join('.');
                    newPath = `${attachmentFolder}/${basename} (${moveCounter}).${extension}`;
                    moveCounter++;
                }

                await this.plugin.app.fileManager.renameFile(currentFile, newPath);
                // Update reference after move
                const abstractFile = this.plugin.app.vault.getAbstractFileByPath(newPath);
                if (abstractFile instanceof TFile) {
                    currentFile = abstractFile;
                }
            }

            // 2. Transcribe
            let imagesBase64: string[] = [];

            // Handle PDF vs Image
            if (currentFile.extension.toLowerCase() === 'pdf') {
                new Notice(`📄 Converting PDF key pages...`);
                imagesBase64 = await this.convertPdfToImages(currentFile);
            } else {
                const arrayBuffer = await this.plugin.app.vault.readBinary(currentFile);
                imagesBase64 = [this.arrayBufferToBase64(arrayBuffer)];
            }

            let fullTranscript = "";
            let generatedTitle = "";

            // Loop through pages
            for (let i = 0; i < imagesBase64.length; i++) {
                const image = imagesBase64[i];
                if (forceDebug || settings.debugMode) {
                    // Debug saving logic (omitted for brevity in this focused update, but preserved if useful)
                    // Re-adding essential debug log
                    console.log(`[HandwrittenDebug] Processing Page ${i + 1}`);
                }

                new Notice(`🧠 Reading Page ${i + 1}/${imagesBase64.length}...`);
                const startTime = Date.now();

                // Slow Model Warning
                const checkTimer = setTimeout(() => {
                    new Notice(`⚠️ Model is taking a while...`);
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
                        }
                    }
                }

                fullTranscript += `\n\n## Page ${i + 1}\n\n` + lines.join('\n').trim();
            }

            fullTranscript = fullTranscript.trim();
            if (!fullTranscript) fullTranscript = "_[No text transcribed]_";

            // 3. Handle Transcript (Append vs Create)
            const existingNote = await this.findExistingTranscript(currentFile.path);

            if (existingNote) {
                // INCREMENTAL UPDATE: Smart Merge
                const oldContent = await this.plugin.app.vault.read(existingNote);
                let newContentToAppend = "";

                // Parse existing pages
                const existingPages = new Set<string>();
                const pageHeaderRegex = /^## Page (\d+)/gm;
                let match;
                while ((match = pageHeaderRegex.exec(oldContent)) !== null) {
                    existingPages.add(match[1]);
                }

                if (forceDebug) {
                    console.log(`[HandwrittenDebug] Existing pages: ${Array.from(existingPages).join(', ')}`);
                }

                // Check which new pages are actually new
                // Note: fullTranscript format allows split by ## Page X
                const newPageBlocks = fullTranscript.split(/(?=^## Page \d+)/m);

                for (const block of newPageBlocks) {
                    const headerMatch = block.match(/^## Page (\d+)/);
                    if (headerMatch) {
                        const pageNum = headerMatch[1];
                        if (!existingPages.has(pageNum)) {
                            newContentToAppend += "\n\n" + block.trim();
                        } else {
                            if (forceDebug) console.log(`[HandwrittenDebug] Skipping Page ${pageNum} - already exists.`);
                        }
                    } else if (block.trim().length > 0 && !block.includes('No text transcribed')) {
                        // Content without page header (maybe intro?), ignore if we have pages structure
                    }
                }

                if (newContentToAppend.trim().length > 0) {
                    // Detect Title Change (informational only)
                    if (generatedTitle && !oldContent.includes(generatedTitle)) {
                        new Notice(`💡 Idea: New title detected "${generatedTitle}".`);
                    }

                    const updateHeader = `\n\n## Updated Transcription (${new Date().toLocaleString()})`;
                    const finalContent = oldContent + updateHeader + newContentToAppend;

                    await this.plugin.app.vault.modify(existingNote, finalContent);
                    new Notice(`✅ Appended new pages to: [[${existingNote.basename}]]`);
                } else {
                    new Notice(`ℹ️ No new pages found to append for [[${existingNote.basename}]].`);
                    // If forced, maybe user wants to overwrite? For now, safety first.
                }

            } else {
                // NEW NOTE
                const safeTitle = generatedTitle ? generatedTitle.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() : (currentFile.basename.replace(/[^a-zA-Z0-9-_ ]/g, '') || 'Untitled');
                let targetPath = `${settings.transcriptFolder}/${safeTitle}.md`;

                // Handle collision
                let counter = 1;
                while (await this.plugin.app.vault.adapter.exists(targetPath)) {
                    targetPath = `${settings.transcriptFolder}/${safeTitle} (${counter}).md`;
                    counter++;
                }

                const content = `---
source: "[[${currentFile.path}]]"
model: ${settings.visionModel}
---
# ${safeTitle}

${fullTranscript}
`;
                // Ensure transcript folder exists
                const transcriptFolderStr = targetPath.substring(0, targetPath.lastIndexOf('/'));
                if (transcriptFolderStr) {
                    await this.ensureFolder(transcriptFolderStr);
                }

                const newFile = await this.plugin.app.vault.create(targetPath, content);
                new Notice(`✅ Transcript created: ${newFile.basename}`);
            }

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

    private async ensureFolder(path: string) {
        if (!path || path === '/') return;

        // Strip leading/trailing slashes
        const cleanPath = path.replace(/^\/+|\/+$/g, '');
        const folders = cleanPath.split('/');
        let currentPath = '';

        for (const folder of folders) {
            currentPath = currentPath === '' ? folder : `${currentPath}/${folder}`;

            try {
                // Check if it exists (using adapter to be safe with cache)
                const exists = await this.plugin.app.vault.adapter.exists(currentPath);
                if (!exists) {
                    await this.plugin.app.vault.createFolder(currentPath);
                }
            } catch (error: any) {
                // Ignore "Folder already exists" errors, fail on others
                if (error.message && error.message.includes("already exists")) {
                    // benign
                } else {
                    console.error(`Failed to create folder ${currentPath}:`, error);
                    // Don't throw, try to continue
                }
            }
        }
    }
}
