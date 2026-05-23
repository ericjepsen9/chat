/* app_crypto.js — Client-side E2EE using Web Crypto API (ECDH + AES-256-GCM) */

const E2EE_DB_NAME = 'chat_e2ee';
const E2EE_DB_VERSION = 1;
const E2EE_STORE = 'keys';

function _openKeyDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(E2EE_DB_NAME, E2EE_DB_VERSION);
    req.onupgradeneeded = () => { req.result.createObjectStore(E2EE_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function _dbGet(key) {
  const db = await _openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(E2EE_STORE, 'readonly');
    const req = tx.objectStore(E2EE_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function _dbPut(key, value) {
  const db = await _openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(E2EE_STORE, 'readwrite');
    tx.objectStore(E2EE_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function _ab2b64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function _b642ab(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function generateKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );
  const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  return { publicKey: _ab2b64(publicKeyRaw), privateKeyJwk };
}

async function storeKeyPair(userId, publicKey, privateKeyJwk) {
  await _dbPut(`kp_${userId}`, { publicKey, privateKeyJwk });
}

async function loadKeyPair(userId) {
  return _dbGet(`kp_${userId}`);
}

async function _importPublicKey(publicKeyB64) {
  const raw = _b642ab(publicKeyB64);
  return crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

async function _importPrivateKey(jwk) {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
}

async function deriveSharedKey(privateKeyJwk, peerPublicKeyB64) {
  const privateKey = await _importPrivateKey(privateKeyJwk);
  const publicKey = await _importPublicKey(peerPublicKeyB64);
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: publicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

const _sharedKeyCache = new Map();

async function getSharedKey(userId, privateKeyJwk, peerPublicKeyB64) {
  const cacheKey = `${userId}:${peerPublicKeyB64.slice(0, 16)}`;
  let key = _sharedKeyCache.get(cacheKey);
  if (key) return key;
  key = await deriveSharedKey(privateKeyJwk, peerPublicKeyB64);
  _sharedKeyCache.set(cacheKey, key);
  if (_sharedKeyCache.size > 200) {
    const first = _sharedKeyCache.keys().next().value;
    _sharedKeyCache.delete(first);
  }
  return key;
}

async function encryptMessage(sharedKey, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    encoded
  );
  return _ab2b64(iv) + '.' + _ab2b64(ciphertext);
}

async function decryptMessage(sharedKey, encrypted) {
  const parts = encrypted.split('.');
  if (parts.length !== 2) return null;
  try {
    const iv = _b642ab(parts[0]);
    const ciphertext = _b642ab(parts[1]);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      sharedKey,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  } catch (_) {
    return null;
  }
}

async function encryptGroupKey(groupKeyRaw, memberPublicKeyB64, myPrivateKeyJwk) {
  const sharedKey = await deriveSharedKey(myPrivateKeyJwk, memberPublicKeyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    groupKeyRaw
  );
  return _ab2b64(iv) + '.' + _ab2b64(ciphertext);
}

async function decryptGroupKey(encryptedGroupKey, senderPublicKeyB64, myPrivateKeyJwk) {
  const sharedKey = await deriveSharedKey(myPrivateKeyJwk, senderPublicKeyB64);
  const parts = encryptedGroupKey.split('.');
  if (parts.length !== 2) return null;
  try {
    const iv = _b642ab(parts[0]);
    const ciphertext = _b642ab(parts[1]);
    return await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      sharedKey,
      ciphertext
    );
  } catch (_) {
    return null;
  }
}

async function generateGroupKey() {
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const raw = await crypto.subtle.exportKey('raw', key);
  return { key, raw: new Uint8Array(raw) };
}

async function importGroupKey(rawBytes) {
  return crypto.subtle.importKey(
    'raw', rawBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

window._e2ee = {
  generateKeyPair,
  storeKeyPair,
  loadKeyPair,
  getSharedKey,
  encryptMessage,
  decryptMessage,
  encryptGroupKey,
  decryptGroupKey,
  generateGroupKey,
  importGroupKey,
  clearKeyCache() { _sharedKeyCache.clear(); },
};
