import './style.css';
import { CONFIG as C } from './config.js';
import {
  World,
  cleanProfile,
  stats,
  safe,
  requirements,
  skillFor,
  priceFor,
} from './simulation.js';
import { FixedClock, clamp } from './math.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { Network, readRoom } from './network.js';
import {
  readSave,
  writeSave,
  readSettings,
  writeSettings,
  exportSave,
  importSave,
} from './storage.js';
import { Sound } from './audio.js';

const $ = (id) => document.getElementById(id);
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const saved = readSave();
let world = new World(),
  localId = 'local',
  mode = 'title',
  modalType = null,
  netBusy = false,
  remotePaused = false,
  reconnecting = false,
  connectionEpoch = 0,
  uiElapsed = 0,
  saveElapsed = 0,
  netElapsed = 0,
  inputElapsed = 0,
  lastStateTick = -1,
  eventBuffer = [],
  currentSkillRealm = -1,
  lastZone = -1,
  bannerTimer = null,
  lastNotice = '',
  lastNoticeAt = 0,
  saveWarning = false,
  lastFocus = null;
const settings = readSettings(),
  chats = [],
  departed = new Map(),
  chatTimes = new Map();
world.addPlayer(localId, saved.profile);
$('player-name').value = saved.profile.name;
let renderer;
try {
  renderer = new Renderer($('world'));
} catch (e) {
  $('loading').classList.add('hidden');
  $('fatal').classList.remove('hidden');
  $('fatal-text').textContent = e.message;
  throw e;
}
renderer.qualitySetting = settings.quality;
if (settings.quality === 'low') renderer.fx.quality = C.limits.minQuality;
const sound = new Sound();
sound.muted = settings.mute;
const me = () => world.players.get(localId);
const playing = () => mode !== 'title';
const input = new Input($('world'), openPanel, () => playing() && !modalType && !remotePaused);

function toast(text) {
  const now = performance.now();
  if (text === lastNotice && now - lastNoticeAt < 1300) return;
  lastNotice = text;
  lastNoticeAt = now;
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = text;
  $('toasts').append(node);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  setTimeout(() => {
    node.classList.add('fading');
    setTimeout(() => node.remove(), 320);
  }, 2900);
}
function save() {
  if (!playing() || !me()) return;
  const ok = writeSave(me());
  $('save-label').textContent = ok ? '修为已保存' : '存档不可写';
  if (!ok && !saveWarning) {
    toast('浏览器阻止了本地存档，可在设置中导出存档');
    saveWarning = true;
  }
}
function setStatus(text) {
  $('title-status').textContent = text;
  if ($('room-status')) $('room-status').textContent = text;
}
function queue(type, value) {
  if (!input.queue(type, value)) toast('操作队列繁忙，请稍候');
  sound.unlock();
}
function replaceURL(url) {
  try {
    history.replaceState(null, '', url);
  } catch {
    /* In sandboxed embeds, room code remains usable. */
  }
}
function cleanURL() {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  replaceURL(u);
}

const net = new Network({
  status: setStatus,
  join(id, profile) {
    const retained = departed.get(id);
    const p = world.addPlayer(id, retained?.profile || cleanProfile(profile));
    departed.delete(id);
    p.connected = true;
    p.seq = -1;
    p.lastCommand = p.acknowledged = -1;
    p.commands = [];
    toast(`${p.name}踏入洞天`);
    refreshParty();
    return { ...world.snapshot(), paused: document.hidden };
  },
  leave(id) {
    const p = world.players.get(id);
    if (p) {
      departed.set(id, { profile: cleanProfile(p), at: performance.now() });
      if (departed.size > 16) departed.delete(departed.keys().next().value);
      toast(`${p.name}暂别云海`);
      world.removePlayer(id);
      refreshParty();
    }
  },
  packet(data, from) {
    if (net.host) {
      if (!world.players.has(from)) return;
      if (data.type === 'input') world.input(from, data.input);
      else if (data.type === 'presence') {
        const p = world.players.get(from);
        p.connected = data.active === true;
        p.input = { x: 0, y: 0, aim: p.angle, attack: false };
        p.practice = false;
      } else if (data.type === 'chat') receiveChat(from, data.text);
    } else if (from === 'host') {
      if (data.type === 'state' && data.snapshot?.tick > lastStateTick) {
        if (world.restore(data.snapshot)) {
          lastStateTick = data.snapshot.tick;
          input.acknowledge(me()?.acknowledged ?? -1);
          if (Array.isArray(data.events))
            for (const e of data.events.slice(0, C.limits.events))
              if (e && typeof e.type === 'string') event(e);
          remotePaused = data.paused === true;
          refreshPause();
        }
      } else if (data.type === 'pause') {
        remotePaused = data.paused === true;
        refreshPause();
        input.clear();
        clock.reset();
      } else if (data.type === 'chat' && typeof data.text === 'string')
        appendChat(String(data.name || '道友').slice(0, 12), data.text.slice(0, 90));
    }
  },
  lost(closed, reason) {
    handleLost(closed, reason).catch((e) => {
      setStatus(e.message);
      startSolo(cleanProfile(me() || saved.profile));
    });
  },
});

function startSolo(profile = cleanProfile(me() || saved.profile)) {
  connectionEpoch++;
  netBusy = false;
  reconnecting = false;
  net.close(true);
  remotePaused = false;
  cleanURL();
  mode = 'solo';
  localId = 'local';
  world = new World();
  world.addPlayer(localId, profile);
  resetSession();
  showGame();
  toast('青篁渡已至 · 按 C 修炼，出阵斩妖');
}
function resetSession() {
  input.reset();
  currentSkillRealm = -1;
  lastZone = -1;
  eventBuffer = [];
  lastStateTick = -1;
  saveElapsed = netElapsed = inputElapsed = 0;
  renderer.fx.clear();
  clock.reset();
  closePanel();
  refreshPause();
  renderer.camera.x = renderer.camera.px = me()?.x || 1050;
  renderer.camera.y = renderer.camera.py = me()?.y || 850;
  updateUI();
}
function showGame() {
  $('title-screen').classList.add('hidden');
  $('game-ui').classList.remove('hidden');
  sound.unlock();
  setBusy(false);
}
function setBusy(value) {
  netBusy = value;
  for (const id of ['create-btn']) $(id).disabled = value;
  $('join-form').querySelector('button').disabled = value;
  if ($('room-create')) $('room-create').disabled = value;
  if ($('room-join')) $('room-join').disabled = value;
}
async function connect(host, code, provider, retry = false) {
  if (netBusy && !retry) return;
  const validCode = host ? null : readRoom(code);
  if (!host && !validCode) {
    setStatus('请输入有效的 6 位房间号');
    toast('请输入有效的 6 位房间号');
    return;
  }
  const profile = cleanProfile(me() || saved.profile);
  if (mode === 'title') profile.name = $('player-name').value.trim() || '云游客';
  save();
  const epoch = ++connectionEpoch;
  setBusy(true);
  input.clear();
  try {
    const snapshot = await net.start(host, validCode, profile, provider);
    if (epoch !== connectionEpoch) return;
    localId = net.id;
    if (host) {
      world = new World(crypto.getRandomValues(new Uint32Array(1))[0]);
      world.addPlayer(localId, profile);
      mode = 'host';
    } else {
      const next = new World();
      if (!next.restore(snapshot) || !next.players.has(localId))
        throw new Error('房间状态校验失败，请重新加入');
      world = next;
      mode = 'guest';
    }
    remotePaused = !host && snapshot?.paused === true;
    resetSession();
    if (!host) lastStateTick = world.tick;
    showGame();
    replaceURL(net.invite());
    setBusy(false);
    reconnecting = false;
    if (host) openPanel('team');
    else toast('已与道友会合 · 掉落与斩妖进度共享');
  } catch (e) {
    if (epoch !== connectionEpoch) return;
    setBusy(false);
    setStatus(e.message);
    toast(e.message);
    if (retry) throw e;
    if (playing() && mode !== 'solo') {
      startSolo(profile);
      toast('联机未成功，已保留修为并继续独行');
    }
  }
}
async function handleLost(closed, reason) {
  if (reconnecting || !playing() || mode === 'solo') return;
  save();
  toast(reason);
  setStatus(reason);
  const profile = cleanProfile(me()),
    code = net.code,
    provider = net.provider;
  if (closed) {
    startSolo(profile);
    toast(reason);
    openPanel('team');
    return;
  }
  reconnecting = true;
  remotePaused = true;
  refreshPause();
  input.clear();
  net.close(false);
  for (let attempt = 1; attempt <= C.network.maxRetries; attempt++) {
    if (!reconnecting) return;
    setStatus(`正在重连洞天 (${attempt}/${C.network.maxRetries})…`);
    try {
      await connect(false, code, provider, true);
      return;
    } catch {
      if (attempt < C.network.maxRetries)
        await new Promise((resolve) => setTimeout(resolve, C.network.retryDelayMs));
    }
  }
  if (reconnecting) {
    startSolo(profile);
    toast('重连失败，修为已保留，已转为独行');
    openPanel('team');
  }
}
function receiveChat(id, raw) {
  if (typeof raw !== 'string') return;
  const now = performance.now();
  if (now - (chatTimes.get(id) || 0) < 650) return;
  chatTimes.set(id, now);
  const text = raw
    .replace(/[\x00-\x1f]/g, '')
    .trim()
    .slice(0, 90);
  if (!text) return;
  const name = world.players.get(id)?.name || '道友';
  appendChat(name, text);
  net.broadcast({ type: 'chat', name, text });
}
function appendChat(name, text) {
  chats.push({ name, text });
  if (chats.length > 30) chats.shift();
  renderChat();
  if (modalType !== 'team') toast(`${name}：${text}`);
}
function sendChat(text) {
  if (mode === 'solo' || mode === 'title') return toast('先开辟或加入洞天即可传音');
  if (net.host) receiveChat(localId, text);
  else net.send({ type: 'chat', text: String(text).slice(0, 90) });
}
function renderChat() {
  const box = $('chat-lines');
  if (!box) return;
  box.replaceChildren();
  for (const line of chats) {
    const p = document.createElement('p'),
      b = document.createElement('b');
    b.textContent = `${line.name} · `;
    p.append(b, document.createTextNode(line.text));
    box.append(p);
  }
  box.scrollTop = box.scrollHeight;
}

function event(e) {
  if (
    !e ||
    typeof e.type !== 'string' ||
    (e.zone !== undefined && !C.zones[e.zone]) ||
    (e.x !== undefined && !Number.isFinite(e.x)) ||
    (e.y !== undefined && !Number.isFinite(e.y))
  )
    return;
  if (['cast', 'release'].includes(e.type) && (!Number.isInteger(e.skill) || !C.skills[e.skill]))
    return;
  if (['ascendStart', 'ascend', 'ascendFail'].includes(e.type) && !C.realms[e.realm]) return;
  renderer.fx.zone = me()?.zone ?? 0;
  renderer.fx.localId = localId;
  renderer.fx.handle(e);
  if (e.zone === me()?.zone) sound.play(e.type);
  if (e.type === 'notice' && e.player === localId) toast(e.text);
  if (e.type === 'death' && e.boss && e.zone === me()?.zone) toast(`斩灭 ${e.name} · 获得首领道印`);
  if (e.player === localId) {
    if (e.type === 'ascend') {
      currentSkillRealm = -1;
      save();
      toast(`踏入${C.realms[me().realm].name} · 三门新神通已觉醒`);
      showBanner(C.realms[me().realm].name, '境 界 突 破', C.realms[me().realm].title);
    }
    if (e.type === 'ascendFail') {
      save();
      openPanel('failure');
    }
    if (e.type === 'playerDeath') {
      save();
      openPanel('death');
    }
    if (['purchase', 'forge', 'heal'].includes(e.type) && modalType === 'shop') renderShop();
  }
}
function showBanner(name, en, desc) {
  if (bannerTimer) clearTimeout(bannerTimer);
  const node = $('zone-banner');
  node.querySelector('strong').textContent = name;
  node.querySelector('small').textContent = en;
  node.querySelector('span').textContent = desc;
  node.classList.remove('hidden');
  bannerTimer = setTimeout(() => node.classList.add('hidden'), 2600);
}
function refreshPause() {
  const paused = remotePaused || (modalType && mode === 'solo');
  $('pause-banner').classList.toggle('hidden', !paused);
  $('pause-banner').textContent = remotePaused
    ? reconnecting
      ? '正在重连 · 修为已保留'
      : '房主暂离 · 洞天已暂停，等待归来'
    : '独行已暂停 · 关闭面板继续修行';
}

function updateUI() {
  const p = me();
  if (!p) return;
  const s = stats(p),
    r = C.realms[p.realm],
    zone = C.zones[p.zone];
  $('hud-name').textContent = p.name;
  $('hud-realm').textContent = `${r.name} · ${r.title}`;
  $('realm-glyph').textContent = ['气', '基', '丹', '婴', '神'][p.realm];
  $('hp-fill').style.width = `${clamp(p.hp / s.hp, 0, 1) * 100}%`;
  $('mana-fill').style.width = `${clamp(p.mana / s.mana, 0, 1) * 100}%`;
  $('hp-label').textContent = `${Math.ceil(p.hp)} / ${s.hp}`;
  $('mana-label').textContent = `${Math.floor(p.mana)} / ${s.mana}`;
  $('coins').textContent = p.coins.toLocaleString('zh-CN');
  $('xp-fill').style.width = `${Math.min(100, (p.xp / r.need) * 100)}%`;
  $('xp-text').textContent = `修为 ${Math.floor(p.xp)} / ${r.need}`;
  $('quest-title').textContent =
    p.realm === 4 ? '万象归一' : `问道 · ${C.realms[p.realm + 1].name}`;
  const req = requirements(p).find((v) => !v.ok);
  $('quest-text').textContent =
    p.realm === 4
      ? '前往星渊秘境，挑战太虚星君'
      : req
        ? `${req.name} · 斩妖与参悟皆得机缘`
        : '机缘已足，回问道台突破';
  $('potion-label').textContent = `回春散 ×${p.potions}`;
  $('practice-label').classList.toggle('hidden', !p.practice);
  $('practice-btn').classList.toggle('active', p.practice);
  $('fps').textContent = `${Math.round(renderer.fps)} FPS`;
  $('network-indicator').textContent =
    mode === 'host'
      ? `房主 · ${world.players.size}/4`
      : mode === 'guest'
        ? `联机 · ${net.ping} ms`
        : '独行';
  $('team-label').textContent =
    mode === 'host' || mode === 'guest' ? `${net.code} · ${world.players.size}/4` : '结伴同行';
  if (currentSkillRealm !== p.realm) {
    currentSkillRealm = p.realm;
    $('skillbar').innerHTML = [0, 1, 2]
      .map((i) => {
        const sk = skillFor(p, i);
        return `<button class="skill" data-skill="${i}" style="--skill-color:${sk.color}" title="${escape(sk.description)} · 灵息 ${sk.cost} · 冷却 ${sk.cooldown} 秒"><div class="skill-icon">${sk.glyph}</div><div><strong>${sk.name}</strong><small>${sk.cost} 灵息 · ${sk.cooldown}s</small></div><kbd>${i + 1}</kbd><div class="cooldown-mask"></div><div class="cooldown-text"></div></button>`;
      })
      .join('');
  }
  $('skillbar')
    .querySelectorAll('.skill')
    .forEach((button, i) => {
      const cd = p.cooldowns[i];
      button.querySelector('.cooldown-mask').style.height =
        `${(cd / skillFor(p, i).cooldown) * 100}%`;
      button.querySelector('.cooldown-text').textContent = cd > 0.05 ? cd.toFixed(1) : '';
    });
  if (p.zone !== lastZone) {
    lastZone = p.zone;
    renderer.fx.clear();
    $('region-name').textContent = zone.name;
    $('region-en').textContent = zone.subtitle;
    $('region-epithet').textContent = zone.epithet;
    if (playing()) showBanner(zone.name, zone.subtitle, zone.epithet);
  }
  if (playing()) renderer.minimap($('minimap'), world, localId);
  if (p.down && modalType !== 'death') openPanel('death');
  if (modalType === 'breakthrough') renderBreakthrough();
  if (modalType === 'team') refreshParty();
}
function refreshParty() {
  const players = [...world.players.values()];
  $('party-list').replaceChildren();
  for (const p of players.filter((p) => p.id !== localId)) {
    const el = document.createElement('div');
    el.className = 'party-member';
    const name = document.createElement('span'),
      realm = document.createElement('span');
    name.textContent = p.name + (!p.connected ? ' · 暂离' : '');
    realm.textContent = `${C.realms[p.realm].name} · ${C.zones[p.zone].name}`;
    el.append(name, realm);
    $('party-list').append(el);
  }
  const box = $('team-slots');
  if (box) {
    box.replaceChildren();
    for (let i = 0; i < 4; i++) {
      const p = players[i],
        slot = document.createElement('div');
      slot.className = 'team-slot' + (p ? '' : ' empty');
      slot.textContent = p?.name || '虚位以待';
      const small = document.createElement('small');
      small.textContent = p
        ? `${C.realms[p.realm].name}${p.id === localId ? ' · 你' : ''}`
        : '邀请道友';
      slot.append(small);
      box.append(slot);
    }
  }
}

function openPanel(type) {
  if (type === 'escape') {
    if (modalType && modalType !== 'death') closePanel();
    else if (playing()) openPanel('settings');
    return;
  }
  if (!type) return;
  if (modalType === type && !['death', 'failure'].includes(type)) return closePanel();
  modalType = type;
  input.clear();
  lastFocus = document.activeElement;
  $('modal-overlay').classList.remove('hidden');
  $('modal-close').classList.toggle('hidden', type === 'death');
  const titles = {
    shop: ['青篁坊市', 'THE TRAVELLER’S EMPORIUM'],
    breakthrough: ['叩问天关', 'THE PATH OF ASCENSION'],
    map: ['山海舆图', 'THREE REALMS, ONE JOURNEY'],
    team: ['洞天 · 道友', 'A COMPANY OF IMMORTALS'],
    settings: ['修行偏好', 'MAKE THE JOURNEY YOURS'],
    help: ['入道须知', 'A CULTIVATOR’S HANDBOOK'],
    death: ['魂归青篁', 'A LIFE IS NOT THE END'],
    failure: ['天关未开', 'THE WAY CONTINUES'],
  };
  if (!titles[type]) return closePanel();
  $('modal-title').textContent = titles[type][0];
  $('modal-eyebrow').textContent = titles[type][1];
  $('modal-body').replaceChildren();
  if (type === 'shop') renderShop();
  if (type === 'breakthrough') renderBreakthrough();
  if (type === 'map') renderMap();
  if (type === 'team') renderTeam();
  if (type === 'settings') renderSettings();
  if (type === 'help') renderHelp();
  if (type === 'death' || type === 'failure') renderDeath(type === 'failure');
  refreshPause();
  clock.reset();
  $('modal-close').focus();
}
function closePanel() {
  modalType = null;
  $('modal-overlay').classList.add('hidden');
  input.clear();
  refreshPause();
  clock.reset();
  if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
}
function renderShop() {
  const p = me();
  if (!p) return;
  $('modal-body').innerHTML =
    `<div class="balance"><span>◈ ${p.coins} 灵石</span><span>◇ ${p.materials} 灵材</span><span>❧ ${p.herbs} 灵草</span></div><div class="shop-grid">${Object.entries(
      C.shop
    )
      .map(
        ([id, item]) =>
          `<article class="shop-item"><span class="item-glyph">${item.glyph}</span><div><h3>${item.name}</h3><p>${item.label}</p><button data-buy="${id}">${item.max && p[id] >= item.max ? '已至圆满' : `${priceFor(p, id)} 灵石 · 购入`}</button></div></article>`
      )
      .join(
        ''
      )}</div><div class="forge-panel"><h3>一炉造化</h3><div class="row"><div><p>淬灵 ${p.forge} / ${C.crafting.max} 阶 · 每阶伤害 +12%</p><p class="note">${p.forge >= C.crafting.max ? '灵器已至圆满' : `下一阶：${(p.forge + 1) * C.crafting.materials} 灵材 + ${(p.forge + 1) * C.crafting.coins} 灵石`}</p></div><button data-command="forge">淬炼法器</button></div><div class="row"><div><p>炼制回春散</p><p class="note">${C.crafting.herbCost} 灵草 + ${C.crafting.brewCoins} 灵石</p></div><button data-command="brew">起炉炼丹</button></div></div><p class="note">${safe(p) ? '当前位于问道台，可安心交易与炼制。' : '需回到地图中央问道台才能交易、炼器与炼丹。'} 联机时队伍继续战斗。</p>`;
}
function renderBreakthrough() {
  const p = me();
  if (!p) return;
  const r = C.realms[p.realm];
  if (p.realm === 4) {
    $('modal-body').innerHTML =
      '<div class="death-copy"><div class="death-icon" style="color:#e2d5a8">道</div><h3>万象归一，化神天成</h3><p>你的神通已尽数觉醒。携道友踏入星渊秘境，挑战太虚星君。</p></div>';
    return;
  }
  const req = requirements(p),
    ready = req.every((v) => v.ok) && safe(p);
  // Update text without rebuilding a focused button every HUD tick.
  if (!$('ascend-requirements'))
    $('modal-body').innerHTML =
      `<div class="realm-transition"><span>${r.name}</span><i>→</i><strong>${C.realms[p.realm + 1].name}</strong></div><ul class="requirement-list" id="ascend-requirements"></ul><p id="ascend-chance"></p><p class="note">突破消耗所需修为与灵材。失利保留当前境界，损失 25% 修为和 40% 所需灵材；渡厄丹确保成功。</p><button id="ascend-button" class="primary" data-command="breakthrough">引动天机 · 突破</button>`;
  $('ascend-requirements').innerHTML = req
    .map((v) => `<li class="${v.ok ? 'met' : ''}">${v.ok ? '✓' : '◇'} ${v.name}</li>`)
    .join('');
  $('ascend-chance').textContent =
    `成功率 ${p.ward > 0 ? 100 : Math.round(r.chance * 100)}%${p.ward > 0 ? ' · 渡厄丹护持' : ''} ${safe(p) ? '· 位于问道台' : '· 请先回到中央问道台'}`;
  $('ascend-button').disabled = !ready;
}
function renderMap() {
  const p = me();
  $('modal-body').innerHTML =
    C.zones
      .map(
        (z, i) =>
          `<article class="zone-card" data-zone="${i}"><small>${z.subtitle}</small><h3>${z.name}</h3><p>${z.epithet}<br>灵材：${z.material} · 首领：${z.boss}</p><button data-travel="${i}">${p.zone === i ? '身在此境' : p.realm < z.minRealm ? `${C.realms[z.minRealm].name}后开启` : '踏入此境 →'}</button></article>`
      )
      .join('') +
    '<p class="note">各境中央皆有问道台。回到中央法阵，可传送、交易、突破和回复气血。金色古碑提供一次性参悟奖励。不同区域的灵材统一计为炼器与突破材料。</p>';
}
function renderTeam() {
  const online = mode === 'host' || mode === 'guest';
  $('modal-body').innerHTML = online
    ? `<div class="room-info"><div class="row"><small>${mode === 'host' ? '你的洞天 · 房主' : '已加入洞天'} / ${net.provider === 'relay' ? 'GameRelay' : 'PeerJS'} </small><small>无需账号 · 最多四人</small></div><span class="room-code">${escape(net.code)}</span><div class="actions"><button id="copy-invite">复制邀请链接 ↗</button><button id="copy-code">复制房间号</button><button id="leave-room">离开洞天</button></div><p class="note">朋友打开网址，输入上方房间号即可会合。也可直接打开邀请链接。房主离开会关闭洞天；修为各自保存。</p></div><div id="team-slots" class="team-slots"></div><div id="chat-lines" class="chat-box" aria-live="polite"></div><div class="quick-messages"><button data-chat="道友，随我斩妖！">随我斩妖</button><button data-chat="回问道台补给吧。">回台补给</button><button data-chat="准备挑战首领！">挑战首领</button></div><form id="chat-form" class="chat-form"><input id="chat-input" maxlength="90" placeholder="千里传音…" aria-label="聊天消息"><button>传音</button></form>`
    : `<div class="room-info"><h3>道途漫漫，不妨同行</h3><p>开辟洞天，把房间号告诉朋友；或者输入朋友的房间号。无需注册，浏览器即入。</p><button id="room-create" class="primary">开辟洞天 · 2–4 人</button><form id="room-join-form" class="room-join-inline"><input id="room-code-field" maxlength="180" placeholder="6 位房间号 / 邀请链接" aria-label="加入房间号"><button id="room-join">入队 →</button></form></div>`;
  $('modal-body').insertAdjacentHTML('beforeend', '<p class="note" id="room-status"></p>');
  refreshParty();
  renderChat();
}
function renderSettings() {
  $('modal-body').innerHTML =
    `<div class="settings-row"><span>音效 · 程序化琴音与剑鸣</span><button id="toggle-sound">${settings.mute ? '已静音 · 点击开启' : '已开启 · 点击静音'}</button></div><div class="settings-row"><span>特效质量</span><select id="quality-select" aria-label="特效质量"><option value="auto">自适应</option><option value="high">完整特效</option><option value="low">轻量特效</option></select></div><p class="note">渲染随显示器刷新率运行，无帧率上限；模拟固定 60Hz。当前 ${Math.round(renderer.fps)} FPS，平均绘制 ${renderer.frameCost.toFixed(2)} ms，粒子 ${renderer.fx.active}/${C.limits.particles}。后台标签页暂停模拟。</p><div class="actions"><button id="export-save">导出修为存档</button><button id="import-save">导入存档</button><button data-action="help">修行指南</button></div><p class="note">存档保存在此浏览器与此网址，包含境界、物品和成长。定期导出可迁移设备。导入与重修需先退出联机。</p><div class="actions"><button id="back-title">保存并返回山门</button><button id="new-game">重启新旅程</button></div><input type="file" id="save-file" accept="application/json,.json" class="hidden">`;
  $('quality-select').value = settings.quality;
}
function renderHelp() {
  const rows = [
    ['WASD / 方向键', '行走'],
    ['鼠标左键按住 / U', '御剑连击'],
    ['鼠标移动', '瞄准；范围神通智能选敌'],
    ['1 2 3 / J K L', '当前境界的三门神通'],
    ['空格', '闪身 · 短暂无敌'],
    ['C', '吐纳修炼 · 移动收息'],
    ['B / E / M / T', '突破 / 坊市 / 舆图 / 组队'],
    ['H / F / Esc', '丹药 / 参悟古碑 / 菜单'],
  ];
  $('modal-body').innerHTML =
    `<div class="help-grid">${rows.map(([a, b]) => `<p><span>${a}</span><span>${b}</span></p>`).join('')}</div><p>修炼积累修为 → 出阵斩妖拾取灵材 → 回问道台突破 → 获得三门新神通 → 开启更高区域。修为积满后仍需斩妖与灵材，古碑能加快成长。</p><p>竹魇近身追击，灵弩傀远程射击，重甲卫蓄力冲锋；首领还会召唤妖邪。地面橙色范围是冲锋预警，用闪身避开。首领每次击败均计入道印。</p><p class="note">联机掉落由同区域存活道友共享，怪物血量随队伍人数增加。房主切到后台时全队暂停；道友切到后台时角色暂离且免受攻击。独行打开菜单会暂停，联机打开菜单时世界继续。推荐桌面横屏游玩，触屏可用左摇杆与右侧技能按钮。</p>`;
}
function renderDeath(failure) {
  $('modal-body').innerHTML =
    `<div class="death-copy"><div class="death-icon">${failure ? '劫' : '归'}</div><h3>${failure ? '此劫未渡，道心未灭' : '一缕神魂，重返青篁'}</h3><p>${failure ? '保留当前境界。损失部分修为与灵材，可购买渡厄丹护持下次突破。' : '已保留境界、功法与法器。回归问道台消耗 5% 随身灵石。'}</p><button class="primary" ${failure ? 'id="recover-failure"' : 'data-command="revive"'}>${failure ? '收拢心神 · 继续修行' : '魂归问道台 · 重新出发'}</button></div>`;
}

$('solo-btn').addEventListener('click', () => {
  const p = cleanProfile(me() || saved.profile);
  p.name = $('player-name').value.trim() || '云游客';
  startSolo(p);
});
$('create-btn').addEventListener('click', () => {
  connect(true).catch((e) => setStatus(e.message));
});
$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  connect(false, $('room-input').value).catch((e) => setStatus(e.message));
});
$('modal-close').addEventListener('click', closePanel);
$('modal-overlay').addEventListener('click', (e) => {
  if (e.target === $('modal-overlay') && modalType !== 'death') closePanel();
});
document.addEventListener('click', (e) => {
  const button = e.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.action) {
    openPanel(button.dataset.action);
    return;
  }
  if (button.dataset.skill !== undefined) {
    queue('skill', Number(button.dataset.skill));
    return;
  }
  if (button.dataset.command) {
    const type = button.dataset.command;
    queue(type);
    if (['breakthrough', 'revive'].includes(type)) closePanel();
    return;
  }
  if (button.dataset.buy) {
    queue('buy', button.dataset.buy);
    return;
  }
  if (button.dataset.travel !== undefined) {
    queue('travel', Number(button.dataset.travel));
    closePanel();
    return;
  }
  if (button.dataset.chat) {
    sendChat(button.dataset.chat);
    return;
  }
  const id = button.id;
  if (id === 'room-create') connect(true).catch((e) => setStatus(e.message));
  if (id === 'leave-room') {
    const p = cleanProfile(me());
    startSolo(p);
    toast('已离开洞天，修为已保存');
  }
  if (id === 'copy-invite' || id === 'copy-code') {
    const text = id === 'copy-invite' ? net.invite() : net.code;
    navigator.clipboard
      ?.writeText(text)
      .then(() => toast('已复制，发给道友即可'))
      .catch(() => {
        setStatus(text);
        toast('无法访问剪贴板，请复制面板下方的链接或房间号');
      });
    if (!navigator.clipboard) setStatus(text);
  }
  if (id === 'recover-failure') closePanel();
  if (id === 'toggle-sound') {
    settings.mute = !settings.mute;
    sound.muted = settings.mute;
    sound.unlock();
    sound.play('pickup');
    writeSettings(settings);
    renderSettings();
  }
  if (id === 'export-save') {
    const blob = new Blob([exportSave(me())], { type: 'application/json' }),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = `云海问道-${me().name}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (id === 'import-save') {
    if (mode !== 'solo') return toast('请先离开洞天，再导入修为');
    $('save-file').click();
  }
  if (id === 'back-title') {
    save();
    connectionEpoch++;
    net.close(true);
    netBusy = reconnecting = remotePaused = false;
    cleanURL();
    mode = 'title';
    closePanel();
    $('title-screen').classList.remove('hidden');
    $('game-ui').classList.add('hidden');
    $('player-name').value = me().name;
    setStatus('修为已保存 · 随时续写你的道途');
    setBusy(false);
  }
  if (id === 'new-game') {
    if (mode !== 'solo') return toast('请先离开洞天，再开启新旅程');
    $('modal-body').innerHTML =
      '<h3>重新踏上道途</h3><p>这会以全新炼气角色替换当前浏览器存档。可以先返回设置导出旧存档。</p><div class="actions"><button id="confirm-new">确认重修</button><button data-action="settings">返回设置</button></div>';
  }
  if (id === 'confirm-new') {
    startSolo({ name: me().name });
    save();
  }
});
document.addEventListener('submit', (e) => {
  if (e.target.id === 'chat-form') {
    e.preventDefault();
    sendChat($('chat-input').value);
    $('chat-input').value = '';
  }
  if (e.target.id === 'room-join-form') {
    e.preventDefault();
    connect(false, $('room-code-field').value).catch((err) => setStatus(err.message));
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'quality-select') {
    settings.quality = e.target.value;
    renderer.qualitySetting = settings.quality;
    renderer.fx.quality = settings.quality === 'low' ? C.limits.minQuality : 1;
    writeSettings(settings);
  }
  if (e.target.id === 'save-file') {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > C.save.maxBytes) return toast('存档文件过大');
    file
      .text()
      .then((text) => {
        const p = importSave(text);
        startSolo(p);
        save();
        toast('修为已导入');
      })
      .catch((err) => toast(`导入失败：${err.message}`));
  }
});
document.addEventListener('keydown', (e) => {
  if (e.code === 'Tab' && modalType) {
    const controls = [
      ...$('modal').querySelectorAll('button:not(:disabled),input:not([type=file]),select'),
    ].filter((n) => !n.classList.contains('hidden'));
    if (!controls.length) return;
    const first = controls[0],
      last = controls.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});

let joystickPointer = null;
$('joystick').addEventListener('pointerdown', (e) => {
  joystickPointer = e.pointerId;
  $('joystick').setPointerCapture(e.pointerId);
  moveStick(e);
});
$('joystick').addEventListener('pointermove', (e) => {
  if (e.pointerId === joystickPointer) moveStick(e);
});
function moveStick(e) {
  const b = $('joystick').getBoundingClientRect(),
    dx = (e.clientX - b.x - b.width / 2) / 35,
    dy = (e.clientY - b.y - b.height / 2) / 35,
    mag = Math.max(1, Math.hypot(dx, dy));
  input.touch = { x: dx / mag, y: dy / mag };
  $('joystick').firstElementChild.style.transform =
    `translate(${input.touch.x * 29}px,${input.touch.y * 29}px)`;
}
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
  $('joystick').addEventListener(type, () => {
    joystickPointer = null;
    input.touch = { x: 0, y: 0 };
    $('joystick').firstElementChild.style.transform = '';
  });
$('touch-attack').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  input.pointer.down = true;
  const p = me();
  const target = world.monsters
    .filter((m) => m.zone === p.zone && m.hp > 0)
    .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
  if (target) {
    input.pointer.x = (target.x - renderer.camera.x) * renderer.scale + innerWidth / 2;
    input.pointer.y = (target.y - renderer.camera.y) * renderer.scale + innerHeight / 2;
  }
});

const clock = new FixedClock((dt) => {
  const paused = remotePaused || (modalType && mode === 'solo');
  if (playing() && !paused && me()) {
    const data = input.read(me(), renderer, !!modalType);
    if (mode === 'guest') {
      inputElapsed += dt;
      if (inputElapsed >= 1 / C.network.inputHz) {
        inputElapsed %= 1 / C.network.inputHz;
        net.send({ type: 'input', input: data });
      }
      world.predict(dt, localId, data);
    } else {
      world.input(localId, data);
      world.step(dt);
      input.acknowledge(me()?.acknowledged ?? -1);
      const events = world.drainEvents();
      for (const e of events) event(e);
      if (mode === 'host') {
        eventBuffer.push(...events);
        if (eventBuffer.length > C.limits.events)
          eventBuffer.splice(0, eventBuffer.length - C.limits.events);
        netElapsed += dt;
        if (netElapsed >= 1 / C.network.snapshotHz) {
          netElapsed %= 1 / C.network.snapshotHz;
          net.broadcast({
            type: 'state',
            snapshot: world.snapshot(),
            events: eventBuffer,
            paused: false,
          });
          eventBuffer = [];
        }
      }
    }
    saveElapsed += dt;
    if (saveElapsed >= C.save.interval) {
      saveElapsed = 0;
      save();
    }
  } else if (playing() && mode === 'solo' && modalType === 'shop' && input.commands.length) {
    // Shop transactions are discrete commands: execute them without advancing paused combat.
    const data = input.read(me(), renderer, true);
    world.input(localId, data);
    for (const cmd of me().commands.splice(0)) {
      world.command(me(), cmd);
      me().acknowledged = cmd.n;
    }
    input.acknowledge(me().acknowledged);
    for (const e of world.drainEvents()) event(e);
    save();
  }
  renderer.update(dt, me(), mode === 'title');
  uiElapsed += dt;
  if (uiElapsed >= 0.1) {
    uiElapsed = 0;
    updateUI();
  }
});
function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden) return;
  const alpha = clock.advance(now);
  renderer.draw(world, localId, alpha, mode === 'title');
}
addEventListener('resize', () => {
  renderer.resize();
  clock.reset();
});
document.addEventListener('visibilitychange', () => {
  input.clear();
  clock.reset();
  if (document.hidden) save();
  if (mode === 'host') net.broadcast({ type: 'pause', paused: document.hidden });
  if (mode === 'guest') net.send({ type: 'presence', active: !document.hidden });
});
addEventListener('beforeunload', () => {
  save();
  net.close(true);
});

// Dev-only inspection surface; Vite eliminates it from the production bundle.
if (import.meta.env.DEV)
  window.__game = {
    get world() {
      return world;
    },
    get player() {
      return me();
    },
    get mode() {
      return mode;
    },
    get localId() {
      return localId;
    },
    renderer,
    net,
    input,
    clock,
    config: C,
    command: queue,
    openPanel,
    closePanel,
    startSolo,
    connect,
    save,
    updateUI,
    tick(n) {
      for (let i = 0; i < n; i++) {
        world.step(1 / C.simulation.hz);
        for (const e of world.drainEvents()) event(e);
        renderer.update(1 / C.simulation.hz, me());
      }
      updateUI();
    },
    showcase(realm = 0) {
      const p = me();
      p.realm = clamp(realm, 0, 4);
      p.mana = stats(p).mana;
      p.hp = stats(p).hp;
      p.cooldowns = [0, 0, 0];
      currentSkillRealm = -1;
      updateUI();
    },
    get diagnostics() {
      return {
        fps: renderer.fps,
        frameCost: renderer.frameCost,
        particles: renderer.fx.active,
        effects: renderer.fx.effects.length,
        ticks: world.tick,
        players: world.players.size,
        mode,
        dpr: renderer.dpr,
        width: renderer.canvas.width,
        height: renderer.canvas.height,
        paused: remotePaused,
        modal: modalType,
        queued: input.commands.length,
      };
    },
  };
$('loading').classList.add('hidden');
$('title-screen').classList.remove('hidden');
updateUI();
requestAnimationFrame(frame);
if (saved.warning) setStatus(saved.warning);
const params = new URLSearchParams(location.search),
  invited = params.get('room') || params.get('join');
if (invited) {
  $('room-input').value = invited;
  connect(false, invited, params.get('net') === 'relay' ? 'relay' : undefined).catch((e) =>
    setStatus(e.message)
  );
}
