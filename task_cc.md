# PR Review Required Tasks

## Unexpected any
- [ ] `src/llm/RerankerService.ts`: L247, L318
- [ ] `src/plugin/SmartVaultPlugin.ts`: L850
- [ ] `src/plugin/cache/CacheManager.ts`: L104, L123, L288
- [ ] `src/plugin/scanning/FileProcessor.ts`: L58, L131, L198
- [ ] `src/ui/tabs/FormattingTab.ts`: L151
- [ ] `src/ui/tabs/OrganizationTab.ts`: L117

## Promises must be awaited (or void/catch)
- [ ] `src/plugin/SmartVaultPlugin.ts`: L83, L109, L117, L252, L266, L893, L902-904, L917, L949, L1048
- [ ] `src/plugin/scanning/HandwrittenNoteWatcher.ts`: L26, L45, L70
- [ ] `src/ui/LinkSuggestionView.ts`: L260, L535, L566
- [ ] `src/ui/tabs/ChatTab.ts`: L60-68, L84-90, L165, L219, L250, L257, L264, L300

## Promise returned where void expected
- [ ] `src/plugin/SmartVaultPlugin.ts`: L131, L137, L154, L173, L185, L197, L208, L1090
- [ ] `src/plugin/scanning/HandwrittenNoteWatcher.ts`: L33, L40, L167, L191
- [ ] `src/settings/SmartVaultSettings.ts`: L17, L53, L64, L77, L80, L88, L91, L99, L100, L102, L110, L122, L134, L146, L162, L177, L180, L181, L192, L193, L204, L211, L212, L221, L222, L231, L234, L244, L245, L247, L255, L256, L258, L266, L267, L269, L278, L279, L290, L291, L302, L303, L313, L314, L325, L326, L335, L347, L348, L359, L360, L369, L387, L388, L390, L398, L399, L401, L409, L420, L421, L423, L433, L434, L444, L461, L480, L481, L510, L528, L529, L541
- [ ] `src/ui/LinkSuggestionView.ts`: L66, L299, L396, L431, L445, L492, L511, L582, L593, L676, L707, L1168, L1185
- [ ] `src/ui/tabs/ChatTab.ts`: L110, L111, L112, L120, L138, L146, L154, L177, L197
- [ ] `src/ui/tabs/FormattingTab.ts`: L91, L189, L198, L209, L225, L262, L351, L353
- [ ] `src/ui/tabs/OrganizationTab.ts`: L60, L237, L261

## Use sentence case for UI text
- [ ] `src/plugin/SmartVaultPlugin.ts`: L226

## Unnecessary assertion
- [ ] `src/plugin/SmartVaultPlugin.ts`: L291-358, L364-367, L583-605, L986-988, L1170-1188
- [ ] `src/plugin/cache/CacheManager.ts`: L196-219
- [ ] `src/plugin/scanning/HandwrittenNoteWatcher.ts`: L106
- [ ] `src/settings/SmartVaultSettings.ts`: L490-504
- [ ] `src/ui/tabs/ChatTab.ts`: L216-221

## Promise returned in function argument where void expected
- [ ] `src/plugin/SmartVaultPlugin.ts`: L303, L310, L550, L559, L588, L595, L612, L629, L636, L706, L773, L782, L786, L794, L823, L841
- [ ] `src/plugin/cache/CacheManager.ts`: L884, L939, L955, L975, L991
- [ ] `src/settings/SmartVaultSettings.ts`: L60
- [ ] `src/ui/LinkSuggestionView.ts`: L329, L404, L410, L416, L420, L424

## Unexpected console statement
- [ ] `src/plugin/SmartVaultPlugin.ts`: L491

## Async method has no 'await' expression
- [ ] `src/plugin/SmartVaultPlugin.ts`: L503 (saveInsertionCache), L576 (saveEmbeddings), L601 (onFileModified)
- [ ] `src/plugin/scanning/HandwrittenNoteWatcher.ts`: L58 (processInboxNow), L86 (processFile), L109 (findExistingTranscript)

## Unexpected await of non-Promise
- [ ] `src/plugin/cache/CacheManager.ts`: L237, L575, L988
- [ ] `src/plugin/scanning/VaultScanner.ts`: L193, L198, L269, L273
- [ ] `src/ui/tabs/ChatTab.ts`: L652

## UI Headings (Use new Setting().setHeading())
- [ ] `src/settings/SmartVaultSettings.ts`: L17, L50, L74, L177, L204, L241, L379, L430

## Direct style manipulation (Use CSS classes or setCssProps)
- [ ] `src/settings/SmartVaultSettings.ts`: L21 (display), L22 (gap), L23 (marginBottom), L24 (justifyContent), L32 (padding), L33 (borderRadius), L34 (backgroundColor), L35 (color), L36 (textDecoration), L37 (fontWeight)
- [ ] `src/ui/ConfirmModal.ts`: L34 (justifyContent)

## Async arrow function has no 'await'
- [ ] `src/settings/SmartVaultSettings.ts`: L485
- [ ] `src/ui/LinkSuggestionView.ts`: L289
- [ ] `src/ui/tabs/ChatTab.ts`: L210

## Async method 'onOpen' has no 'await'
- [ ] `src/ui/LinkSuggestionView.ts`: L73
- [ ] `src/ui/tabs/FormattingTab.ts`: L56
- [ ] `src/ui/tabs/OrganizationTab.ts`: L31
- [ ] `src/ui/tabs/SuggestionTab.ts`: L19

## Avoid using the main plugin instance as a component
- [ ] `src/ui/tabs/ChatTab.ts`: L264 (lifecycle overlap)

## Async method 'onClose' has no 'await'
- [ ] `src/ui/tabs/FormattingTab.ts`: L60
- [ ] `src/ui/tabs/OrganizationTab.ts`: L35

## Invalid operand for '+'
- [ ] `src/ui/tabs/FormattingTab.ts`: L481
