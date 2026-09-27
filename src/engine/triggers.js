const { EffectQueue } = require('./effectQueue.js');

// 触发器系统
// 触发器注册顺序即卡牌进场顺序: register()时写入seq,
// 同一时刻触发的多个效果严格按该顺序进入队列(FIFO)。
class TriggerSystem {
  constructor(options = {}) {
    this.triggers = [];
    this.auras = [];
    this.board = options.board || [];
    this.seq = 0;
    // 已通知过死亡的随从, 保证亡语在一次死亡处理中统一触发且不重复
    this._deathNotified = new Set();
  }

  register(trigger) {
    const entry = Object.assign({ seq: this.seq++, fired: false }, trigger);
    this.triggers.push(entry);
    if (entry.type === 'aura') this.auras.push(entry);
    return entry;
  }

  createQueue() {
    // 每个效果结算完立即重算光环, 不延迟到下回合
    return new EffectQueue({
      afterEach: () => this.updateAuras(),
    });
  }

  resolve(queue, context = {}) {
    this.updateAuras();
    queue.resolve(context);
    this.updateAuras();
  }

  // 公开统一入口: 满足条件的触发器按进场顺序立即把效果追加到当前队列末尾
  trigger(event, queue, payload = {}) {
    const enqueued = [];
    // 快照遍历: 秘密触发后会从triggers中移除, 不能边遍历边splice
    for (const t of [...this.triggers]) {
      if (!this._matches(t, event, payload)) continue;
      queue.enqueue(t.effect);
      enqueued.push(t);
      // 秘密/陷阱是一次性的, 触发后移除
      if (t.type === 'secret') {
        t.fired = true;
        this._remove(t);
      }
    }
    // 事件结算后立即重算光环
    this.updateAuras();
    return enqueued;
  }

  _matches(t, event, payload) {
    if (t.type === 'deathrattle') {
      // 亡语: 只在自己的随从死亡时触发
      return event === 'death' && t.owner === (payload.minion && payload.minion.id);
    }
    if (t.type === 'secret') {
      if (t.fired) return false;
      if (t.event !== event) return false;
      return typeof t.match === 'function' ? Boolean(t.match(payload)) : true;
    }
    return false;
  }

  _remove(entry) {
    const i = this.triggers.indexOf(entry);
    if (i >= 0) this.triggers.splice(i, 1);
  }

  // 亡语统一触发: 先收集本次同时死亡的所有随从,
  // 再按触发器(进场)顺序一次性入队, 不在死亡处理过程中穿插
  onDeath(minion, queue) {
    return this.trigger('death', queue, { minion });
  }

  _collectDead() {
    const dead = [];
    for (const m of this.board) {
      if (m.dead && !this._deathNotified.has(m.id)) {
        this._deathNotified.add(m.id);
        dead.push(m);
      }
    }
    return dead;
  }

  processDeaths(queue) {
    const dead = this._collectDead();
    // 触发器按进场顺序遍历: 同一随从/不同随从的亡语、秘密都保持FIFO
    for (const t of [...this.triggers]) {
      if (t.type === 'deathrattle' && dead.some((m) => m.id === t.owner)) {
        const minion = dead.find((m) => m.id === t.owner);
        queue.enqueue(t.effect);
      } else if (t.type === 'secret' && !t.fired) {
        const payload = { dead, minions: dead };
        if (t.event === 'death' && this._matches(t, 'death', payload)) {
          queue.enqueue(t.effect);
          t.fired = true;
          this._remove(t);
        }
      }
    }
    this.updateAuras();
  }

  // 战斗伤害同时结算: 先快照双方攻击力, 同时施加伤害,
  // 期间不触发任何一方的亡语/秘密; 全部打完后统一处理死亡
  resolveCombat(attacker, defender, queue) {
    if (!attacker.isLegalTarget() || !defender.isLegalTarget()) return;
    const attackerDamage = attacker.attack;
    const defenderDamage = defender.attack;
    // 同时结算: 两次伤害在任何效果触发前全部完成
    attacker.takeDamage(defenderDamage);
    defender.takeDamage(attackerDamage);
    this.processDeaths(queue);
    this.updateAuras();
  }

  // 群体/AOE伤害同样遵循"先同时受伤, 后统一亡语"
  dealSimultaneousDamage(assignments, queue) {
    for (const [minion, amount] of assignments) {
      if (minion.isLegalTarget()) minion.takeDamage(amount);
    }
    this.processDeaths(queue);
    this.updateAuras();
  }

  // 光环重算: 任何动作结算后立即执行
  updateAuras() {
    const active = this.auras.filter((a) => {
      const source = this.board.find((m) => m.id === a.owner);
      return !source || !source.dead;
    });
    for (const minion of this.board) {
      if (minion.dead) continue;
      const buffs = [];
      for (const aura of active) {
        const applies = typeof aura.match === 'function'
          ? aura.match(minion)
          : minion.owner === this._auraOwnerSide(aura);
        if (applies) {
          buffs.push({ attack: aura.attack || 0, health: aura.health || 0 });
        }
      }
      minion.applyBuffs(buffs);
    }
    return this.board.map((m) => ({
      id: m.id, attack: m.attack, health: m.health, dead: m.dead,
    }));
  }

  _auraOwnerSide(aura) {
    const source = this.board.find((m) => m.id === aura.owner);
    return source ? source.owner : null;
  }
}

// 目标效果工厂: 目标在效果执行时实时验证合法性;
// 目标已死亡则按候选顺序重新选择, 无合法目标则取消(不执行)
function targetedEffect(initialTarget, candidates, action, options = {}) {
  return {
    execute() {
      const pool = (Array.isArray(candidates) ? candidates : []).slice();
      let target = initialTarget;
      if (pool.indexOf(target) === -1) pool.unshift(target);
      const legal = pool.find((t) => t && t.isLegalTarget());
      if (!legal) {
        if (options.onCancel) options.onCancel();
        return;
      }
      action(legal);
    },
  };
}

module.exports = { TriggerSystem, targetedEffect };
