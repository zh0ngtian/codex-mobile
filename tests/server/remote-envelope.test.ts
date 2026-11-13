import { afterEach, describe, expect, it } from 'vitest';
import {
  encodeClientMessage, decodeServerFrame, RemoteChunkAssembler,
  type ServerMessageChunk,
} from '../../server/remote/envelope.js';

const route = { clientId: 'client', streamId: 'phone', environmentId: 'mac', seqId: 1 };
const assemblers: RemoteChunkAssembler[] = [];
afterEach(() => { for (const assembler of assemblers) assembler.close(); assemblers.length = 0; });
function assembler(options: ConstructorParameters<typeof RemoteChunkAssembler>[0] = {}) {
  const value = new RemoteChunkAssembler(options); assemblers.push(value); return value;
}
function chunks(message: unknown): ServerMessageChunk[] {
  const bytes = Buffer.from(JSON.stringify(message));
  const unicode = bytes.indexOf(Buffer.from('你'));
  const middle = unicode < 0 ? Math.floor(bytes.length / 2) : unicode + 1;
  return [bytes.subarray(0, middle), bytes.subarray(middle)].map((part, index) => ({
    type: 'server_message_chunk', client_id: 'client', stream_id: 'phone', env_id: 'mac', seq_id: 9,
    segment_id: index, segment_count: 2, message_size_bytes: bytes.length,
    message_chunk_base64: part.toString('base64'), cursor: `c${index}`,
  }));
}

describe('Remote 消息编码', () => {
  it('保留官方 client_message 信封与结构化 RPC', () => {
    expect(encodeClientMessage(route, { id: 3, method: 'thread/read', params: { threadId: 't' } }).map(JSON.parse)).toEqual([{
      type: 'client_message', client_id: 'client', stream_id: 'phone', env_id: 'mac', seq_id: 1,
      skip_history: false, message: { id: 3, method: 'thread/read', params: { threadId: 't' } },
    }]);
  });

  it('以完整信封 UTF8 字节数判断 102400 边界并限制完整 chunk 信封大小', () => {
    const empty = Buffer.byteLength(encodeClientMessage(route, { method: 'x', params: '' })[0]);
    const boundary = { method: 'x', params: 'a'.repeat(102400 - empty) };
    expect(Buffer.byteLength(encodeClientMessage(route, boundary)[0])).toBe(102400);
    expect(JSON.parse(encodeClientMessage(route, boundary)[0]).type).toBe('client_message');
    expect(JSON.parse(encodeClientMessage(route, { ...boundary, params: boundary.params + 'a' })[0]).type).toBe('client_message_chunk');
    const message = { method: 'x', params: '中🙂'.repeat(60000) };
    const encoded = encodeClientMessage(route, message).map(value => {
      expect(Buffer.byteLength(value)).toBeLessThanOrEqual(153600); return JSON.parse(value);
    });
    expect(encoded.length).toBeGreaterThan(1);
    expect(encoded.every(frame => frame.type === 'client_message_chunk' && frame.seq_id === 1 && !('message' in frame))).toBe(true);
    expect(encoded.map(frame => frame.segment_id)).toEqual(encoded.map((_, index) => index));
    expect(encoded.every(frame => frame.segment_count === encoded.length && frame.message_size_bytes === Buffer.byteLength(JSON.stringify(message)))).toBe(true);
    expect(JSON.parse(Buffer.concat(encoded.map(frame => Buffer.from(frame.message_chunk_base64, 'base64'))).toString())).toEqual(message);
  });

  it('拒绝超过配置预算的出站消息和原型污染数据', () => {
    expect(() => encodeClientMessage(route, { params: 'a'.repeat(1000) }, { maxMessageBytes: 100 })).toThrow();
    expect(() => encodeClientMessage(route, JSON.parse('{"params":{"__proto__":{"polluted":true}}}'))).toThrow();
    expect(() => encodeClientMessage(route, { params: Number.NaN })).toThrow();
  });
});

describe('Remote 入站校验与分块组装', () => {
  it('接受 null/string cursor 和 pong status，拒绝错误路由字段及不安全 JSON', () => {
    const base = { type: 'pong', client_id: 'client', stream_id: 'phone', env_id: 'mac', seq_id: 1, status: 'unknown', skip_history: true };
    expect(decodeServerFrame(JSON.stringify({ ...base, cursor: null }))).toMatchObject({ status: 'unknown', cursor: null });
    expect(decodeServerFrame(JSON.stringify({ ...base, cursor: 'next' }))).toMatchObject({ cursor: 'next' });
    for (const patch of [{ seq_id: -1 }, { seq_id: 1.5 }, { env_id: '' }, { cursor: 1 }, { status: 'bad' }]) {
      expect(() => decodeServerFrame(JSON.stringify({ ...base, ...patch }))).toThrow();
    }
    expect(() => decodeServerFrame('{"type":"server_message","client_id":"client","stream_id":"phone","env_id":"mac","seq_id":1,"message":{"params":{"__proto__":{}}}}')).toThrow();
  });

  it('乱序接收 UTF8 跨段消息，同段重复不会额外占用预算', () => {
    const value = assembler(); const parts = chunks({ method: 'event', params: '你好🙂' });
    expect(value.accept(parts[1]).message).toBeUndefined();
    const buffered = value.bufferedBytes;
    expect(value.accept(parts[1]).message).toBeUndefined(); expect(value.bufferedBytes).toBe(buffered);
    expect(value.accept(parts[0]).message).toEqual({ method: 'event', params: '你好🙂' });
    expect(value.bufferedBytes).toBe(0); expect(value.pendingCount).toBe(0);
  });

  it('同段冲突和元数据变更拒绝并释放已有内存', () => {
    for (const patch of [{ message_chunk_base64: Buffer.from('bad').toString('base64') }, { message_size_bytes: 999 }]) {
      const value = assembler(); const parts = chunks({ params: 'abcdef' }); value.accept(parts[0]);
      expect(() => value.accept({ ...parts[0], ...patch })).toThrow();
      expect(value.pendingCount).toBe(0); expect(value.bufferedBytes).toBe(0);
    }
  });

  it('严格检查 base64、整数、段数与消息字节声明', () => {
    const part = chunks({ result: 'ok' })[0];
    for (const patch of [
      { message_chunk_base64: '***=' }, { message_chunk_base64: 'YR==' }, { message_chunk_base64: 'YQ' },
      { segment_id: -1 }, { segment_id: 0.5 }, { segment_count: 0 }, { segment_count: 1000000000 },
      { message_size_bytes: 2 ** 40 },
      { message_size_bytes: 1024 * 1024 * 1024 },
    ]) expect(() => assembler().accept({ ...part, ...patch })).toThrow();
    const value = assembler(); const parts = chunks({ result: 'ok' });
    value.accept({ ...parts[0], message_size_bytes: parts[0].message_size_bytes + 1 });
    expect(() => value.accept({ ...parts[1], message_size_bytes: parts[1].message_size_bytes + 1 })).toThrow();
    expect(value.bufferedBytes).toBe(0);
  });

  it('拒绝非法 UTF8 与组装后的原型污染 JSON', () => {
    for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from('{"params":{"constructor":{"prototype":{}}}}')]) {
      const part = chunks({ result: 'ok' })[0];
      expect(() => assembler().accept({ ...part, segment_count: 1, message_size_bytes: bytes.length, message_chunk_base64: bytes.toString('base64') })).toThrow();
    }
  });

  it('声明大消息不会预分配内存，并限制总内存与并发 assembly', () => {
    const part = chunks({ params: 'abcdef' })[0];
    const value = assembler({ maxMessageBytes: 10000, maxTotalBytes: 4096, maxAssemblies: 1 });
    value.accept({ ...part, message_size_bytes: 10000 });
    expect(value.bufferedBytes).toBe(Buffer.from(part.message_chunk_base64, 'base64').length);
    expect(() => value.accept({ ...part, seq_id: 10 })).toThrow();
    const budget = assembler({ maxTotalBytes: 2 });
    expect(() => budget.accept(part)).toThrow(); expect(budget.bufferedBytes).toBe(0);
  });

  it('总内存预算同时约束大量微小分段的元数据，不能只计 payload 字节', () => {
    const value = assembler({ maxTotalBytes: 2048 }); const first = chunks({ params: 'x' })[0];
    for (let index = 0; index < 2; index++) value.accept({ ...first, segment_id: index, segment_count: 1000, message_size_bytes: 1000, message_chunk_base64: 'YQ==' });
    expect(() => {
      for (let index = 2; index < 20; index++) value.accept({ ...first, segment_id: index, segment_count: 1000, message_size_bytes: 1000, message_chunk_base64: 'YQ==' });
    }).toThrow();
    expect(value.bufferedBytes).toBe(0); expect(value.pendingCount).toBe(0);
  });

  it('超时和显式 close 释放分块及定时器', async () => {
    const value = assembler({ timeoutMs: 15 }); const discarded: unknown[] = [];
    value.on('discard', event => discarded.push(event)); value.accept(chunks({ params: 'timeout' })[0]);
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(value.pendingCount).toBe(0); expect(value.bufferedBytes).toBe(0); expect(discarded).toHaveLength(1);
    value.accept(chunks({ params: 'close' })[0]); value.close();
    expect(value.pendingCount).toBe(0); expect(value.bufferedBytes).toBe(0);
  });

  it('关闭逻辑流时只释放对应路由的 partial，不影响其他流', () => {
    const value = assembler(); const part = chunks({ params: 'kept' })[0];
    value.accept(part); value.accept({ ...part, stream_id: 'other' });
    value.discardStream({ clientId: 'client', streamId: 'phone', environmentId: 'mac' });
    expect(value.pendingCount).toBe(1);
    expect(value.bufferedBytes).toBe(Buffer.from(part.message_chunk_base64, 'base64').length);
  });
});
