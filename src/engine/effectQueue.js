// 效果队列（FIFO），支持：
// - 同一时刻触发的效果按 enqueue 顺序（即注册/进场顺序）依次执行
// - 执行过程中新触发的效果一律追加到当前活动队列末尾，不插队、不立即执行
// - 嵌套执行：外层效果可在其 execute 内 resolve 内层队列，
//   内层队列排空后外层效果继续；活动队列始终是最内层队列
// - 中断（异常）后未执行的效果保留在队列中，再次 resolve() 可继续
class EffectQueue {
  // 当前所有 resolve() 活动中最内层的队列；无活动队列时为 null
  static get active() {
    return EffectQueue._activeStack.length > 0
      ? EffectQueue._activeStack[EffectQueue._activeStack.length - 1]
      : null;
  }

  constructor(onAfterEffect) {
    this.items = [];
    this.head = 0;
    this.depth = 0;
    // 每个效果结算后的回调（引擎用于立即重算光环等）
    this.onAfterEffect = onAfterEffect || null;
  }

  enqueue(effect) {
    // 执行期间 enqueue 一律进入当前最内层队列末尾
    const target = EffectQueue.active || this;
    target.items.push(effect);
  }

  // 显式进入本队列（用于构造尚未开始结算的内层队列），
  // 不经过活动队列路由；结算开始后新增效果仍应使用 enqueue 走队尾。
  enqueueLocal(effect) {
    this.items.push(effect);
  }

  get length() {
    return this.items.length - this.head;
  }

  get pending() {
    return this.items.length - this.head;
  }

  get isResolving() {
    return this.depth > 0;
  }

  resolve() {
    this.depth += 1;
    EffectQueue._activeStack.push(this);
    // 执行期间固定使用局部引用：嵌套内层 resolve 排空重置实例字段后，
    // 外层 while 仍引用自己的 items/head，不会串队列。
    let items = this.items;
    let head = this.head;
    try {
      // 条件读取 length：执行中新 enqueue 的效果也会被本轮排空
      while (head < items.length) {
        const effect = items[head];
        head += 1;
        this.head = head;
        try {
          effect.execute();
        } finally {
          if (this.onAfterEffect) this.onAfterEffect();
        }
        // 嵌套内层 resolve 可能已重置实例字段，重新取回当前引用
        items = this.items;
        head = this.head;
      }
    } finally {
      this.depth -= 1;
      EffectQueue._activeStack.pop();
      if (this.depth === 0) {
        // 顶层结算结束：压缩已执行槽位；异常中断时未执行的效果原样保留
        if (head === items.length) {
          this.items = [];
          this.head = 0;
        } else {
          this.items = items.slice(head);
          this.head = 0;
        }
      }
    }
  }

  // 显式嵌套：新建内层队列执行 innerEffects，全部完成后调用 continueOuter
  runNested(innerEffects, continueOuter) {
    const inner = new EffectQueue(this.onAfterEffect);
    for (const effect of innerEffects) inner.enqueueLocal(effect);
    inner.resolve();
    if (continueOuter) continueOuter();
  }
}

EffectQueue._activeStack = [];

module.exports = { EffectQueue };
