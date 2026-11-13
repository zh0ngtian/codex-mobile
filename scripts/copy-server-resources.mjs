import { copyFile, mkdir } from 'node:fs/promises';

const output = new URL('../npm-dist/server/remote/', import.meta.url);
await mkdir(output, { recursive: true });
await copyFile(new URL('../server/remote/device-key.swift', import.meta.url), new URL('device-key.swift', output));
