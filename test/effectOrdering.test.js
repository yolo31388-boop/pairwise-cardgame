const { EffectQueue } = require('../src/engine/effectQueue.js');
const { TriggerSystem, targetedEffect } = require('../src/engine/triggers.js');
const { Minion } = require('../src/entities/minion.js');
const { resolveCombat } = require('../src/engine/combat.js');

const fx = (fn) => ({ execute: fn });

describe('效果引擎不变量', () => {
  test('1. 同时触发的亡语按随从进场顺序 FIFO 执行', () => {
    const ts = new TriggerSystem();
    const order = [];
    const ms = [
      new Minion('a', 1, 1, 1),
      new Minion('b', 1, 1, 2),
      new Minion('c', 1, 1, 3),
    ];
    ms.forEach((m) => ts.register({
      type: 'deathrattle', owner: m.id, effect: fx(() => order.push(m.id)),
    }));
    const q = new EffectQueue();
    ts.onDeath(ms, q);
    q.resolve();
    expect(order).toEqual(['a', 'b', 'c']);
  });

  test('2. 执行中秘密立即入队，且排在已在队效果之后（插队到队尾）', () => {
    const ts = new TriggerSystem();
    const order = [];
    let seenPending = -1;
    ts.register({
      type: 'secret', event: 'ping',
      condition: () => true,
      effect: fx(() => order.push('secret')),
    });
    const q = new EffectQueue();
    q.enqueue(fx(() => {
      order.push('A');
      ts.trigger('ping', {}, q);
      // 触发瞬间秘密必须已在当前队列中，而不是等效果链结束
      seenPending = q.pending;
    }));
    q.enqueue(fx(() => order.push('B')));
    q.resolve();
    expect(seenPending).toBe(2); // B 与 secret 均在队
    expect(order).toEqual(['A', 'B', 'secret']);
  });

  test('3. 亡语统一触发：后一个亡语依赖前一个亡语的产物时能找到目标', () => {
    const ts = new TriggerSystem();
    ts.setBoard([]);
    const m1 = new Minion('m1', 1, 1, 1);
    const m2 = new Minion('m2', 1, 1, 2);
    const candidates = [];
    let hit = 'UNSET';
    ts.register({
      type: 'deathrattle', owner: 'm1',
      effect: fx(() => candidates.push(new Minion('product', 1, 1, 3))),
    });
    ts.register({
      type: 'deathrattle', owner: 'm2',
      effect: targetedEffect({
        candidates,
        select: (legal) => legal[0],
        apply: (t) => { hit = t.id; },
        onCancel: () => { hit = 'CANCELLED'; },
      }),
    });
    const q = new EffectQueue();
    m1.takeDamage(5);
    m2.takeDamage(5);
    ts.onDeath([m1, m2], q); // 死亡全部处理完后统一收集亡语
    q.resolve();
    expect(hit).toBe('product'); // LIFO 实现下会是 CANCELLED
  });

  test('4. 光环在动作结算后立即重算：加成即时生效、移除即时消失并触发致死亡语', () => {
    const ts = new TriggerSystem();
    const source = new Minion('source', 1, 3, 1);
    const target = new Minion('target', 2, 1, 2);
    ts.setBoard([source, target]);
    ts.register({
      type: 'aura', source: 'source',
      appliesTo: (m) => m.id === 'target', attack: 1, health: 1,
    });
    const snapshot = [];
    let targetRattleFired = false;
    ts.register({
      type: 'deathrattle', owner: 'target',
      effect: fx(() => { targetRattleFired = true; }),
    });
    const q = ts.createQueue();
    q.enqueue(fx(() => {})); // 任意动作结算 -> 立即重算光环
    q.enqueue(fx(() => snapshot.push([target.getCurrentAttack(), target.getCurrentHealth(), target.dead])));
    q.enqueue(fx(() => target.takeDamage(1))); // 基础血量 0，光环 +1 生命 => 仍存活
    q.enqueue(fx(() => snapshot.push(target.dead)));
    q.enqueue(fx(() => {
      source.takeDamage(10);
      ts.onDeath([source], q); // 光环来源死亡，不延迟到下回合
    }));
    q.resolve();
    expect(snapshot[0]).toEqual([3, 2, false]); // +1/+1 立即体现
    expect(snapshot[1]).toBe(false);            // 受伤后光环仍在，立刻重算 => 存活
    expect(target.dead).toBe(true);            // 光环消失 => 血量归零 => 立即死亡
    expect(targetRattleFired).toBe(true);      // 光环致死后亡语统一入队执行
  });

  test('5a. 目标在执行时实时验证：原目标已死亡则重新选择', () => {
    const t1 = new Minion('t1', 1, 1);
    const t2 = new Minion('t2', 1, 1);
    let hit = null;
    const q = new EffectQueue();
    q.enqueue(fx(() => { t1.dead = true; }));
    q.enqueue(targetedEffect({
      candidates: [t1, t2],
      apply: (t) => { hit = t.id; },
      onCancel: () => { hit = 'CANCELLED'; },
    }));
    q.resolve();
    expect(hit).toBe('t2');
  });

  test('5b. 所有目标均不合法时取消效果而不是打空', () => {
    const t1 = new Minion('t1', 1, 1);
    const t2 = new Minion('t2', 1, 1);
    t1.dead = true;
    t2.dead = true;
    let hit = 'UNSET';
    const q = new EffectQueue();
    q.enqueue(targetedEffect({
      candidates: [t1, t2],
      apply: (t) => { hit = t.id; },
      onCancel: () => { hit = 'CANCELLED'; },
    }));
    q.resolve();
    expect(hit).toBe('CANCELLED');
  });

  test('6. 战斗伤害同时结算：攻击者先死也必须打出完整伤害（快照攻击力）', () => {
    const ts = new TriggerSystem();
    const attacker = new Minion('attacker', 3, 1, 1);
    const defender = new Minion('defender', 2, 3, 2);
    const q = new EffectQueue();
    resolveCombat(attacker, defender, ts, q);
    expect(attacker.dead).toBe(true);
    expect(defender.dead).toBe(true); // 顺序化实现若跳过死亡者攻击则 defender 存活
    expect(defender.health).toBe(0);
  });

  test('7. 死亡处理过程中不穿插亡语，亡语在伤害全部落地后统一执行', () => {
    const ts = new TriggerSystem();
    const log = [];
    const attacker = new Minion('a', 3, 1, 1);
    const defender = new Minion('b', 2, 3, 2);
    const origTake = Minion.prototype.takeDamage;
    attacker.takeDamage = (n) => { log.push('damage:a'); origTake.call(attacker, n); };
    defender.takeDamage = (n) => { log.push('damage:b'); origTake.call(defender, n); };
    ts.register({ type: 'deathrattle', owner: 'a', effect: fx(() => log.push('rattle:a')) });
    ts.register({ type: 'deathrattle', owner: 'b', effect: fx(() => log.push('rattle:b')) });
    ts.register({
      type: 'secret', event: 'combatDamage',
      condition: (ctx) => ctx.attacker.id === 'a',
      effect: fx(() => log.push('secret')),
    });
    const q = new EffectQueue();
    resolveCombat(attacker, defender, ts, q);
    // resolve 之前：两次伤害已同时落地，但秘密/亡语只入队未执行
    expect(log).toEqual(['damage:a', 'damage:b']);
    expect(q.pending).toBe(3);
    q.resolve();
    expect(log).toEqual(['damage:a', 'damage:b', 'secret', 'rattle:a', 'rattle:b']);
  });

  test('8. 嵌套执行：内层队列排空后外层才继续，执行中入队进入最内层', () => {
    const order = [];
    const q = new EffectQueue();
    q.enqueue(fx(() => {
      order.push('outer');
      const inner = new EffectQueue();
      inner.enqueueLocal(fx(() => {
        order.push('inner1');
        // 经过外层队列引用入队，也必须路由到当前最内层（inner）
        q.enqueue(fx(() => order.push('routed-to-inner')));
        inner.enqueueLocal(fx(() => order.push('inner2')));
      }));
      inner.resolve();
      order.push('outer-done');
    }));
    q.resolve();
    expect(order).toEqual(['outer', 'inner1', 'routed-to-inner', 'inner2', 'outer-done']);
  });

  test('9. 空队列 resolve 安全且不污染活动队列栈', () => {
    const q = new EffectQueue();
    expect(() => q.resolve()).not.toThrow();
    expect(() => q.resolve()).not.toThrow();
    expect(EffectQueue.active).toBeNull();
    expect(q.pending).toBe(0);
  });

  test('10. 一万个效果顺序执行不溢出且顺序正确', () => {
    const order = [];
    const q = new EffectQueue();
    for (let i = 1; i <= 10000; i += 1) {
      const n = i;
      q.enqueue(fx(() => order.push(n)));
    }
    q.resolve();
    expect(order.length).toBe(10000);
    expect(order[0]).toBe(1);
    expect(order[9999]).toBe(10000);
    expect(q.pending).toBe(0);
  });

  test('11. 相同入队过程的执行顺序可复现', () => {
    const build = () => {
      const local = [];
      const queue = new EffectQueue();
      queue.enqueue(fx(() => {
        local.push(1);
        queue.enqueue(fx(() => local.push(4)));
      }));
      queue.enqueue(fx(() => local.push(2)));
      queue.enqueue(fx(() => {
        local.push(3);
        queue.enqueue(fx(() => local.push(5)));
      }));
      queue.resolve();
      return local;
    };
    expect(build()).toEqual([1, 2, 3, 4, 5]);
    expect(build()).toEqual(build());
  });

  test('12. 效果抛错中断后队列状态一致，可继续排空且活动栈恢复', () => {
    const order = [];
    const q = new EffectQueue();
    q.enqueue(fx(() => order.push('A')));
    q.enqueue(fx(() => { throw new Error('boom'); }));
    q.enqueue(fx(() => order.push('C')));
    expect(() => q.resolve()).toThrow('boom');
    expect(order).toEqual(['A']);
    expect(q.pending).toBe(1); // C 保留在队列中
    expect(EffectQueue.active).toBeNull();
    q.resolve();
    expect(order).toEqual(['A', 'C']);
    expect(q.pending).toBe(0);
  });

  test('13. 执行中新触发的普通效果追加队尾，不抢先于已排队效果', () => {
    const order = [];
    const q = new EffectQueue();
    q.enqueue(fx(() => {
      order.push(1);
      q.enqueue(fx(() => order.push(3)));
    }));
    q.enqueue(fx(() => order.push(2)));
    q.resolve();
    expect(order).toEqual([1, 2, 3]);
  });

  test('14. 嵌套内层中触发的秘密只在内层插队尾，不逃逸到外层', () => {
    const ts = new TriggerSystem();
    const order = [];
    ts.register({
      type: 'secret', event: 'trap', condition: () => true,
      effect: fx(() => order.push('secret')),
    });
    const q = new EffectQueue();
    q.enqueue(fx(() => {
      order.push('outer');
      const inner = new EffectQueue();
      inner.enqueueLocal(fx(() => ts.trigger('trap', {}, inner)));
      inner.enqueueLocal(fx(() => order.push('inner-waiting')));
      inner.resolve();
      order.push('outer-done');
    }));
    q.resolve();
    expect(order).toEqual(['outer', 'inner-waiting', 'secret', 'outer-done']);
  });
});
