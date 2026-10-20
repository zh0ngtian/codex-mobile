import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const source = readFileSync('mobile/ios/KeyboardLayoutProbe.swift', 'utf8');
const body = source.match(/callAsyncJavaScript\("""\n([\s\S]*?)\n\s*""", arguments:/)![1];
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
async function measure(position: (time: number) => number) {
 let time = 0;
 const window = { innerHeight: 806 };
 const document = { querySelector: () => ({ getBoundingClientRect: () => ({ top: position(time) }) }) };
 const requestAnimationFrame = (callback: () => void) => queueMicrotask(() => { time += 16; window.innerHeight = 840; callback(); });
 return new AsyncFunction('document', 'window', 'requestAnimationFrame', 'performance', body)(document, window, requestAnimationFrame, { now: () => time });
}
it('真实探针忽略只有视口延迟更新而没有位置变化的34pt差值', async () => {
 const result = await measure(() => 681);
 expect(result).toMatchObject({ maximum: 0, start: 681, end: 681, initialViewport: 806, finalViewport: 840 });
});
it('真实探针仍能捕获didHide之后的实际尾跳', async () => {
 expect((await measure(time => time >= 200 ? 693 : 681)).maximum).toBe(12);
});
