import type { TransportMode } from "./transport-preference";

export interface RemoteTargetReference {
  mode: 'remote'; gatewayId: string;
  account: { accountId: string; accountUserId: string; userId?: string };
  target: { environmentId: string; installationId: string };
}
export interface GatewayTarget {
  reference: RemoteTargetReference; name: string; online: boolean; busy: boolean; isGatewayHost: boolean;
}
export interface BackendConfig {
  gatewayMode?: 'local' | 'remote';
  gatewayQueue?: boolean;
  /** 物理网关配置保存目录，实际连接仅携带选定机器的完整引用。 */
  remoteTargets?: GatewayTarget[];
  remoteTarget?: RemoteTargetReference;
  gatewayId?: string;
  id: string;
  hostId?: string;
  name: string;
  baseUrl: string;
  token: string;
  enabled: boolean;
  order: number;
  /** 客户端统一偏好在连接时注入，不写入设备注册表。 */
  transportMode?: TransportMode;
}

export interface BackendRegistry {
  version: 1;
  selectedBackendId: string;
  backends: BackendConfig[];
}

export interface BackendRuntimeSummary {
  backendId: string;
  connection: "connecting" | "online" | "offline";
  busy: boolean;
  approvalCount: number;
  queuedCount?: number;
  error: string;
}
