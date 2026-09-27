
class TriggerSystem {
  constructor() { this.triggers = []; this.auras = []; }
  register(trigger) { this.triggers.push(trigger); }
  onDeath(minion, queue) {
    for (const t of this.triggers) {
      if (t.type === 'deathrattle' && t.owner === minion.id) {
        queue.enqueue(t.effect);
      }
    }
  }
  updateAuras() { /* BUG: 不实时更新光环 */ }
}

module.exports = { TriggerSystem };
