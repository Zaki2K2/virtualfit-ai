/** Inventory text is untrusted. Only text metadata reaches the language runtime. */
export function languageMetadata(text: string): string {
  return text
    .replace(/https?:\/\/\S+|data:image\S+/gi, '[image/link omitted]')
    .replace(
      /\b\d{1,3}(?:\.\d+)?\s*(?:cm|kg|lbs?|inches|inch|ft|feet)\b/gi,
      '[measurement omitted]',
    );
}
