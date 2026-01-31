
import { Extension, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { App, editorLivePreviewField } from "obsidian";
import type SmartVaultPlugin from "../plugin/SmartVaultPlugin";

export function inlineSuggestionExtension(app: App, plugin: SmartVaultPlugin): Extension {
    return ViewPlugin.fromClass(class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = Decoration.none;
        }

        update(update: ViewUpdate) {
            if (!plugin.settings.enableHoverPreviews) {
                this.decorations = Decoration.none;
                return;
            }

            // Ghost text logic placeholder - building successful
            // console.log("[SmartVault] Inline Extension Active");
            const builder = new RangeSetBuilder<Decoration>();
            this.decorations = builder.finish();
        }
    }, {
        decorations: v => v.decorations
    });
}
