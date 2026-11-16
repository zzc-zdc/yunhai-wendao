import { CONFIG as C } from './config.js';
import { clamp, distance, normalize, rng, segmentDistance } from './math.js';

export const stats = (p) => {
  const r = C.realms[clamp(p.realm, 0, 4)];
  return {
    hp: r.hp,
    mana: r.mana,
    power: r.power * (1 + p.weapon * C.shop.weapon.power + p.forge * C.crafting.power),
    regen: C.player.manaRegen * (1 + p.book * C.shop.book.regen),
  };
};
export const safe = (p) => distance(p, C.world.spawn) < C.world.safeRadius;
export const skillFor = (p, slot) => C.skills[p.realm * 3 + slot];
export const priceFor = (p, id) =>
  C.shop[id] ? C.shop[id].price + (C.shop[id].priceGrowth || 0) * (p[id] || 0) : Infinity;
export function cleanProfile(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
  const read = (k, max, fallback = 0) => clamp(Number(raw[k] ?? fallback), 0, max);
  return {
    name:
      String(raw.name || '云游客')
        .replace(/[<>\x00-\x1f]/g, '')
        .slice(0, C.player.maxNameLength) || '云游客',
    realm: Math.floor(read('realm', 4)),
    xp: read('xp', C.realms[4].need),
    coins: Math.floor(read('coins', C.player.maxCurrency, C.player.initialCoins)),
    materials: Math.floor(read('materials', C.player.maxCurrency)),
    herbs: Math.floor(read('herbs', C.player.maxCurrency)),
    kills: Math.floor(read('kills', C.player.maxKills)),
    bosses: Math.floor(read('bosses', C.player.maxKills)),
    weapon: Math.floor(read('weapon', C.shop.weapon.max)),
    book: Math.floor(read('book', C.shop.book.max)),
    forge: Math.floor(read('forge', C.crafting.max)),
    potions: Math.floor(read('potions', C.player.maxConsumables, C.player.initialPotions)),
    ward: Math.floor(read('ward', C.player.maxConsumables)),
    visited: Math.floor(read('visited', 7, 1)) | 1,
    explored: Math.floor(read('explored', 511)),
    deaths: Math.floor(read('deaths', C.player.maxKills)),
  };
}
export function createPlayer(id, profile = {}) {
  const p = {
    ...cleanProfile(profile),
    id,
    ...C.world.spawn,
    px: C.world.spawn.x,
    py: C.world.spawn.y,
    zone: 0,
    angle: -0.6,
    hp: 1,
    mana: 1,
    cooldowns: [0, 0, 0],
    basicCD: 0,
    dashCD: 0,
    dash: 0,
    dashX: 0,
    dashY: 0,
    invuln: 0,
    hurt: 0,
    potionCD: 0,
    practice: false,
    casting: null,
    down: false,
    input: { x: 0, y: 0, aim: -0.6, attack: false },
    inputAge: 0,
    seq: -1,
    commands: [],
    acknowledged: -1,
    lastCommand: -1,
    connected: true,
  };
  const s = stats(p);
  p.hp = s.hp;
  p.mana = s.mana;
  p.xp = Math.min(p.xp, C.realms[p.realm].need);
  return p;
}
export function requirements(p) {
  if (p.realm >= 4) return [{ name: '已臻化神', ok: true }];
  const r = C.realms[p.realm];
  return [
    { name: `修为 ${Math.floor(p.xp)} / ${r.need}`, ok: p.xp >= r.need },
    { name: `灵材 ${p.materials} / ${r.materials}`, ok: p.materials >= r.materials },
    { name: `斩妖 ${p.kills} / ${r.kills}`, ok: p.kills >= r.kills },
    { name: `探索${C.zones[r.visit].name}`, ok: !!(p.visited & (1 << r.visit)) },
    { name: `首领 ${p.bosses} / ${r.bosses}`, ok: p.bosses >= r.bosses },
  ];
}
export class World {
  constructor(seed = C.world.seed) {
    this.seed = seed >>> 0;
    this.random = rng(this.seed);
    this.time = 0;
    this.tick = 0;
    this.nextId = 1;
    this.players = new Map();
    this.monsters = [];
    this.projectiles = [];
    this.pending = [];
    this.loot = [];
    this.events = [];
    this.commandsReceived = 0;
    for (let zone = 0; zone < 3; zone++) {
      for (let i = 0; i < C.monsters.perZone; i++) this.spawn(zone, i % 3);
      this.spawn(zone, 3);
    }
  }
  emit(type, data = {}) {
    if (this.events.length < C.limits.events) this.events.push({ type, t: this.time, ...data });
  }
  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }
  addPlayer(id, profile) {
    if (this.players.has(id)) return this.players.get(id);
    if (this.players.size >= C.network.maxPlayers) throw new Error('房间已满，最多四位道友');
    const p = createPlayer(id, profile);
    p.x += this.players.size * 28;
    p.px = p.x;
    this.players.set(id, p);
    this.rescale();
    return p;
  }
  removePlayer(id) {
    this.players.delete(id);
    this.rescale();
  }
  rescale() {
    for (const m of this.monsters) {
      const old = m.maxHp;
      m.maxHp = this.monsterHP(m.zone, m.kind);
      if (old > 0) m.hp = (m.hp / old) * m.maxHp;
    }
  }
  monsterHP(zone, kind) {
    return (
      (kind === 3 ? C.zones[zone].bossHealth : C.monsters.hp[kind] * C.zones[zone].power) *
      (1 + Math.max(0, this.players.size - 1) * C.monsters.teamScale)
    );
  }
  spawn(zone, kind, at) {
    if (this.monsters.filter((m) => m.zone === zone && m.hp > 0).length >= C.monsters.maxPerZone)
      return;
    const a = this.random() * Math.PI * 2,
      radius = C.monsters.minSpawnRadius + this.random() * C.monsters.spawnRadiusSpread;
    let x = C.world.spawn.x + Math.cos(a) * radius,
      y = C.world.spawn.y + Math.sin(a) * radius;
    if (kind === 3) {
      x = 1670;
      y = 410;
    }
    if (at) {
      x = at.x + Math.cos(a) * C.monsters.summonRadius;
      y = at.y + Math.sin(a) * C.monsters.summonRadius;
    }
    x = clamp(x, C.world.edge, C.world.width - C.world.edge);
    y = clamp(y, C.world.edge, C.world.height - C.world.edge);
    const hp = this.monsterHP(zone, kind);
    this.monsters.push({
      id: this.nextId++,
      zone,
      kind,
      x,
      y,
      px: x,
      py: y,
      ox: x,
      oy: y,
      hp,
      maxHp: hp,
      seed: this.random() * 100,
      angle: a,
      cd: 1 + this.random(),
      hurt: 0,
      slow: 0,
      state: 'idle',
      timer: 0,
      vx: 0,
      vy: 0,
      respawn: 0,
      summon: C.monsters.summonCooldown,
      temporary: !!at,
    });
  }
  input(id, value = {}) {
    const p = this.players.get(id);
    if (!p || !Number.isInteger(value.seq) || value.seq <= p.seq) return;
    p.seq = value.seq;
    p.inputAge = 0;
    const n = normalize(clamp(Number(value.x), -1, 1), clamp(Number(value.y), -1, 1));
    p.input = {
      ...n,
      aim: clamp(Number(value.aim), -Math.PI * 100, Math.PI * 100),
      attack: value.attack === true,
    };
    if (Array.isArray(value.commands))
      for (const c of value.commands.slice(0, C.simulation.maxCommands)) {
        if (!c || !Number.isInteger(c.n) || c.n <= p.lastCommand || typeof c.type !== 'string')
          continue;
        // Sequence acknowledgement prevents duplicate purchases / skill casts after retransmission.
        p.lastCommand = c.n;
        if (p.commands.length < C.simulation.maxCommands) {
          p.commands.push({ n: c.n, type: c.type, value: c.value });
          this.commandsReceived++;
        }
      }
  }
  message(p, text) {
    this.emit('notice', { player: p.id, text });
  }
  step(dt = 1 / C.simulation.hz) {
    this.time += dt;
    this.tick++;
    for (const p of this.players.values()) this.updatePlayer(p, dt);
    for (const m of this.monsters) this.updateMonster(m, dt);
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const v = this.pending[i];
      v.left -= dt;
      if (v.left <= 0) {
        this.pending.splice(i, 1);
        this.resolveSkill(v);
      }
    }
    this.updateProjectiles(dt);
    this.updateLoot(dt);
    this.monsters = this.monsters.filter((m) => !m.temporary || m.hp > 0);
  }
  updatePlayer(p, dt) {
    p.px = p.x;
    p.py = p.y;
    p.inputAge += dt;
    if (p.inputAge > C.simulation.inputTimeout)
      p.input = { x: 0, y: 0, aim: p.angle, attack: false };
    for (let i = 0; i < 3; i++) p.cooldowns[i] = Math.max(0, p.cooldowns[i] - dt);
    for (const k of ['basicCD', 'dashCD', 'invuln', 'hurt', 'potionCD'])
      p[k] = Math.max(0, p[k] - dt);
    const commands = p.commands.splice(0);
    for (const cmd of commands) {
      this.command(p, cmd);
      p.acknowledged = cmd.n;
    }
    if (p.down || !p.connected) return;
    const s = stats(p);
    p.mana = clamp(p.mana + s.regen * dt, 0, s.mana);
    if (safe(p)) p.hp = Math.min(s.hp, p.hp + C.player.healRegen * dt);
    if (p.casting?.type === 'breakthrough') {
      p.casting.left -= dt;
      if (p.casting.left <= 0) {
        p.casting = null;
        this.finishBreakthrough(p);
      }
      return;
    }
    if (p.dash > 0) {
      p.dash = Math.max(0, p.dash - dt);
      p.x += p.dashX * C.player.dashSpeed * dt;
      p.y += p.dashY * C.player.dashSpeed * dt;
    } else {
      p.x += p.input.x * C.player.speed * dt;
      p.y += p.input.y * C.player.speed * dt;
    }
    p.x = clamp(p.x, C.world.edge, C.world.width - C.world.edge);
    p.y = clamp(p.y, C.world.edge, C.world.height - C.world.edge);
    p.angle = p.input.aim;
    if (Math.abs(p.input.x) + Math.abs(p.input.y) > 0 || p.input.attack) p.practice = false;
    if (p.input.attack) this.basic(p);
    if (p.practice) {
      p.xp = Math.min(
        C.realms[p.realm].need,
        p.xp + (C.player.practiceRate + p.realm * C.player.practiceRealmBonus) * dt
      );
      p.hp = Math.min(s.hp, p.hp + C.player.practiceHeal * dt);
    }
  }
  command(p, cmd) {
    if (cmd.type === 'revive') {
      if (p.down) {
        p.down = false;
        p.deaths++;
        p.coins -= Math.floor(p.coins * C.player.deathTax);
        p.zone = 0;
        p.x = C.world.spawn.x;
        p.y = C.world.spawn.y;
        p.px = p.x;
        p.py = p.y;
        p.hp = stats(p).hp;
        p.mana = stats(p).mana;
        p.invuln = C.player.reviveProtection;
        p.input = { x: 0, y: 0, aim: p.angle, attack: false };
        this.emit('revive', { player: p.id, x: p.x, y: p.y, zone: p.zone });
      }
      return;
    }
    if (p.down || p.casting) return;
    if (cmd.type === 'skill') this.cast(p, cmd.value);
    else if (cmd.type === 'dash' && p.dashCD <= 0) {
      p.practice = false;
      const n = normalize(p.input.x, p.input.y);
      p.dashX = n.x || n.y ? n.x : Math.cos(p.angle);
      p.dashY = n.x || n.y ? n.y : Math.sin(p.angle);
      p.dash = C.player.dashTime;
      p.dashCD = C.player.dashCooldown;
      p.invuln = C.player.invulnerability;
      this.emit('dash', {
        player: p.id,
        x: p.x,
        y: p.y,
        angle: Math.atan2(p.dashY, p.dashX),
        zone: p.zone,
      });
    } else if (cmd.type === 'practice') {
      p.practice = !p.practice;
      this.message(p, p.practice ? '吐纳天地灵气 · 移动或攻击结束修炼' : '收息归元');
    } else if (cmd.type === 'breakthrough') {
      if (p.realm >= 4) return this.message(p, '已臻化神，去星渊挑战太虚星君吧');
      if (!safe(p)) return this.message(p, '请回到中央问道台突破');
      if (requirements(p).some((r) => !r.ok)) return this.message(p, '机缘未足：先完成突破条件');
      p.practice = false;
      p.casting = { type: 'breakthrough', left: C.breakthrough.duration };
      this.emit('ascendStart', { player: p.id, x: p.x, y: p.y, zone: p.zone, realm: p.realm + 1 });
    } else if (cmd.type === 'buy') this.buy(p, cmd.value);
    else if (cmd.type === 'forge') this.forge(p);
    else if (cmd.type === 'brew') this.brew(p);
    else if (cmd.type === 'potion') {
      if (p.potions <= 0) return this.message(p, '回春散已用尽，前往坊市购买或炼丹');
      if (p.potionCD > 0) return;
      p.potions--;
      p.potionCD = C.player.potionCooldown;
      p.hp = Math.min(stats(p).hp, p.hp + stats(p).hp * C.player.potionHeal);
      this.emit('heal', { player: p.id, zone: p.zone, x: p.x, y: p.y });
    } else if (cmd.type === 'travel') {
      const z = cmd.value;
      if (!Number.isInteger(z) || !C.zones[z] || z === p.zone) return;
      if (p.realm < C.zones[z].minRealm)
        return this.message(p, `需达到${C.realms[C.zones[z].minRealm].name}境`);
      if (!safe(p)) return this.message(p, '请回中央问道台使用传送阵');
      p.zone = z;
      p.visited |= 1 << z;
      p.x = C.world.spawn.x;
      p.y = C.world.spawn.y;
      p.px = p.x;
      p.py = p.y;
      p.practice = false;
      p.invuln = C.player.travelProtection;
      this.emit('travel', { player: p.id, zone: z, x: p.x, y: p.y });
    } else if (cmd.type === 'explore') {
      const index = C.exploration.shrines.findIndex((s) => distance(p, s) < C.world.shrineRadius);
      if (index < 0) return this.message(p, '靠近地图上的金色古碑，再按 F 参悟');
      const bit = 1 << (p.zone * 3 + index);
      if (p.explored & bit) return this.message(p, '此碑已参悟');
      p.explored |= bit;
      this.reward(
        p,
        C.exploration.rewardCoins * (p.zone + 1),
        C.exploration.rewardMaterials,
        0,
        C.exploration.rewardXP
      );
      this.emit('explore', { player: p.id, zone: p.zone, x: p.x, y: p.y });
      this.message(p, '古碑顿悟 · 获得灵石、灵材与修为');
    }
  }
  finishBreakthrough(p) {
    const r = C.realms[p.realm];
    const success = p.ward > 0 || this.random() < r.chance;
    if (p.ward > 0) p.ward--;
    if (success) {
      p.materials -= r.materials;
      p.xp = 0;
      p.realm++;
      p.hp = stats(p).hp;
      p.mana = stats(p).mana;
      p.cooldowns = [0, 0, 0];
    } else {
      p.xp *= 1 - C.breakthrough.failExperienceLoss;
      p.materials -= Math.ceil(r.materials * C.breakthrough.failMaterialLoss);
    }
    this.emit(success ? 'ascend' : 'ascendFail', {
      player: p.id,
      zone: p.zone,
      x: p.x,
      y: p.y,
      realm: p.realm,
    });
  }
  buy(p, id) {
    const item = C.shop[id];
    if (!item) return;
    if (!safe(p)) return this.message(p, '回到中央问道台即可交易');
    if (
      (item.max && p[id] >= item.max) ||
      (id === 'potion' && p.potions >= C.player.maxConsumables) ||
      (id === 'ward' && p.ward >= C.player.maxConsumables)
    )
      return this.message(p, '已达持有上限');
    const price = priceFor(p, id);
    if (p.coins < price) return this.message(p, '灵石不足');
    p.coins -= price;
    if (id === 'potion') p.potions++;
    else p[id]++;
    this.emit('purchase', { player: p.id, zone: p.zone, x: p.x, y: p.y });
    this.message(p, `获得${item.name}`);
  }
  forge(p) {
    const c = C.crafting,
      n = p.forge + 1;
    if (!safe(p)) return this.message(p, '请回问道台炼器');
    if (p.forge >= c.max) return this.message(p, '法器已达圆满');
    if (p.materials < c.materials * n || p.coins < c.coins * n)
      return this.message(p, '炼器所需灵石或灵材不足');
    p.materials -= c.materials * n;
    p.coins -= c.coins * n;
    p.forge++;
    this.emit('forge', { player: p.id, zone: p.zone, x: p.x, y: p.y });
    this.message(p, `炼器成功 · 淬灵 ${p.forge} 阶`);
  }
  brew(p) {
    if (!safe(p)) return this.message(p, '请回问道台炼丹');
    if (p.potions >= C.player.maxConsumables) return this.message(p, '丹药已满');
    if (p.herbs < C.crafting.herbCost || p.coins < C.crafting.brewCoins)
      return this.message(p, '灵草或灵石不足');
    p.herbs -= C.crafting.herbCost;
    p.coins -= C.crafting.brewCoins;
    p.potions++;
    this.emit('heal', { player: p.id, zone: p.zone, x: p.x, y: p.y });
    this.message(p, '炼成回春散一份');
  }
  basic(p) {
    if (p.basicCD > 0 || p.mana < C.player.basicCost) return;
    p.basicCD = C.player.basicCooldown;
    p.mana -= C.player.basicCost;
    this.projectile({
      owner: p.id,
      zone: p.zone,
      x: p.x,
      y: p.y,
      angle: p.angle,
      speed: C.player.basicSpeed,
      life: C.player.basicRange / C.player.basicSpeed,
      damage: C.player.basicDamage * stats(p).power,
      radius: C.player.basicRadius,
      style: 'basic',
      color: C.realms[p.realm].color,
      pierce: false,
    });
    this.emit('basic', { player: p.id, zone: p.zone, x: p.x, y: p.y, angle: p.angle });
  }
  cast(p, slot) {
    if (!Number.isInteger(slot) || slot < 0 || slot > 2) return;
    const sk = skillFor(p, slot);
    if (p.cooldowns[slot] > 0) return this.message(p, `${sk.name}尚在调息`);
    if (p.mana < sk.cost) return this.message(p, '灵息不足，稍候回息');
    p.mana -= sk.cost;
    p.cooldowns[slot] = sk.cooldown;
    p.practice = false;
    const id = p.realm * 3 + slot;
    const tx = clamp(
        p.x + Math.cos(p.angle) * sk.range,
        C.world.edge,
        C.world.width - C.world.edge
      ),
      ty = clamp(p.y + Math.sin(p.angle) * sk.range, C.world.edge, C.world.height - C.world.edge);
    const nearest = this.monsters
      .filter((m) => m.zone === p.zone && m.hp > 0 && distance(m, p) <= sk.range + sk.radius)
      .sort((a, b) => distance(a, { x: tx, y: ty }) - distance(b, { x: tx, y: ty }))[0];
    const targeted = [
      'frost',
      'thunder',
      'vortex',
      'meteor',
      'nova',
      'prison',
      'galaxy',
      'judgment',
    ].includes(sk.style);
    const x = targeted ? (nearest?.x ?? tx) : p.x,
      y = targeted ? (nearest?.y ?? ty) : p.y;
    const event = { player: p.id, zone: p.zone, skill: id, x, y, ox: p.x, oy: p.y, angle: p.angle };
    if (this.pending.length < C.limits.effects) this.pending.push({ ...event, left: sk.windup });
    this.emit('cast', event);
  }
  resolveSkill(v) {
    const p = this.players.get(v.player),
      sk = C.skills[v.skill];
    if (!p || p.down || p.zone !== v.zone) return;
    if (sk.speed) {
      for (let i = 0; i < sk.count; i++) {
        const angle = v.angle + (i - (sk.count - 1) / 2) * C.player.skillSpread;
        this.projectile({
          owner: p.id,
          zone: v.zone,
          x: v.ox,
          y: v.oy,
          angle,
          speed: sk.speed,
          life: sk.range / sk.speed,
          damage: sk.damage * stats(p).power,
          radius: sk.radius * 0.3,
          style: sk.style,
          color: sk.color,
          pierce: true,
        });
      }
    } else {
      for (const m of this.monsters)
        if (m.zone === v.zone && m.hp > 0 && distance(m, v) <= sk.radius + this.monsterRadius(m)) {
          this.hitMonster(m, sk.damage * stats(p).power, p, sk.color);
          if (sk.slow) m.slow = sk.slow;
          if (sk.pull) {
            const n = normalize(v.x - m.x, v.y - m.y);
            m.x += n.x * Math.min(sk.pull, distance(m, v));
            m.y += n.y * Math.min(sk.pull, distance(m, v));
          }
        }
    }
    if (sk.heal)
      for (const friend of this.players.values())
        if (!friend.down && friend.zone === p.zone && distance(friend, p) < sk.radius) {
          friend.hp = Math.min(stats(friend).hp, friend.hp + stats(friend).hp * sk.heal);
          this.emit('heal', { player: friend.id, zone: friend.zone, x: friend.x, y: friend.y });
        }
    this.emit('release', v);
  }
  projectile(v) {
    if (this.projectiles.length < C.limits.projectiles)
      this.projectiles.push({
        ...v,
        id: this.nextId++,
        px: v.x,
        py: v.y,
        vx: Math.cos(v.angle) * v.speed,
        vy: Math.sin(v.angle) * v.speed,
        hits: [],
      });
  }
  monsterRadius(m) {
    return m.kind === 3 ? C.monsters.bossRadius : C.monsters.radius;
  }
  updateMonster(m, dt) {
    m.px = m.x;
    m.py = m.y;
    if (m.hp <= 0) {
      if (!m.temporary) {
        m.respawn -= dt;
        if (m.respawn <= 0) {
          m.hp = m.maxHp;
          m.x = m.ox;
          m.y = m.oy;
          m.state = 'idle';
          m.slow = 0;
          m.cd = 1;
          this.emit('spawn', { x: m.x, y: m.y, zone: m.zone });
        }
      }
      return;
    }
    m.hurt = Math.max(0, m.hurt - dt);
    m.slow = Math.max(0, m.slow - dt);
    m.cd -= dt;
    const targets = [...this.players.values()].filter(
      (p) => p.zone === m.zone && !p.down && p.connected && !safe(p)
    );
    const target = targets.sort((a, b) => distance(a, m) - distance(b, m))[0];
    const d = target ? distance(target, m) : Infinity;
    if (m.state === 'windup') {
      m.timer -= dt;
      if (m.timer <= 0) {
        m.state = 'charge';
        m.timer = C.monsters.chargeTime;
      }
      return;
    }
    if (m.state === 'charge') {
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.timer -= dt;
      for (const p of targets)
        if (
          segmentDistance(p.x, p.y, m.px, m.py, m.x, m.y) <
          this.monsterRadius(m) + C.player.radius
        )
          this.hitPlayer(p, C.monsters.damage[2] * C.zones[m.zone].power, m);
      if (m.timer <= 0) {
        m.state = 'chase';
        m.cd = C.monsters.chargeCooldown;
      }
    } else if (
      target &&
      d < C.monsters.aggro * (m.kind === 3 ? C.monsters.bossAggroMultiplier : 1)
    ) {
      const n = normalize(target.x - m.x, target.y - m.y);
      m.angle = Math.atan2(n.y, n.x);
      m.state = 'chase';
      if ((m.kind === 2 || m.kind === 3) && m.cd <= 0 && d < C.monsters.range) {
        m.state = 'windup';
        m.timer = C.monsters.chargeWindup;
        m.vx = n.x * C.monsters.chargeSpeed;
        m.vy = n.y * C.monsters.chargeSpeed;
        this.emit('warning', { zone: m.zone, x: m.x, y: m.y, angle: m.angle, boss: m.kind === 3 });
      } else if (m.kind === 1 && d < C.monsters.range) {
        if (m.cd <= 0) {
          m.cd = C.monsters.attackCooldown * C.monsters.rangedCooldownMultiplier;
          this.projectile({
            owner: null,
            zone: m.zone,
            x: m.x,
            y: m.y,
            angle: m.angle,
            speed: C.monsters.projectileSpeed,
            life: C.monsters.projectileLife,
            damage: C.monsters.damage[1] * C.zones[m.zone].power,
            radius: C.monsters.projectileRadius,
            style: 'enemy',
            color: '#ff907e',
          });
        }
        if (d < C.monsters.retreatDistance) {
          m.x -= n.x * C.monsters.retreatSpeed * dt;
          m.y -= n.y * C.monsters.retreatSpeed * dt;
        }
      } else if (
        d < C.monsters.attackRange + (m.kind === 3 ? C.monsters.bossRangeBonus : 0) &&
        m.cd <= 0
      ) {
        m.cd = C.monsters.attackCooldown;
        this.hitPlayer(target, C.monsters.damage[Math.min(2, m.kind)] * C.zones[m.zone].power, m);
      } else if (d > C.monsters.attackRange) {
        const speed =
          C.monsters.speed[Math.min(2, m.kind)] * (m.slow > 0 ? C.monsters.slowMultiplier : 1);
        m.x += n.x * speed * dt;
        m.y += n.y * speed * dt;
      }
      if (m.kind === 3) {
        m.summon -= dt;
        if (m.summon <= 0) {
          m.summon = C.monsters.summonCooldown;
          this.spawn(m.zone, 0, m);
          this.spawn(m.zone, 1, m);
          this.emit('summon', { zone: m.zone, x: m.x, y: m.y });
        }
      }
    } else {
      m.state = 'idle';
      m.x = m.ox + Math.sin(this.time * C.monsters.wanderSpeedX + m.seed) * C.monsters.wanderX;
      m.y = m.oy + Math.cos(this.time * C.monsters.wanderSpeedY + m.seed) * C.monsters.wanderY;
    }
    m.x = clamp(m.x, C.world.edge, C.world.width - C.world.edge);
    m.y = clamp(m.y, C.world.edge, C.world.height - C.world.edge);
    const ds = distance(m, C.world.spawn);
    if (ds < C.world.safeRadius + C.monsters.safePadding) {
      const n = normalize(m.x - C.world.spawn.x || 1, m.y - C.world.spawn.y);
      m.x = C.world.spawn.x + n.x * (C.world.safeRadius + C.monsters.safePadding);
      m.y = C.world.spawn.y + n.y * (C.world.safeRadius + C.monsters.safePadding);
    }
  }
  hitPlayer(p, damage, from) {
    if (p.down || p.invuln > 0 || safe(p)) return;
    p.hp = Math.max(0, p.hp - damage);
    p.hurt = 0.25;
    p.invuln = C.player.invulnerability;
    p.practice = false;
    this.emit('hurt', {
      player: p.id,
      zone: p.zone,
      x: p.x,
      y: p.y,
      amount: Math.ceil(damage),
      angle: Math.atan2(p.y - from.y, p.x - from.x),
    });
    if (p.hp <= 0) {
      p.down = true;
      p.casting = null;
      p.dash = 0;
      this.emit('playerDeath', { player: p.id, zone: p.zone, x: p.x, y: p.y });
    }
  }
  hitMonster(m, baseDamage, p, color) {
    if (m.hp <= 0) return;
    const critical = this.random() < C.player.criticalChance;
    const damage = Math.round(
      baseDamage *
        (critical ? C.player.criticalMultiplier : 1) *
        (m.kind === 2 || m.kind === 3 ? 1 - C.monsters.armor : 1)
    );
    m.hp = Math.max(0, m.hp - damage);
    m.hurt = 0.2;
    const n = normalize(m.x - p.x, m.y - p.y);
    if (m.kind < 2) {
      m.x += n.x * C.monsters.knockback;
      m.y += n.y * C.monsters.knockback;
    }
    this.emit('hit', {
      player: p.id,
      target: m.id,
      zone: m.zone,
      x: m.x,
      y: m.y,
      amount: damage,
      critical,
      color,
    });
    if (m.hp <= 0) {
      m.respawn = m.kind === 3 ? C.monsters.bossRespawn : C.monsters.respawn;
      m.state = 'dead';
      const z = C.zones[m.zone];
      for (const f of this.players.values())
        if (!f.down && f.zone === m.zone) {
          f.kills = Math.min(C.player.maxKills, f.kills + 1);
          if (m.kind === 3) f.bosses = Math.min(C.player.maxKills, f.bosses + 1);
          f.xp = Math.min(
            C.realms[f.realm].need,
            f.xp + z.experience * (m.kind === 3 ? C.monsters.bossXPMultiplier : 1)
          );
        }
      if (this.loot.length < C.loot.max)
        this.loot.push({
          id: this.nextId++,
          zone: m.zone,
          x: m.x,
          y: m.y,
          life: C.loot.ttl,
          coins: z.currency * (m.kind === 3 ? C.loot.bossCoinMultiplier : 1),
          materials:
            m.kind === 3 ? C.loot.bossMaterials : this.random() < C.loot.materialChance ? 1 : 0,
          herbs: this.random() < C.loot.herbChance ? 1 : 0,
          boss: m.kind === 3,
        });
      this.emit('death', {
        zone: m.zone,
        x: m.x,
        y: m.y,
        boss: m.kind === 3,
        name: m.kind === 3 ? z.boss : '',
      });
    }
  }
  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const q = this.projectiles[i];
      q.px = q.x;
      q.py = q.y;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.life -= dt;
      if (q.owner) {
        const p = this.players.get(q.owner);
        if (!p || p.down || p.zone !== q.zone) q.life = 0;
        else
          for (const m of this.monsters)
            if (
              m.zone === q.zone &&
              m.hp > 0 &&
              !q.hits.includes(m.id) &&
              segmentDistance(m.x, m.y, q.px, q.py, q.x, q.y) < this.monsterRadius(m) + q.radius
            ) {
              q.hits.push(m.id);
              this.hitMonster(m, q.damage, p, q.color);
              if (!q.pierce) {
                q.life = 0;
                break;
              }
            }
      } else
        for (const p of this.players.values())
          if (
            p.zone === q.zone &&
            !p.down &&
            segmentDistance(p.x, p.y, q.px, q.py, q.x, q.y) < C.player.radius + q.radius
          ) {
            this.hitPlayer(p, q.damage, q);
            q.life = 0;
            break;
          }
      if (q.life <= 0 || q.x < 0 || q.x > C.world.width || q.y < 0 || q.y > C.world.height)
        this.projectiles.splice(i, 1);
    }
  }
  reward(p, coins, materials, herbs, xp = 0) {
    p.coins = Math.min(C.player.maxCurrency, p.coins + coins);
    p.materials = Math.min(C.player.maxCurrency, p.materials + materials);
    p.herbs = Math.min(C.player.maxCurrency, p.herbs + herbs);
    p.xp = Math.min(C.realms[p.realm].need, p.xp + xp);
  }
  updateLoot(dt) {
    for (let i = this.loot.length - 1; i >= 0; i--) {
      const l = this.loot[i];
      l.life -= dt;
      const ps = [...this.players.values()].filter(
        (p) => p.zone === l.zone && !p.down && p.connected
      );
      const p = ps.sort((a, b) => distance(a, l) - distance(b, l))[0];
      if (p && distance(p, l) < C.loot.magnetRadius) {
        const n = normalize(p.x - l.x, p.y - l.y);
        const step = Math.min(distance(p, l), C.loot.magnetSpeed * dt);
        l.x += n.x * step;
        l.y += n.y * step;
      }
      if (p && distance(p, l) < C.loot.pickupRadius) {
        for (const f of ps) this.reward(f, l.coins, l.materials, l.herbs);
        this.emit('pickup', {
          player: p.id,
          zone: l.zone,
          x: l.x,
          y: l.y,
          coins: l.coins,
          materials: l.materials,
        });
        this.loot.splice(i, 1);
      } else if (l.life <= 0) this.loot.splice(i, 1);
    }
  }
  snapshot() {
    return {
      v: C.version,
      seed: this.seed,
      random: this.random.state(),
      time: this.time,
      tick: this.tick,
      nextId: this.nextId,
      players: [...this.players.values()].map((p) => {
        const { commands, input, ...rest } = p;
        return {
          ...rest,
          cooldowns: [...p.cooldowns],
          casting: p.casting ? { ...p.casting } : null,
          input: { ...input },
        };
      }),
      monsters: this.monsters.map((m) => ({ ...m })),
      projectiles: this.projectiles.map((q) => ({ ...q, hits: [...(q.hits || [])] })),
      loot: this.loot.map((l) => ({ ...l })),
      pending: this.pending.map((v) => ({ ...v })),
    };
  }
  restore(s) {
    if (
      !s ||
      s.v !== C.version ||
      !Number.isFinite(s.time) ||
      !Number.isInteger(s.tick) ||
      !Array.isArray(s.players) ||
      s.players.length > C.network.maxPlayers ||
      !Array.isArray(s.monsters) ||
      s.monsters.length > C.monsters.maxPerZone * 3 + C.monsters.perZone * 3 ||
      !Array.isArray(s.projectiles) ||
      s.projectiles.length > C.limits.projectiles ||
      !Array.isArray(s.loot) ||
      s.loot.length > C.loot.max
    )
      return false;
    const coords = [...s.players, ...s.monsters, ...s.projectiles, ...s.loot];
    if (
      coords.some(
        (o) =>
          !o ||
          !Number.isFinite(o.x) ||
          !Number.isFinite(o.y) ||
          !Number.isInteger(o.zone) ||
          !C.zones[o.zone]
      )
    )
      return false;
    if (
      !Number.isFinite(s.nextId) ||
      !Number.isFinite(s.random) ||
      !Number.isFinite(s.seed) ||
      s.time < 0 ||
      !Array.isArray(s.pending) ||
      s.pending.length > C.limits.effects
    )
      return false;
    if (new Set(s.players.map((p) => p.id)).size !== s.players.length) return false;
    if (
      s.players.some(
        (p) =>
          typeof p.id !== 'string' ||
          typeof p.name !== 'string' ||
          !Number.isInteger(p.realm) ||
          !C.realms[p.realm] ||
          !Array.isArray(p.cooldowns) ||
          p.cooldowns.length !== 3 ||
          p.cooldowns.some((v) => !Number.isFinite(v) || v < 0) ||
          !p.input ||
          ['x', 'y', 'aim'].some((k) => !Number.isFinite(p.input[k])) ||
          ['hp', 'mana', 'coins', 'xp', 'weapon', 'book', 'forge', 'angle', 'px', 'py'].some(
            (k) => !Number.isFinite(p[k])
          ) ||
          p.hp < 0 ||
          p.mana < 0 ||
          p.weapon < 0 ||
          p.weapon > C.shop.weapon.max ||
          p.book < 0 ||
          p.book > C.shop.book.max ||
          p.forge < 0 ||
          p.forge > C.crafting.max
      )
    )
      return false;
    if (
      s.monsters.some(
        (m) =>
          !Number.isInteger(m.kind) ||
          m.kind < 0 ||
          m.kind > 3 ||
          ['hp', 'maxHp', 'angle', 'seed', 'ox', 'oy', 'vx', 'vy', 'px', 'py'].some(
            (k) => !Number.isFinite(m[k])
          ) ||
          m.hp < 0 ||
          m.maxHp <= 0
      )
    )
      return false;
    if (
      s.projectiles.some(
        (q) =>
          ['vx', 'vy', 'angle', 'px', 'py', 'damage', 'life'].some((k) => !Number.isFinite(q[k])) ||
          typeof q.color !== 'string' ||
          !/^#[0-9a-f]{6}$/i.test(q.color)
      )
    )
      return false;
    this.seed = s.seed >>> 0;
    this.random.restore(s.random);
    this.time = s.time;
    this.tick = s.tick;
    this.nextId = s.nextId;
    this.players = new Map(s.players.map((p) => [p.id, { ...p, commands: [] }]));
    this.monsters = s.monsters;
    this.projectiles = s.projectiles;
    this.loot = s.loot;
    this.pending = s.pending || [];
    return true;
  }
  predict(dt, localId, input) {
    // Reuse deterministic steering and PRNG-seeded origins. Only the host resolves combat.
    this.time += dt;
    const p = this.players.get(localId);
    for (const f of this.players.values()) {
      f.px = f.x;
      f.py = f.y;
      if (!f.down && !f.casting && f.connected) {
        const i = f.id === localId ? input : f.input;
        if (i) {
          const n = normalize(i.x, i.y);
          f.x = clamp(f.x + n.x * C.player.speed * dt, C.world.edge, C.world.width - C.world.edge);
          f.y = clamp(f.y + n.y * C.player.speed * dt, C.world.edge, C.world.height - C.world.edge);
          f.angle = i.aim;
        }
      }
    }
    if (p) for (let i = 0; i < 3; i++) p.cooldowns[i] = Math.max(0, p.cooldowns[i] - dt);
    for (const m of this.monsters) {
      m.px = m.x;
      m.py = m.y;
      if (m.hp <= 0) continue;
      if (m.state === 'idle') {
        m.x = m.ox + Math.sin(this.time * C.monsters.wanderSpeedX + m.seed) * C.monsters.wanderX;
        m.y = m.oy + Math.cos(this.time * C.monsters.wanderSpeedY + m.seed) * C.monsters.wanderY;
      } else if (m.state === 'charge') {
        m.x += m.vx * dt;
        m.y += m.vy * dt;
      } else if (m.state === 'chase') {
        const speed =
          C.monsters.speed[Math.min(2, m.kind)] * (m.slow > 0 ? C.monsters.slowMultiplier : 1);
        m.x += Math.cos(m.angle) * speed * dt;
        m.y += Math.sin(m.angle) * speed * dt;
      }
    }
    for (const q of this.projectiles) {
      q.px = q.x;
      q.py = q.y;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
    }
  }
}
