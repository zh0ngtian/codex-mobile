import { t } from '../i18n';

export const NATIVE_ATTACHMENT_FILE_LIMIT = 20 * 1024 * 1024;
export const NATIVE_ATTACHMENT_TOTAL_LIMIT = 40 * 1024 * 1024;
const base64 = /^[A-Za-z0-9+/]*={0,2}$/;
interface ImportedAttachment { name: string; type: string; data: string }

/** 在解码前核对边界，避免桥载荷触发无限制的原生文件或内存读取。 */
export function validateNativeAttachmentImport(value: unknown): ImportedAttachment[] {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw new Error(t('附件导入数量无效'));
  let total = 0;
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 255 || /[\\/\u0000-\u001f\u007f]/.test(item.name) || ['.', '..'].includes(item.name)) throw new Error(t('附件名称无效'));
    if (typeof item.type !== 'string' || item.type.length > 255 || (item.type !== '' && !/^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/.test(item.type))) throw new Error(t('附件类型无效'));
    if (typeof item.data !== 'string' || item.data.length > Math.ceil(NATIVE_ATTACHMENT_FILE_LIMIT / 3) * 4 || item.data.length % 4 !== 0 || !base64.test(item.data)) throw new Error(t('附件内容无效或超出大小限制'));
    const bytes = item.data.length / 4 * 3 - (item.data.endsWith('==') ? 2 : item.data.endsWith('=') ? 1 : 0);
    if (bytes > NATIVE_ATTACHMENT_FILE_LIMIT || (total += bytes) > NATIVE_ATTACHMENT_TOTAL_LIMIT) throw new Error(t('附件内容无效或超出大小限制'));
  }
  return value as ImportedAttachment[];
}

export function nativeImportedFiles(value: unknown): File[] {
  return validateNativeAttachmentImport(value).map(item => {
    const decoded = atob(item.data);
    if (btoa(decoded) !== item.data) throw new Error(t('附件内容无效或超出大小限制'));
    const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
    return new File([bytes], item.name, { type: item.type });
  });
}
