// Board bearer links are recoverable only through an authorized management action.
const encode = bytes => btoa(String.fromCharCode(...bytes));
const decode = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
async function key(env) {
  if (!env.MEDIA_SIGNING_SECRET) throw Error('BOARD_LINK_KEY_MISSING');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('heycar-board-link-v1|' + env.MEDIA_SIGNING_SECRET));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function sealBoardToken(token, id, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(id)}, await key(env), new TextEncoder().encode(token));
  return {iv:encode(iv),value:encode(new Uint8Array(encrypted))};
}
export async function openBoardToken(cipher, id, env) {
  const bytes = await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(cipher.iv),additionalData:new TextEncoder().encode(id)}, await key(env), decode(cipher.value));
  const token = new TextDecoder().decode(bytes);
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error('INVALID_BOARD_TOKEN');
  return token;
}
