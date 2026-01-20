/**
 * Utility functions for content processing.
 */

/**
 * Truncate content to a maximum length for LLM processing.
 * Adds a truncation notice if content exceeds the limit.
 *
 * @param content - The content to truncate
 * @param maxLength - Maximum character length (default 2000, ~500 tokens)
 * @returns Truncated content with notice if truncated
 */
export function truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
        return content;
    }
    return content.substring(0, maxLength) + "\n\n[Content truncated...]";
}
