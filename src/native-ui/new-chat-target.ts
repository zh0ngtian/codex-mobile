import { t } from '../i18n';
import type { NativeGroup, NativeParams } from './protocol';

export interface NativeNewChatTarget { backendId: string; cwd?: string }
/** 设备目标恢复该设备的项目记忆；明确项目须来自当前导航，空串表示无项目。 */
export function resolveNativeNewChatTarget(params: NativeParams, backends: ReadonlyArray<{ id: string }>, groups: ReadonlyArray<NativeGroup>): NativeNewChatTarget | undefined {
  if (params.backendId === undefined && params.cwd === undefined) return undefined;
  if (typeof params.backendId !== 'string' || (params.cwd !== undefined && typeof params.cwd !== 'string')) throw new Error(t('项目目标无效'));
  if (!backends.some(backend => backend.id === params.backendId)) throw new Error(t('设备已移除'));
  if (params.cwd === undefined) return { backendId: params.backendId };
  if (!groups.some(group => group.newCommand?.name === 'thread.new' && group.newCommand.params.backendId === params.backendId && group.newCommand.params.cwd === params.cwd)) throw new Error(t('会话列表已更新，请刷新'));
  return { backendId: params.backendId, cwd: params.cwd };
}
