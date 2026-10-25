import type { ModelUploadUsage } from '../../server/model-upload-meter';

export function validUploadUsage(value: any): value is ModelUploadUsage {
  return value != null && typeof value.epoch === 'string' && typeof value.turnId === 'string' && value.turnId.length > 0 &&
    ['revision', 'lastRequestBytes', 'turnBytes', 'requestCount'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0) &&
    value.lastRequestBytes <= value.turnBytes;
}

export function mergeUploadUsage(current: any, incoming: ModelUploadUsage): ModelUploadUsage {
  return validUploadUsage(current) && current.epoch === incoming.epoch && current.revision > incoming.revision ? current : incoming;
}
