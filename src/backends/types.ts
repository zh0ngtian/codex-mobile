import type { TransportMode } from "./transport-preference";

export interface BackendConfig {
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
