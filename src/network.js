import { CONFIG as C } from './config.js';
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// PeerJS uses our six-character codes. GameRelay's native codes can be shorter.
const codePattern = /^[A-Z0-9]{4,12}$/;
export const roomCode = () =>
  [...crypto.getRandomValues(new Uint8Array(6))].map((n) => alphabet[n % alphabet.length]).join('');
export function readRoom(value) {
  let text = String(value || '').trim();
  if (text.includes('://')) {
    try {
      const u = new URL(text);
      text = u.searchParams.get('room') || u.searchParams.get('join') || '';
    } catch {
      return null;
    }
  }
  text = text.toUpperCase().replace(/\s/g, '');
  return codePattern.test(text) ? text : null;
}
export function networkError(error) {
  const kind = error?.type || error?.code || '';
  const map = {
    'peer-unavailable': '房间不存在或房主已离开，请核对房间号',
    'unavailable-id': '房间号已被使用，请重新创建',
    network: '信令服务暂时不可达，请检查网络后重试',
    'server-error': '公共信令服务暂时不可用',
    'socket-error': '联机通道断开，请重试',
    'browser-incompatible': '浏览器不支持 WebRTC，请使用新版 Chrome、Edge 或 Firefox',
    room_full: '房间已满，最多四位道友',
    full: '房间已满，最多四位道友',
    not_found: '房间不存在或已关闭',
    unauthorized: 'GameRelay 公开 key 或允许域名配置不正确',
  };
  return map[kind] || String(error?.message || error || '联机失败').slice(0, 180);
}
export class Network {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.peer = null;
    this.links = new Map();
    this.pendingLinks = new Set();
    this.status = 'offline';
    this.host = false;
    this.id = `p_${crypto.randomUUID()}`;
    this.code = '';
    this.closed = true;
    this.ping = 0;
    this.lastSeen = 0;
    this.interval = null;
    this.generation = 0;
    this.relay = null;
    this.room = null;
    this.cleanup = [];
    this.parts = new Map();
    this.transferId = 0;
    this.provider = 'peer';
    this.reconnectCount = 0;
    this.timerSet = new Set();
    this.bytesSent = 0;
  }
  statusText(text) {
    this.callbacks.status?.(text);
  }
  timer(fn, ms) {
    const id = setTimeout(() => {
      this.timerSet.delete(id);
      fn();
    }, ms);
    this.timerSet.add(id);
    return id;
  }
  untimer(id) {
    clearTimeout(id);
    this.timerSet.delete(id);
  }
  invite() {
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    u.searchParams.set('room', this.code);
    if (this.provider === 'relay') u.searchParams.set('net', 'relay');
    return u.href;
  }
  get key() {
    return import.meta.env.VITE_GAMERELAY_PUBLIC_KEY || C.network.publicKey;
  }
  async start(host, code, profile, requestedProvider) {
    this.close(false);
    const gen = ++this.generation;
    this.closed = false;
    this.host = host;
    this.code = host ? roomCode() : readRoom(code);
    if (!host && !/^p_[0-9a-f-]{36}$/i.test(this.id)) this.id = `p_${crypto.randomUUID()}`;
    if (!this.code) {
      this.closed = true;
      throw new Error('请输入 6 位房间号，或粘贴完整邀请链接');
    }
    this.status = 'connecting';
    this.statusText(host ? '正在开辟洞天…' : `正在进入 ${this.code}…`);
    const hasKey = /^gr_pub_[A-Za-z0-9_-]+$/.test(this.key) && !this.key.includes('替换');
    this.provider =
      requestedProvider === 'relay' || (C.network.provider !== 'peer' && hasKey) ? 'relay' : 'peer';
    try {
      if (this.provider === 'relay') {
        if (!hasKey) throw new Error('此房间使用 GameRelay，但本站尚未配置公开 key');
        await this.startRelay(host, code, profile, gen);
      } else await this.startPeer(host, profile, gen);
      if (gen !== this.generation || this.closed) throw new Error('连接已取消');
      this.status = host ? 'hosting' : 'joined';
      this.lastSeen = performance.now();
      this.statusText(host ? '洞天已开启 · 等待道友' : '已加入洞天');
      this.heartbeat();
      return this.initial;
    } catch (e) {
      if (gen === this.generation) this.close(false);
      throw new Error(networkError(e));
    }
  }
  async startPeer(host, profile, gen) {
    const { Peer } = await import('peerjs');
    if (gen !== this.generation) throw new Error('连接已取消');
    const peer = new Peer(host ? C.network.peerPrefix + this.code : undefined, {
      debug: 0,
      config: { iceServers: C.network.iceServers },
    });
    this.peer = peer;
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        this.untimer(timeout);
        this.cancelPending = null;
        err ? reject(err) : resolve();
      };
      this.cancelPending = () => finish(new Error('连接已取消'));
      const timeout = this.timer(
        () =>
          finish(new Error('连接超时。房间可能已关闭，或当前网络限制 WebRTC；可重试或继续独行。')),
        C.network.timeoutMs
      );
      peer.on('error', (e) => {
        if (!settled) finish(e);
        else if (!this.closed) this.statusText(networkError(e));
      });
      peer.on('connection', (conn) => {
        if (this.host && !this.closed) this.accept(conn);
        else conn.close();
      });
      peer.on('disconnected', () => {
        if (this.closed || peer.destroyed) return;
        this.statusText('信令重连中，已建立的队伍通道继续保留');
        if (this.reconnectCount++ < C.network.maxRetries)
          this.timer(() => {
            try {
              if (!this.closed && !peer.destroyed) peer.reconnect();
            } catch (e) {
              this.statusText(networkError(e));
            }
          }, C.network.retryDelayMs);
        else this.statusText('信令重连失败；已有通道可继续，新的道友暂时无法加入');
      });
      peer.on('open', () => {
        this.reconnectCount = 0;
        if (gen !== this.generation || this.closed) {
          peer.destroy();
          return finish(new Error('连接已取消'));
        }
        if (host) {
          this.id = peer.id;
          finish();
        } else {
          const conn = peer.connect(C.network.peerPrefix + this.code, {
            reliable: true,
            serialization: 'json',
            metadata: { game: 'yunhai', version: C.network.protocol },
          });
          this.pendingLinks.add(conn);
          conn.on('open', () =>
            this.sendConnection(conn, {
              type: 'hello',
              v: C.network.protocol,
              id: this.id,
              profile,
            })
          );
          conn.on('data', (data) => {
            if (!this.valid(data)) return;
            if (data.type === 'accepted' && !settled) {
              if (!data.snapshot) return finish(new Error('房间状态不完整'));
              this.initial = data.snapshot;
              this.links.set('host', conn);
              this.pendingLinks.delete(conn);
              finish();
            } else if (data.type === 'rejected') finish(new Error(data.reason || '房间拒绝加入'));
            else if (settled && this.links.get('host') === conn) this.receive(data, 'host');
          });
          conn.on('error', (e) => {
            if (!settled) finish(e);
            else this.statusText(networkError(e));
          });
          conn.on('close', () => {
            this.pendingLinks.delete(conn);
            if (!settled) finish(new Error('房间连接已关闭'));
            else if (!this.closed && this.links.get('host') === conn) {
              this.links.delete('host');
              this.callbacks.lost?.(false, '与房主的连接已中断');
            }
          });
        }
      });
    });
  }
  accept(conn) {
    if (this.pendingLinks.size >= C.network.maxPlayers * 2) {
      conn.close();
      return;
    }
    this.pendingLinks.add(conn);
    let playerId = null;
    const timeout = this.timer(() => {
      this.pendingLinks.delete(conn);
      if (!playerId) conn.close();
    }, C.network.timeoutMs);
    const reject = (reason) => {
      this.sendConnection(conn, { type: 'rejected', reason });
      this.timer(() => conn.close(), 200);
    };
    conn.on('data', (data) => {
      if (!this.valid(data) || this.closed) return;
      if (data.type === 'hello') {
        if (playerId) return;
        if (data.v !== C.network.protocol || !/^p_[0-9a-f-]{36}$/i.test(data.id || ''))
          return reject('客户端版本不一致，请刷新网页');
        if (this.links.has(data.id)) return reject('此道友已经在房间中，请勿重复加入');
        if (this.links.size >= C.network.maxPlayers - 1) return reject('房间已满，最多四位道友');
        try {
          const snapshot = this.callbacks.join?.(data.id, data.profile);
          if (!snapshot) return reject('房间尚未准备好，请稍后重试');
          playerId = data.id;
          this.links.set(playerId, conn);
          this.pendingLinks.delete(conn);
          this.untimer(timeout);
          this.sendConnection(conn, { type: 'accepted', snapshot });
          this.statusText(`道友已入队 · ${this.links.size + 1}/4`);
        } catch (e) {
          reject(networkError(e));
        }
      } else if (playerId) this.receive(data, playerId);
    });
    conn.on('close', () => {
      this.untimer(timeout);
      this.pendingLinks.delete(conn);
      if (playerId && this.links.get(playerId) === conn) {
        this.links.delete(playerId);
        if (!this.closed) this.callbacks.leave?.(playerId);
      }
    });
    conn.on('error', () => {
      conn.close();
    });
  }
  async startRelay(host, code, profile, gen) {
    const { GameRelay } = await import('@gamerelay/sdk');
    if (gen !== this.generation || this.closed) throw new Error('连接已取消');
    const relay = await this.deadline(
      GameRelay.connect({ publicKey: this.key, playerName: profile.name, p2p: true }),
      gen,
      (r) => r.close()
    );
    this.relay = relay;
    this.room = await this.deadline(
      host ? relay.createRoom({ maxPlayers: 4, name: '云海问道' }) : relay.joinRoom(code),
      gen,
      (room) => {
        room.leave().catch(() => {});
      }
    );
    if (gen !== this.generation) {
      relay.close();
      throw new Error('连接已取消');
    }
    const room = this.room;
    this.id = relay.playerId;
    this.code = room.code;
    this.host = room.isHost;
    this.cleanup.push(room.on('message', (data, from) => this.receiveRelay(data, from)));
    this.cleanup.push(
      room.on('player_left', (id) => {
        this.links.delete(id);
        this.callbacks.leave?.(id);
      })
    );
    this.cleanup.push(
      room.on('player_disconnected', (id) =>
        this.callbacks.packet?.({ type: 'presence', active: false }, id)
      )
    );
    this.cleanup.push(
      room.on('player_reconnected', (id) =>
        this.callbacks.packet?.({ type: 'presence', active: true }, id)
      )
    );
    this.cleanup.push(
      room.on('host_changed', () => {
        if (!this.closed)
          this.callbacks.lost?.(true, '房主已离开，洞天已关闭；修为已保留，可重新开房');
      })
    );
    this.cleanup.push(
      room.on('closed', (_reason, message) => {
        if (!this.closed) this.callbacks.lost?.(true, message || 'GameRelay 房间已关闭');
      })
    );
    if (!host)
      await new Promise((resolve, reject) => {
        const timeout = this.timer(() => {
          this.awaiting = null;
          reject(new Error('房主未回应，请重试'));
        }, C.network.timeoutMs);
        this.awaiting = {
          resolve: (snapshot) => {
            this.untimer(timeout);
            this.initial = snapshot;
            resolve();
          },
          reject: (reason) => {
            this.untimer(timeout);
            reject(new Error(reason));
          },
        };
        this.relaySend({ type: 'hello', v: C.network.protocol, profile }, room.hostId);
      });
  }
  deadline(task, gen, dispose) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error, value) => {
        if (done) return;
        done = true;
        this.untimer(timeout);
        this.cancelPending = null;
        error ? reject(error) : resolve(value);
      };
      const timeout = this.timer(
        () => finish(new Error('GameRelay 连接超时，请重试或继续独行')),
        C.network.timeoutMs
      );
      this.cancelPending = () => finish(new Error('连接已取消'));
      task
        .then((value) => {
          if (done || gen !== this.generation) {
            dispose?.(value);
            if (!done) finish(new Error('连接已取消'));
          } else finish(null, value);
        })
        .catch((error) => finish(error));
    });
  }
  receiveRelay(data, from) {
    if (!this.valid(data)) return;
    if (data.type === 'fragment') {
      if (
        typeof data.key !== 'string' ||
        !Number.isInteger(data.count) ||
        data.count < 1 ||
        data.count > 24 ||
        !Number.isInteger(data.i) ||
        data.i < 0 ||
        data.i >= data.count ||
        typeof data.text !== 'string' ||
        data.text.length > 6500
      )
        return;
      const key = `${from}:${data.key}`;
      if (!this.parts.has(key)) {
        if (this.parts.size >= 8) this.parts.delete(this.parts.keys().next().value);
        this.parts.set(key, {
          chunks: Array(data.count),
          count: data.count,
          at: performance.now(),
        });
      }
      const part = this.parts.get(key);
      if (part.count !== data.count) return;
      part.chunks[data.i] = data.text;
      if (part.chunks.filter((s) => typeof s === 'string').length === part.count) {
        this.parts.delete(key);
        try {
          this.receiveRelay(JSON.parse(part.chunks.join('')), from);
        } catch {
          /* Invalid packet is discarded. */
        }
      }
      return;
    }
    if (this.host && data.type === 'hello') {
      if (this.links.has(from))
        return this.relaySend({ type: 'rejected', reason: '此道友已在房间' }, from);
      if (data.v !== C.network.protocol) return;
      try {
        const snapshot = this.callbacks.join?.(from, data.profile);
        if (snapshot) {
          this.links.set(from, true);
          this.relaySend({ type: 'accepted', snapshot }, from);
        }
      } catch (e) {
        this.relaySend({ type: 'rejected', reason: networkError(e) }, from);
      }
    } else if (!this.host && from === this.room?.hostId && data.type === 'accepted') {
      this.awaiting?.resolve(data.snapshot);
      this.awaiting = null;
    } else if (!this.host && from === this.room?.hostId && data.type === 'rejected') {
      this.awaiting?.reject(data.reason);
      this.awaiting = null;
    } else if ((this.host && this.links.has(from)) || (!this.host && from === this.room?.hostId))
      this.receive(data, this.host ? from : 'host');
  }
  valid(data) {
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') return false;
    try {
      return JSON.stringify(data).length <= C.network.maxMessageBytes;
    } catch {
      return false;
    }
  }
  receive(data, from) {
    this.lastSeen = performance.now();
    if (data.type === 'ping') {
      this.send({ type: 'pong', at: data.at }, from);
      return;
    }
    if (data.type === 'pong') {
      if (Number.isFinite(data.at))
        this.ping = Math.max(0, Math.round(performance.now() - data.at));
      return;
    }
    if (data.type === 'roomClosed' && !this.host) {
      this.callbacks.lost?.(true, '房主已离开，洞天已关闭；修为已保留');
      return;
    }
    this.callbacks.packet?.(data, from);
  }
  sendConnection(conn, data) {
    try {
      if (!conn.open) return false;
      if (conn.dataChannel?.bufferedAmount > C.network.maxMessageBytes * 3 && data.type === 'state')
        return false;
      conn.send(data);
      this.bytesSent += JSON.stringify(data).length;
      return true;
    } catch {
      return false;
    }
  }
  relaySend(data, to) {
    try {
      const text = JSON.stringify(data);
      if (text.length > C.network.maxMessageBytes) return false;
      if (text.length <= 6000) this.room.send(data, to ? { to } : undefined);
      else {
        const key = String(++this.transferId),
          count = Math.ceil(text.length / 6000);
        for (let i = 0; i < count; i++)
          this.room.send(
            { type: 'fragment', key, count, i, text: text.slice(i * 6000, (i + 1) * 6000) },
            to ? { to } : undefined
          );
      }
      this.bytesSent += text.length;
      return true;
    } catch (e) {
      this.statusText(networkError(e));
      return false;
    }
  }
  send(data, target = 'host') {
    if (this.closed) return false;
    if (this.provider === 'relay')
      return this.relaySend(data, target === 'host' ? this.room?.hostId : target);
    const conn = this.links.get(target);
    return conn ? this.sendConnection(conn, data) : false;
  }
  broadcast(data) {
    if (this.closed) return;
    if (this.provider === 'relay') this.relaySend(data);
    else for (const conn of this.links.values()) this.sendConnection(conn, data);
  }
  heartbeat() {
    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => {
      if (this.closed) return;
      if (!this.host) {
        this.send({ type: 'ping', at: performance.now() });
        if (performance.now() - this.lastSeen > C.network.staleMs)
          this.statusText('网络延迟较高，正在等待房主…');
        if (performance.now() - this.lastSeen > C.network.timeoutMs * 2)
          this.callbacks.lost?.(false, '房主长时间未响应');
      }
      for (const [key, part] of this.parts)
        if (performance.now() - part.at > C.network.staleMs) this.parts.delete(key);
    }, C.network.heartbeatMs);
  }
  close(notify = true) {
    if (notify && this.host && !this.closed) this.broadcast({ type: 'roomClosed' });
    this.closed = true;
    this.generation++;
    this.status = 'offline';
    this.initial = null;
    this.reconnectCount = 0;
    this.cancelPending?.();
    this.cancelPending = null;
    this.awaiting?.reject('连接已取消');
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    for (const id of this.timerSet) clearTimeout(id);
    this.timerSet.clear();
    for (const off of this.cleanup) off();
    this.cleanup.length = 0;
    for (const conn of this.links.values()) if (conn?.close) conn.close();
    for (const conn of this.pendingLinks) conn.close();
    this.links.clear();
    this.pendingLinks.clear();
    this.peer?.destroy();
    this.peer = null;
    this.relay?.close();
    this.relay = null;
    this.room = null;
    this.parts.clear();
    this.awaiting = null;
  }
}
