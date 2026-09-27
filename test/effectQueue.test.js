
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

const { targetedEffect } = require('../src/engine/triggers.js');

function buildDeathrattleScenario() {
  const m1 = new Minion('m1', 1, 1, { playOrder: 1, owner: 'A' });
  const m2 = new Minion('m2', 1, 1, { playOrder: 2, owner: 'A' });
  const ts = new TriggerSystem({ board: [m1, m2] });
  const order = [];
  ts.register({ type: 'deathrattle', owner: 'm1', effect: { execute: () => order.push('r1') } });
  ts.register({ type: 'deathrattle', owner: 'm2', effect: { execute: () => order.push('r2') } });
  return { ts, m1, m2, order };
}

describe('效果堆叠不变量(新增)', () => {
  test('同时死亡的亡语按进场顺序FIFO, 与受伤施加顺序无关', () => {
    const a = buildDeathrattleScenario();
    const q = a.ts.createQueue();
    // 故意先让m2受伤, 触发顺序仍必须是m1(先进场)在前
    a.ts.dealSimultaneousDamage([[a.m2, 5], [a.m1, 5]], q);
    a.ts.resolve(q);
    expect(a.order).toEqual(['r1', 'r2']);
  });

  test('战斗双方伤害全部结算后才统一触发亡语, 中途不穿插', () => {
    const m1 = new Minion('a', 3, 3, { owner: 'A' });
    const m2 = new Minion('b', 3, 3, { owner: 'B' });
    const ts = new TriggerSystem({ board: [m1, m2] });
    ts.register({ type: 'deathrattle', owner: 'a', effect: { execute: () => {} } });
    ts.register({ type: 'deathrattle', owner: 'b', effect: { execute: () => {} } });
    const q = ts.createQueue();
    const hitA = jest.spyOn(m1, 'takeDamage');
    const hitB = jest.spyOn(m2, 'takeDamage');
    const enq = jest.spyOn(q, 'enqueue');
    ts.resolveCombat(m1, m2, q);
    expect(m1.dead).toBe(true);
    expect(m2.dead).toBe(true);
    // 双方两次受伤的调用序号都必须早于第一次效果入队
    const lastHit = Math.max(
      hitA.mock.invocationCallOrder[0],
      hitB.mock.invocationCallOrder[0],
    );
    expect(lastHit).toBeLessThan(enq.mock.invocationCallOrder[0]);
    expect(enq.mock.calls.length).toBe(2);
    hitA.mockRestore(); hitB.mockRestore(); enq.mockRestore();
  });

  test('战斗目标已死亡时取消结算, 不造成伤害也不入队', () => {
    const m1 = new Minion('a', 3, 3, { owner: 'A' });
    const m2 = new Minion('b', 4, 4, { owner: 'B' });
    const ts = new TriggerSystem({ board: [m1, m2] });
    ts.register({ type: 'deathrattle', owner: 'a', effect: { execute: () => {} } });
    const q = ts.createQueue();
    const enq = jest.spyOn(q, 'enqueue');
    m1.dead = true;
    ts.resolveCombat(m1, m2, q);
    expect(m2.health).toBe(4);
    expect(enq).not.toHaveBeenCalled();
    enq.mockRestore();
  });

  test('执行中秘密满足条件时立即插入当前队列末尾并在同一链内结算', () => {
    const ts = new TriggerSystem();
    const order = [];
    ts.register({ type: 'secret', event: 'spell', effect: { execute: () => order.push('secret') } });
    const q = ts.createQueue();
    q.enqueue({ execute: () => { order.push('A'); ts.trigger('spell', q); } });
    q.enqueue({ execute: () => order.push('B') });
    ts.resolve(q);
    expect(order).toEqual(['A', 'B', 'secret']);
    // 秘密一次性触发后移除
    expect(ts.triggers.filter((t) => t.type === 'secret').length).toBe(0);
  });

  test('不匹配事件的秘密不会插入', () => {
    const ts = new TriggerSystem();
    const order = [];
    ts.register({ type: 'secret', event: 'attack', effect: { execute: () => order.push('secret') } });
    const q = ts.createQueue();
    q.enqueue({ execute: () => ts.trigger('spell', q) });
    ts.resolve(q);
    expect(order).toEqual([]);
    expect(ts.triggers.length).toBe(1);
  });

  test('同批死亡中亡语与秘密统一按进场顺序入队', () => {
    const m1 = new Minion('m1', 1, 1);
    const ts = new TriggerSystem({ board: [m1] });
    const order = [];
    // 秘密先进场(先注册), 亡语后进场
    ts.register({ type: 'secret', event: 'death', effect: { execute: () => order.push('secret') } });
    ts.register({ type: 'deathrattle', owner: 'm1', effect: { execute: () => order.push('rattle') } });
    const q = ts.createQueue();
    m1.takeDamage(3);
    ts.processDeaths(q);
    ts.resolve(q);
    expect(order).toEqual(['secret', 'rattle']);
  });

  test('光环在每个动作结算后立即重算, 不延迟到下回合', () => {
    const guy = new Minion('guy', 2, 2, { owner: 'A' });
    const ts = new TriggerSystem({ board: [guy] });
    let empowered = false;
    ts.register({
      type: 'aura', owner: 'aura', attack: 2,
      match: (m) => empowered && m.id === 'guy',
    });
    const seen = [];
    const q = ts.createQueue();
    q.enqueue({ execute: () => { empowered = true; seen.push(guy.attack); } });
    q.enqueue({ execute: () => seen.push(guy.attack) });
    ts.resolve(q);
    // 第一个效果执行时还是旧值2, 结算完立即重算, 第二个效果看到+2
    expect(seen).toEqual([2, 4]);
  });

  test('光环来源在同一链中死亡后, 后续效果立即看到光环消失', () => {
    const buffer = new Minion('buf', 1, 1, { owner: 'A' });
    const guy = new Minion('guy', 2, 2, { owner: 'A' });
    const ts = new TriggerSystem({ board: [buffer, guy] });
    ts.register({ type: 'aura', owner: 'buf', attack: 1, health: 1 });
    ts.updateAuras();
    expect(guy.attack).toBe(3);
    const seen = [];
    const q = ts.createQueue();
    buffer.takeDamage(5);
    ts.processDeaths(q);
    q.enqueue({ execute: () => seen.push(guy.attack) });
    ts.resolve(q);
    expect(seen).toEqual([2]);
  });

  test('目标在执行时已死亡则实时重新选择合法目标', () => {
    const t1 = new Minion('t1', 1, 1);
    const t2 = new Minion('t2', 1, 1);
    t1.dead = true;
    const hit = [];
    const q = new EffectQueue();
    q.enqueue(targetedEffect(t1, [t1, t2], (t) => hit.push(t.id)));
    q.resolve();
    expect(hit).toEqual(['t2']);
  });

  test('目标全部非法时效果取消而不是对尸体结算', () => {
    const t1 = new Minion('t1', 1, 1);
    const t2 = new Minion('t2', 1, 1);
    t1.dead = true; t2.dead = true;
    const hit = [];
    let cancelled = false;
    const q = new EffectQueue();
    q.enqueue(targetedEffect(t1, [t1, t2], (t) => hit.push(t.id), {
      onCancel: () => { cancelled = true; },
    }));
    q.resolve();
    expect(hit).toEqual([]);
    expect(cancelled).toBe(true);
  });

  test('同一队列实例可嵌套执行, 外层等待内层完成后继续', () => {
    const order = [];
    const q = new EffectQueue();
    q.enqueue({
      execute() {
        order.push('outer-start');
        q.enqueue({ execute: () => order.push('outer-tail') });
        const inner = new EffectQueue();
        inner.enqueue({ execute: () => order.push('inner-1') });
        inner.enqueue({ execute: () => order.push('inner-2') });
        inner.resolve();
        order.push('outer-continue');
      },
    });
    q.resolve();
    expect(order).toEqual(['outer-start', 'inner-1', 'inner-2', 'outer-continue', 'outer-tail']);
  });

  test('空队列多次resolve安全, 排空后仍可继续入队结算', () => {
    const q = new EffectQueue();
    expect(() => q.resolve()).not.toThrow();
    expect(() => q.resolve()).not.toThrow();
    expect(q.length).toBe(0);
    const seen = [];
    q.enqueue({ execute: () => seen.push('x') });
    q.resolve();
    expect(seen).toEqual(['x']);
    expect(q.length).toBe(0);
  });

  test('上万效果顺序结算不溢出且无丢失', () => {
    const q = new EffectQueue();
    let count = 0;
    const N = 50000;
    for (let i = 0; i < N; i += 1) {
      q.enqueue({ execute: () => { count += 1; } });
    }
    q.resolve();
    expect(count).toBe(N);
    expect(q.length).toBe(0);
  });

  test('相同注册序列两次结算, 触发顺序可复现', () => {
    const run = () => {
      const s = buildDeathrattleScenario();
      const q = s.ts.createQueue();
      s.ts.dealSimultaneousDamage([[s.m1, 5], [s.m2, 5]], q);
      s.ts.resolve(q);
      return s.order;
    };
    expect(run()).toEqual(['r1', 'r2']);
    expect(run()).toEqual(run());
  });

  test('效果抛错中断后队列状态一致, 再次resolve从断点继续', () => {
    const order = [];
    const q = new EffectQueue();
    q.enqueue({ execute: () => { order.push('a'); throw new Error('boom'); } });
    q.enqueue({ execute: () => order.push('b') });
    q.enqueue({ execute: () => order.push('c') });
    expect(() => q.resolve()).toThrow('boom');
    expect(q.length).toBe(2);
    q.resolve();
    expect(order).toEqual(['a', 'b', 'c']);
    expect(q.length).toBe(0);
  });

  test('中断恢复期间新入队效果依然排在队尾按FIFO执行', () => {
    const order = [];
    const q = new EffectQueue();
    q.enqueue({ execute: () => { throw new Error('x'); } });
    q.enqueue({ execute: () => { order.push('b'); q.enqueue({ execute: () => order.push('d') }); } });
    q.enqueue({ execute: () => order.push('c') });
    expect(() => q.resolve()).toThrow('x');
    q.resolve();
    expect(order).toEqual(['b', 'c', 'd']);
  });

  test('入队非法效果对象时快速失败', () => {
    const q = new EffectQueue();
    expect(() => q.enqueue(null)).toThrow(TypeError);
    expect(() => q.enqueue({})).toThrow(TypeError);
    expect(q.length).toBe(0);
  });

  test('相邻多个秘密同时满足条件时全部立即入队, 不因移除而跳过', () => {
    const ts = new TriggerSystem();
    const order = [];
    ts.register({ type: 'secret', event: 'spell', effect: { execute: () => order.push('s1') } });
    ts.register({ type: 'secret', event: 'spell', effect: { execute: () => order.push('s2') } });
    ts.register({ type: 'secret', event: 'spell', effect: { execute: () => order.push('s3') } });
    const q = ts.createQueue();
    q.enqueue({ execute: () => ts.trigger('spell', q) });
    ts.resolve(q);
    expect(order).toEqual(['s1', 's2', 's3']);
    expect(ts.triggers.length).toBe(0);
  });
});
