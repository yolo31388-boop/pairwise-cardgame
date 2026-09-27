// 随从：attack/health 为基础值；光环加成（attackBonus/healthBonus）
// 由 TriggerSystem.updateAuras() 在任何动作结算后实时重算。
class Minion {
  constructor(id, attack, health, playOrder) {
    this.id = id;
    this.attack = attack;
    this.health = health;
    // 进场顺序，同一时刻多个亡语按此顺序触发（FIFO）
    this.playOrder = playOrder == null ? 0 : playOrder;
    this.dead = false;
    this.buffs = [];
    this.attackBonus = 0;
    this.healthBonus = 0;
  }

  // 含光环的当前攻击力/当前生命上限；光环被移除时加成同步消失
  getCurrentAttack() {
    return this.attack + this.attackBonus;
  }

  getMaxHealth() {
    return this.health + this.healthBonus;
  }

  // 当前剩余血量（光环加成立刻体现为有效血量）
  getCurrentHealth() {
    return this.health + this.healthBonus;
  }

  // 纯粹受伤：只改血量/死亡标记，不在此处穿插亡语或其他触发，
  // 亡语由死亡处理流程统一触发。
  takeDamage(amount) {
    this.health -= amount;
    if (this.getCurrentHealth() <= 0) this.dead = true;
  }
}

module.exports = { Minion };
