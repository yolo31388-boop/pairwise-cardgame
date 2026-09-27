// 触发器系统：亡语统一触发、秘密满足条件立即入队、光环实时重算、
// 目标在效果执行时实时选择。
//
// trigger 注册形如：
//   { type: 'deathrattle', owner: minionId, effect: { execute() {} } }
//   { type: 'secret', event: 'combatDamage', condition: (ctx) => bool,
//     effect: { execute() {} } }
//   { type: 'aura', source: minionId,
//     appliesTo: (minion, ctx) => bool, attack: 1, health: 1 }
class TriggerSystem {
  constructor() {
    this.triggers = [];
    this.auras = [];
    this.board = [];
    // 注册顺序即卡牌进场顺序，enqueue 时按此稳定排序（FIFO）
    this._seq = 0;
  }

  setBoard(board) {
    this.board = board;
  }

  // 创建已接线的效果队列：每个效果（含内层嵌套效果）结算后
  // 立即重算光环；若重算导致随从死亡，亡语统一追加到当前队列末尾。
  createQueue() {
    const { EffectQueue } = require('./effectQueue.js');
    return new EffectQueue(() => {
      const newlyDead = this.updateAuras();
      const active = EffectQueue.active;
      if (newlyDead.length > 0 && active) {
        this.onDeath(newlyDead, active);
      }
    });
  }

  register(trigger) {
    if (trigger.type === 'aura') {
      this.auras.push(trigger);
    } else {
      this.triggers.push(Object.assign({ seq: this._seq++ }, trigger));
    }
  }

  // 公开用途：某事件发生时触发对应效果。
  // - 秘密（secret）：满足触发条件的瞬间立即加入当前队列末尾，
  //   不等待当前效果链结束。
  // - 条件在触发瞬间判定；效果自身在 execute 时再次处理目标合法性。
  trigger(event, context, queue) {
    const { EffectQueue } = require('./effectQueue.js');
    const targetQueue = queue || EffectQueue.active;
    if (!targetQueue) return;
    for (const t of this.triggers) {
      if (t.event !== event) continue;
      if (t.condition && !t.condition(context || {})) continue;
      targetQueue.enqueue(t.effect);
    }
  }

  // 亡语统一触发入口：
  // - 单个随从死亡：onDeath(m, q)
  // - 战斗等批量死亡：onDeath(minions, q)，所有随从的死亡处理完成后
  //   统一收集全部亡语，再按随从进场顺序依次入队，死亡处理过程中不穿插。
  onDeath(minions, queue) {
    const list = Array.isArray(minions) ? minions : [minions];
    const ownerOrder = new Map();
    list.forEach((minion, index) => {
      if (!ownerOrder.has(minion.id)) ownerOrder.set(minion.id, index);
    });
    const collected = [];
    for (const t of this.triggers) {
      if (t.type !== 'deathrattle') continue;
      if (!ownerOrder.has(t.owner)) continue;
      collected.push(t);
    }
    // 按死亡随从的进场顺序，再按同随从亡语的注册顺序
    collected.sort((a, b) => {
      const oa = ownerOrder.get(a.owner);
      const ob = ownerOrder.get(b.owner);
      if (oa !== ob) return oa - ob;
      return a.seq - b.seq;
    });
    for (const t of collected) queue.enqueue(t.effect);
  }

  // 光环实时重算：任何动作（每个效果）结算后立即调用，不延迟到下回合。
  // 先清除上一帧的光环加成，再依据当前场面重新施加；
  // 返回因血量降至 0 而新死亡的随从，由引擎统一处理亡语。
  updateAuras() {
    const board = this.board || [];
    for (const minion of board) {
      minion.attackBonus = 0;
      minion.healthBonus = 0;
    }
    for (const aura of this.auras) {
      const source = board.find((m) => m.id === aura.source);
      if (!source || source.dead) continue;
      for (const minion of board) {
        if (minion.dead) continue;
        if (aura.appliesTo && !aura.appliesTo(minion, { source })) continue;
        minion.attackBonus += aura.attack || 0;
        minion.healthBonus += aura.health || 0;
      }
    }
    const newlyDead = [];
    for (const minion of board) {
      if (!minion.dead && minion.getCurrentHealth() <= 0) {
        minion.dead = true;
        newlyDead.push(minion);
      }
    }
    return newlyDead;
  }
}

// 目标在“执行时”实时选择的效果工厂：
// select(candidates, context) 每次 execute 时重新调用；
// 当前没有合法目标（例如目标已死亡）时按 cancel 处理而不是打空。
function targetedEffect(options) {
  const candidates = options.candidates || [];
  return {
    execute() {
      const legal = candidates.filter((c) => !c.dead && (!options.isLegal || options.isLegal(c)));
      const target = options.select ? options.select(legal) : legal[0];
      if (!target) {
        if (options.onCancel) options.onCancel();
        return;
      }
      options.apply(target);
    },
  };
}

module.exports = { TriggerSystem, targetedEffect };
