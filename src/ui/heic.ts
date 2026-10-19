import { MAX_IMAGE_BYTES } from './attachments';
import { t } from '../i18n';
const isHEIC = (file: File) => /^image\/hei[cf](?:-sequence)?$/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
/** 浏览器可解码HEIC时直接生成JPEG；失败明确报错，不把原件当普通文件发送。 */
export async function normalizeHEICFiles(files: File[]): Promise<File[]> {
  return Promise.all(files.map(async file => {
    if (!isHEIC(file)) return file;
    if (file.size > 20 * 1024 * 1024) throw new Error(t('单个附件不能超过 20 MB'));
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 100_000_000) throw new Error(t('附件内容格式无效'));
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error(t('附件内容格式无效'));
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0);
      const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob && blob.type === 'image/jpeg' ? resolve(blob) : reject(new Error(t('附件内容格式无效'))), 'image/jpeg', .95));
      if (jpeg.size > MAX_IMAGE_BYTES) throw new Error(t('{name} 超过 10 MB', { name: file.name }));
      return new File([jpeg], file.name.replace(/\.[^.]*$/, '') + '.jpg', { type: 'image/jpeg' });
    } catch (error) { throw new Error(`${file.name}：HEIC 转 JPEG 失败（${error instanceof Error ? error.message : error}）`); }
    finally { URL.revokeObjectURL(url); }
  }));
}
