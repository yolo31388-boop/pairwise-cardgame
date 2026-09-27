class Minion {
  constructor(id, attack, health, options = {}) {
    this.id = id;
    this.baseAttack = attack;
    this.baseHealth = health;
    this.maxHealth = health;
    this.damage = 0;
    this.dead = false;
    // playOrder即进场序号, 决定同时触发时的FIFO先后
    this.playOrder = options.playOrder ?? 0;
    this.owner = options.owner ?? null;
    this.buffs = [];
  }

  get attack() {
    return this.baseAttack + this.buffs.reduce((sum, b) => sum + (b.attack || 0), 0);
  }

  get health() {
    return this.dead ? 0 : this.maxHealth - this.damage;
  }

  takeDamage(amount) {
    if (this.dead) return;
    this.damage += amount;
    if (this.health <= 0) this.dead = true;
  }

  // 由光环系统在任何动作结算后即时重算, 不延迟到下回合
  applyBuffs(buffs) {
    this.buffs = buffs || [];
    const newMax = Math.max(1, this.baseHealth + this.buffs.reduce(
      (sum, b) => sum + (b.health || 0), 0,
    ));
    this.maxHealth = newMax;
    this.damage = Math.min(this.damage, this.maxHealth - 1);
    if (this.maxHealth - this.damage <= 0) this.dead = true;
  }

  isLegalTarget() {
    return !this.dead && this.health > 0;
  }
}

module.exports = { Minion };
