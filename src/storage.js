import { CONFIG as C } from './config.js';
import { cleanProfile } from './simulation.js';
export function readSave() {
  try {
    const text = localStorage.getItem(C.save.key);
    if (!text) return { profile: cleanProfile(), exists: false };
    if (text.length > C.save.maxBytes) throw new Error('存档过大');
    const data = JSON.parse(text);
    if (data.version !== C.version || !data.profile || typeof data.profile !== 'object')
      throw new Error('存档版本不兼容');
    return { profile: cleanProfile(data.profile), exists: true };
  } catch {
    return {
      profile: cleanProfile(),
      exists: false,
      warning: '存档无法读取，已安全启用新旅程。原存档不会在标题页被覆盖。',
    };
  }
}
export function writeSave(player) {
  try {
    localStorage.setItem(
      C.save.key,
      JSON.stringify({
        version: C.version,
        savedAt: new Date().toISOString(),
        profile: cleanProfile(player),
      })
    );
    return true;
  } catch {
    return false;
  }
}
export function exportSave(player) {
  return JSON.stringify({ version: C.version, profile: cleanProfile(player) }, null, 2);
}
export function importSave(text) {
  if (text.length > C.save.maxBytes) throw new Error('存档文件过大');
  const data = JSON.parse(text);
  if (data.version !== C.version || !data.profile || typeof data.profile !== 'object')
    throw new Error('这不是有效的云海问道存档');
  return cleanProfile(data.profile);
}
export function readSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(C.save.settingsKey) || '{}');
    return {
      mute: s.mute !== false,
      quality: ['auto', 'high', 'low'].includes(s.quality) ? s.quality : 'auto',
    };
  } catch {
    return { mute: true, quality: 'auto' };
  }
}
export function writeSettings(value) {
  try {
    localStorage.setItem(C.save.settingsKey, JSON.stringify(value));
  } catch {
    /* The current session's settings still work in private mode. */
  }
}
