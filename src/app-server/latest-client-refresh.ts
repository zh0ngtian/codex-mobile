/** 合并同一连接的整轮刷新（含目录）；旧连接的清理不能释放新连接的在途任务。 */
export function createLatestClientRefresh<Client>() {
  let pending: { client: Client; promise: Promise<void> } | undefined;
  return {
    run(client: Client, operation: () => Promise<void>) {
      if (pending?.client === client) return pending.promise;
      let resolve!: () => void;
      let reject!: (reason: unknown) => void;
      const flight = { client, promise: new Promise<void>((done, fail) => { resolve = done; reject = fail; }) };
      const clear = () => {
        if (pending === flight) pending = undefined;
      };
      pending = flight;
      // 保持目录先于启动设置入队，不能因合并任务多等一个 microtask。
      try {
        void operation().then(() => { clear(); resolve(); }, reason => { clear(); reject(reason); });
      } catch (reason) {
        clear(); reject(reason);
      }
      return flight.promise;
    },
  };
}
