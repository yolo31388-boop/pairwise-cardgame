const { EffectQueue } = require('./effectQueue.js');

// 战斗伤害同时结算：
// 1. 先快照双方当前攻击力（含光环），再互相造成伤害；
//    伤害阶段不处理死亡、不触发亡语、不穿插任何效果。
// 2. 伤害全部落地后立即触发战斗相关秘密（满足条件瞬间入队，不等效果链结束）。
// 3. 统一收集所有死亡随从，按进场顺序把亡语加入队列末尾。
// 4. 队列里每个效果结算后光环立即重算（见 EffectQueue 的 onAfterEffect）。
function resolveCombat(attacker, defender, triggerSystem, queue) {
  const targetQueue = queue || EffectQueue.active || new EffectQueue();
  const attackerStrike = attacker.getCurrentAttack();
  const defenderStrike = defender.getCurrentAttack();

  // 同时结算：仅施加伤害，死亡标记也只用于标记，不触发任何亡语
  attacker.takeDamage(defenderStrike);
  defender.takeDamage(attackerStrike);

  // 伤害同时落地后，秘密立即满足、立即插入当前队列
  if (triggerSystem) {
    triggerSystem.trigger(
      'combatDamage',
      { attacker, defender },
      targetQueue
    );
  }

  // 亡语在死亡处理阶段统一触发（按进场顺序 FIFO），不与伤害穿插
  if (triggerSystem) {
    const dead = [attacker, defender]
      .filter((m) => m.dead)
      .sort((a, b) => a.playOrder - b.playOrder);
    triggerSystem.onDeath(dead, targetQueue);
  }

  return targetQueue;
}

module.exports = { resolveCombat };
