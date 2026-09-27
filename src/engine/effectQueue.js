
// 效果队列 - 存在LIFO乱序bug
class EffectQueue {
  constructor() { this.queue = []; }
  enqueue(effect) { this.queue.push(effect); }
  resolve() {
    // BUG: 用pop()从末尾取，变成LIFO
    while (this.queue.length > 0) {
      const effect = this.queue.pop();
      effect.execute();
      // BUG: 执行中新增的效果立即执行，不排队
    }
  }
  get length() { return this.queue.length; }
}

module.exports = { EffectQueue };
