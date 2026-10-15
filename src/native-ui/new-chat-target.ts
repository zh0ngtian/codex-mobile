import { t } from '../i18n';
import type { NativeGroup, NativeParams } from './protocol';

export interface NativeNewChatTarget { backendId: string; cwd: string }
/** 仅接受当前导航提供的项目目标；空串明确表示无项目，不采用保存目录。 */
export function resolveNativeNewChatTarget(params: NativeParams, backends: ReadonlyArray<{ id: string }>, groups: ReadonlyArray<NativeGroup>): NativeNewChatTarget | undefined {
  if (params.backendId === undefined && params.cwd === undefined) return undefined;
  if (typeof params.backendId !== 'string' || typeof params.cwd !== 'string') throw new Error(t('项目目标无效'));
  if (!backends.some(backend => backend.id === params.backendId)) throw new Error(t('设备已移除'));
  if (!groups.some(group => group.newCommand?.name === 'thread.new' && group.newCommand.params.backendId === params.backendId && group.newCommand.params.cwd === params.cwd)) throw new Error(t('会话列表已更新，请刷新'));
  return { backendId: params.backendId, cwd: params.cwd };
}
