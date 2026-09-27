// 效果队列
// 不变量:
// 1. 同一时刻触发的效果按入队顺序(进场顺序)FIFO执行
// 2. 执行过程中新触发的效果统一追加到当前队列末尾, 不插队也不立即执行
// 3. resolve()支持嵌套: 内层队列执行完毕后外层效果继续;
//    即使在同一个队列实例上重入, 也由外层循环统一处理剩余效果
// 4. 某个效果抛错时, 出错的效果被移除, 其余效果保留, 可再次resolve()继续
class EffectQueue {
  constructor(options = {}) {
    this.queue = [];
    // 已弹出的队头游标, 避免用shift()在大量效果下退化为O(n^2)
    this.head = 0;
    // 每个效果结算完后的回调(引擎用于即时重算光环)
    this.afterEach = options.afterEach || null;
  }

  enqueue(effect) {
    if (!effect || typeof effect.execute !== 'function') {
      throw new TypeError('EffectQueue.enqueue: effect必须带execute()方法');
    }
    this.queue.push(effect);
  }

  resolve(context = {}) {
    let outer = false;
    if (!this.resolving) {
      this.resolving = true;
      this.depth = 1;
      outer = true;
    } else {
      this.depth += 1;
    }

    try {
      // 快照只取一次: 执行过程中enqueue的新效果靠length动态增长自然落到队尾
      while (this.head < this.queue.length) {
        const effect = this.queue[this.head];
        this.head += 1;
        effect.execute(context);
        if (this.afterEach) this.afterEach(context);
      }
      // 全部结算完才压缩数组, 保持重入时游标有效
      if (outer) {
        this.queue = [];
        this.head = 0;
      }
    } finally {
      this.depth -= 1;
      if (this.depth === 0) {
        // 出错中断: 只保留尚未结算的效果, 游标归零, 状态一致可继续
        if (this.head > 0 && this.head < this.queue.length) {
          this.queue = this.queue.slice(this.head);
          this.head = 0;
        } else if (this.head >= this.queue.length) {
          this.queue = [];
          this.head = 0;
        }
        this.resolving = false;
      }
    }
  }

  clear() {
    this.queue = [];
    this.head = 0;
  }

  get length() {
    return this.queue.length - this.head;
  }
}

module.exports = { EffectQueue };
