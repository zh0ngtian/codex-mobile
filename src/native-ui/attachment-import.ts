import { t } from '../i18n';
import { isNativeImageFile, MAX_DRAFT_FILES, MAX_DRAFT_IMAGES, MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES, type DraftFile, type DraftImage } from '../ui/attachments';

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

/** 与共享附件业务的图片/数量约束一致，并把原草稿纳入原生总容量。整批校验不修改草稿。 */
export function assertNativeAttachmentSelection(files: File[], images: DraftImage[], documents: DraftFile[]) {
  const selectedImages = files.filter(isNativeImageFile);
  const selectedFiles = files.filter(file => !isNativeImageFile(file));
  for (const file of files) {
    if (!Number.isSafeInteger(file.size) || file.size < 0) throw new Error(t('附件大小无效'));
    if (isNativeImageFile(file) && file.size > MAX_IMAGE_BYTES) throw new Error(t('{name} 超过 10 MB', { name: file.name }));
    if (file.size > NATIVE_ATTACHMENT_FILE_LIMIT) throw new Error(t('单个附件不能超过 20 MB'));
  }
  if (images.length + selectedImages.length > MAX_DRAFT_IMAGES) throw new Error(t('最多上传 {count} 张图片', { count: MAX_DRAFT_IMAGES }));
  if (documents.length + selectedFiles.length > MAX_DRAFT_FILES) throw new Error(t('最多上传 {count} 个文件', { count: MAX_DRAFT_FILES }));
  const imageBytes = [...images, ...selectedImages].reduce((total, file) => total + file.size, 0);
  if (!Number.isFinite(imageBytes) || imageBytes > MAX_TOTAL_IMAGE_BYTES) throw new Error(t('图片总大小不能超过 20 MB'));
  const totalBytes = [...images, ...documents, ...files].reduce((total, file) => total + file.size, 0);
  if (!Number.isFinite(totalBytes) || totalBytes > NATIVE_ATTACHMENT_TOTAL_LIMIT) throw new Error(t('附件总大小不能超过 40 MB'));
}
