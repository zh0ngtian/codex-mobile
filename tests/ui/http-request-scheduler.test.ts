import { describe, expect, it } from "vitest";
import { HttpRequestScheduler } from "../../src/backends/http-request-scheduler";

describe("后台并发调度", () => {
  it("生产默认四个后台名额，第五个仍排队", async () => {
    const scheduler = new HttpRequestScheduler(), releases: Array<() => void> = [];
    const jobs = Array.from({ length: 5 }, () => scheduler.run("http://default.test", "background", undefined,
      () => new Promise<void>(resolve => releases.push(resolve))));
    expect(releases).toHaveLength(4);
    releases[0](); await jobs[0]; await Promise.resolve();
    expect(releases).toHaveLength(5);
    releases.forEach(release => release()); await Promise.all(jobs);
  });

  it.each([2, 4, 6])("%s个后台名额下前台立即进入，可见补页优先且前台期间不续发后台", async limit => {
    const scheduler = new HttpRequestScheduler(limit), started: string[] = [], release = new Map<string, () => void>();
    const job = (id: string, priority: "foreground" | "background" | "background-visible") => scheduler.run("http://shared.test", priority, undefined,
      () => { started.push(id); return new Promise<void>(resolve => release.set(id, resolve)); });
    const initial = Array.from({ length: limit }, (_, i) => job(`initial-${i}`, "background"));
    const ordinary = job("ordinary", "background"), visible = job("visible", "background-visible"), foreground = job("foreground", "foreground");
    expect(started).toHaveLength(limit + 1); expect(started.at(-1)).toBe("foreground");
    release.get("initial-0")!(); await initial[0]; await Promise.resolve();
    expect(started).toHaveLength(limit + 1);
    release.get("foreground")!(); await foreground; await Promise.resolve();
    expect(started.at(-1)).toBe("visible");
    release.get("visible")!(); await visible; await Promise.resolve(); expect(started.at(-1)).toBe("ordinary");
    release.forEach(resolve => resolve()); await Promise.all([...initial, ordinary]);
  });
});
