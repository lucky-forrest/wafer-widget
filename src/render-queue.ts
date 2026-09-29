export type WaferRenderTask = (signal: AbortSignal) => Promise<void>;

interface QueueItem {
  controller: AbortController;
  owner: object;
  reject: (reason?: unknown) => void;
  resolve: () => void;
  task: WaferRenderTask;
}

/**
 * 页面级 Wafer 大数据绘制队列。
 *
 * 队列只负责限制 WebGL 重绘并发，不参与 Wafer 数据和业务状态处理。
 * 每个 Wafer 实例自行合并重复请求，因此队列始终按首次入队顺序执行。
 */
class WaferRenderQueue {
  private activeItem: null | QueueItem = null;
  private readonly items: QueueItem[] = [];

  enqueue(owner: object, task: WaferRenderTask): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.items.push({
        controller: new AbortController(),
        owner,
        reject,
        resolve,
        task,
      });
      void this.processNext();
    });
  }

  /** 取消指定实例正在执行的任务，等待任务在安全检查点退出。 */
  cancelActive(owner: object): void {
    if (this.activeItem?.owner === owner) {
      this.activeItem.controller.abort();
    }
  }

  /** 取消指定实例的等待任务和正在执行的任务。 */
  cancel(owner: object): void {
    this.cancelActive(owner);
    for (let index = this.items.length - 1; index >= 0; index--) {
      const item = this.items[index];
      if (item?.owner === owner) {
        item.controller.abort();
        item.resolve();
        this.items.splice(index, 1);
      }
    }
  }

  private async processNext(): Promise<void> {
    if (this.activeItem) return;

    const item = this.items.shift();
    if (!item) return;

    this.activeItem = item;
    try {
      if (!item.controller.signal.aborted) {
        await item.task(item.controller.signal);
      }
      item.resolve();
    } catch (error) {
      if (item.controller.signal.aborted) {
        item.resolve();
      } else {
        item.reject(error);
      }
    } finally {
      this.activeItem = null;
      void this.processNext();
    }
  }
}

export const waferRenderQueue = new WaferRenderQueue();
