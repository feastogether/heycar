const digits = '零一二三四五六七八九';

export function spokenFlightNumber(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    .split('').map(char => /\d/.test(char) ? digits[Number(char)] : char).join('，');
}

export function spokenTerminal(value) {
  const terminal = String(value || '').trim();
  const match = terminal.match(/^(?:T(?:ERMINAL)?\s*|第\s*)?([12一二])(?:\s*(?:航廈|航站|TERMINAL))?$/i);
  return match ? `第${/[1一]/.test(match[1]) ? '一' : '二'}航廈` : '';
}

export function arrivalAnnouncement(watch) {
  // Missing or unrecognised terminal data must never be guessed.
  const terminal = spokenTerminal(watch.flight?.terminal);
  return `${watch.flight?.airline || '航班'}，${spokenFlightNumber(watch.flightNo)}，已抵達${terminal ? '桃園機場' + terminal : ''}。${watch.announceDriver===false?'請司機準備聯繫客戶與出發。':`請司機 ${watch.driverName||''} 準備聯繫客戶與出發。`}`;
}

export const announcementKey = watch => watch.cancelledAt ? `${watch.id}:cancelled:${watch.cancelledAt}` : watch.id;
export const eventTime = watch => watch.cancelledAt || watch.landedAt;
export function withinTrackingWindow(watch, now = Date.now()) {
  const value = watch.flight?.estimatedTime || watch.flight?.scheduledTime;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at <= now + 8 * 3600000 : !!eventTime(watch);
}
export function flightAnnouncement(watch) {
  return watch.cancelledAt
    ? `${watch.flight?.airline || '航班'}，${spokenFlightNumber(watch.flightNo)}，航班已取消。${watch.announceDriver===false?'請司機確認派趟安排。':`請司機 ${watch.driverName||''} 確認派趟安排。`}`
    : arrivalAnnouncement(watch);
}
