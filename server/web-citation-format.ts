/** 网页检索的内部引用身份；与用户选文引用和本地文件引用分别处理。 */
export interface WebCitation { refId: string; url: string; title?: string }
export const WEB_REFERENCE = 'turn[0-9]+[a-z]+[0-9]+';
export function webCitationPattern() {
  return new RegExp(`\uE200cite\uE202(${WEB_REFERENCE}(?:\uE202${WEB_REFERENCE})*)\uE201`, 'g');
}
export function webCitationIds(text: string): string[] {
  return [...new Set([...text.matchAll(webCitationPattern())].flatMap(match => match[1].split('\uE202')))];
}
export function webCitationURL(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 8192 || /[\s\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href.replace(/[<>()\\]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase());
  } catch { return null; }
}
