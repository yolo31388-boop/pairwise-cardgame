
const { EffectQueue } = require('../src/engine/effectQueue.js');
const { TriggerSystem } = require('../src/engine/triggers.js');
const { Minion } = require('../src/entities/minion.js');

describe('卡牌效果堆叠', () => {
  test('同时触发应按进场顺序FIFO', () => {
    const order = [];
    const q = new EffectQueue();
    q.enqueue({execute: () => order.push(1)});
    q.enqueue({execute: () => order.push(2)});
    q.enqueue({execute: () => order.push(3)});
    q.resolve();
    expect(order).toEqual([1, 2, 3]);
  });

  test('效果中新触发应插入队尾', () => {
    const order = [];
    const q = new EffectQueue();
    q.enqueue({execute: () => { order.push(1); q.enqueue({execute: () => order.push(3)}); }});
    q.enqueue({execute: () => order.push(2)});
    q.resolve();
    expect(order).toEqual([1, 2, 3]);
  });

  test('亡语应统一触发', () => {
    const ts = new TriggerSystem();
    const m = new Minion('m1', 2, 1);
    let triggered = false;
    ts.register({type:'deathrattle', owner:'m1', effect:{execute:() => triggered=true}});
    const q = new EffectQueue();
    m.takeDamage(2);
    ts.onDeath(m, q);
    q.resolve();
    expect(triggered).toBe(true);
  });

  test('目标死亡应重新选择', () => {
    const q = new EffectQueue();
    const targets = [new Minion('t1', 1, 1), new Minion('t2', 1, 1)];
    targets[0].dead = true;
    let hit = null;
    q.enqueue({execute: () => {
      const alive = targets.filter(t => !t.dead);
      if (alive.length > 0) hit = alive[0].id;
    }});
    q.resolve();
    expect(hit).toBe('t2');
  });

  test('队列空时安全', () => {
    const q = new EffectQueue();
    expect(() => q.resolve()).not.toThrow();
  });

  test('嵌套效果执行', () => {
    const order = [];
    const q = new EffectQueue();
    q.enqueue({execute: () => {
      order.push('outer');
      const inner = new EffectQueue();
      inner.enqueue({execute: () => order.push('inner')});
      inner.resolve();
    }});
    q.resolve();
    expect(order).toEqual(['outer', 'inner']);
  });
});
