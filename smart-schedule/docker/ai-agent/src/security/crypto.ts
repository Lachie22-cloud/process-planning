import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export interface EncryptedPayload {
  /** Base64-encoded IV + ciphertext + auth tag */
  encrypted: string;
  /** Key version used for encryption */
  keyVersion: number;
}

/**
 * Derives a 32-byte key from an arbitrary-length secret via SHA-256.
 */
function deriveKey(secret: string): Buffer {
  const hash = createHash('sha256').update(secret).digest();
  if (hash.length !== KEY_LENGTH) {
    throw new Error(`Key derivation produced ${hash.length} bytes, expected ${KEY_LENGTH}`);
  }
  return hash;
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * Returns a single base64 string: IV (12 bytes) || ciphertext || authTag (16 bytes).
 */
export function encrypt(plaintext: string, encryptionKey: string, keyVersion: number): EncryptedPayload {
  const key = deriveKey(encryptionKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const combined = Buffer.concat([iv, ciphertext, authTag]);

  return {
    encrypted: combined.toString('base64'),
    keyVersion,
  };
}

/**
 * Decrypts an AES-256-GCM encrypted payload.
 * Expects base64-encoded: IV (12 bytes) || ciphertext || authTag (16 bytes).
 */
export function decrypt(encryptedBase64: string, encryptionKey: string): string {
  const key = deriveKey(encryptionKey);
  const data = Buffer.from(encryptedBase64, 'base64');

  if (data.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error('Invalid encrypted data: too short');
  }

  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(data.length - AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH, data.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Generates a masked hint from a credential string.
 * Example: "sk-ant-api03-abc...xyz" -> "sk-ant...xyz"
 */
export function maskCredential(credential: string): string {
  if (credential.length <= 8) return '****';
  const prefix = credential.substring(0, 6);
  const suffix = credential.substring(credential.length - 3);
  return `${prefix}...${suffix}`;
}

/**
 * Re-encrypts a credential with a new key (for key rotation).
 * Decrypts with the old key, encrypts with the new key.
 */
export function rotateEncryption(
  encryptedBase64: string,
  oldKey: string,
  newKey: string,
  newKeyVersion: number
): EncryptedPayload {
  const plaintext = decrypt(encryptedBase64, oldKey);
  return encrypt(plaintext, newKey, newKeyVersion);
}
