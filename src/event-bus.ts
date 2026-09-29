export default class EventBus {
  private _eventTree: Record<string, any> = {};
  /**
   * 触发事件
   * @param eventName 事件名称
   * @param payload 传递参数
   */
  emit(eventName: string, ...payload: any) {
    const fns = this._eventTree[eventName];
    if (Array.isArray(fns)) {
      fns.forEach((fn) => fn(...payload));
    }
  }

  /**
   * 注销事件
   * @param eventName 事件名称
   * @param cb 传递参数
   */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  off(eventName: string, cb: Function) {
    const fns = this._eventTree[eventName];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    const index = fns.find((fn: Function) => fn === cb);
    if (Array.isArray(fns) && index) {
      fns.splice(index, 1);
    }
  }

  /**
   * 注册事件
   * @param eventName 事件名称
   * @param cb 回调方法
   */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  on(eventName: string, cb: Function) {
    const fns = this._eventTree[eventName];
    if (Array.isArray(fns)) {
      fns.push(cb);
    } else {
      this._eventTree[eventName] = [cb];
    }
  }
}
