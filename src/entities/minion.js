
class Minion {
  constructor(id, attack, health) {
    this.id = id; this.attack = attack; this.health = health;
    this.dead = false; this.buffs = [];
  }
  takeDamage(amount) {
    this.health -= amount;
    if (this.health <= 0) this.dead = true;
  }
}

module.exports = { Minion };
