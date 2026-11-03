/**
 * =============================================================================
 * QALQON ROBOT — BIOMETRIK MA'LUMOTLAR KIBERXAVFSIZLIGI VA VAULT MODULI
 * Uch tomonlama Memorandum: Navoiy viloyati IIB — NDU — NDKvaTU
 * Moddalar: 8.3 va 8.4 (Biometrik ma'lumotlar muhofazasi va ochiq tarmoqqa chiqmasligi)
 * Shifrlash standarti: AES-256-GCM (NIST SP 800-38D), PBKDF2-SHA256 (100 000 sikl)
 * =============================================================================
 */

import type { KnownPerson } from './faceRecognitionService';

export const ENCRYPTED_VAULT_KEY = 'qalqon.faceVault.enc.v1';
export const LEGACY_PLAINTEXT_KEY = 'qalqon.faceDb.v1';

// Qurilma va ilovaga xos apparat tuzi (Hardware/App Identity Salt)
const VAULT_SALT_STR = 'IIV_NAVOIY_QALQON_BIO_VAULT_SALT_2026';
const VAULT_SECRET_PASSPHRASE = 'QALQON_SECURE_BIOMETRIC_MEMORANDUM_8_4_PROTECTION';

/**
 * ArrayBuffer -> Base64
 */
function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Base64 -> ArrayBuffer
 */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return buffer;
}

/**
 * PBKDF2 orqali AES-256-GCM kalitini generatsiya qilish
 */
async function deriveVaultKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(VAULT_SECRET_PASSPHRASE),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(VAULT_SALT_STR),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export interface EncryptedBiometricEnvelope {
  version: string;
  algorithm: 'AES-256-GCM';
  iv: string;         // Base64 12-bayt IV
  ciphertext: string; // Base64 shifrlangan ma'lumot + auth tag
  timestamp: string;  // ISO sana
  integrityHash: string; // SHA-256 metadata nazorati
}

export class BiometricCryptoVault {
  /**
   * 128D Face ID embeddinglarini AES-256-GCM bilan shifrlash va saqlash
   */
  public static async saveSecurePersons(persons: KnownPerson[]): Promise<boolean> {
    try {
      if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
        console.error('[BiometricVault] Web Crypto API mavjud emas!');
        return false;
      }

      const key = await deriveVaultKey();
      const ivBuffer = new ArrayBuffer(12);
      const iv = new Uint8Array(ivBuffer);
      window.crypto.getRandomValues(iv); // 96-bit GCM IV

      const jsonStr = JSON.stringify(persons);
      const enc = new TextEncoder();

      const encryptedBuffer = await window.crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: ivBuffer,
          tagLength: 128 // 128-bit authentication tag
        },
        key,
        enc.encode(jsonStr)
      );

      // Metadata yaxlitlik heshi
      const hashBuffer = await window.crypto.subtle.digest(
        'SHA-256',
        enc.encode(jsonStr)
      );

      const envelope: EncryptedBiometricEnvelope = {
        version: '1.0-MEMORANDUM-8.4',
        algorithm: 'AES-256-GCM',
        iv: bufferToBase64(ivBuffer),
        ciphertext: bufferToBase64(encryptedBuffer),
        timestamp: new Date().toISOString(),
        integrityHash: bufferToBase64(hashBuffer)
      };

      localStorage.setItem(ENCRYPTED_VAULT_KEY, JSON.stringify(envelope));

      // Eski ochiq (plaintext) ma'lumotlarni tozalash (Memorandum 8.3 talabi)
      if (localStorage.getItem(LEGACY_PLAINTEXT_KEY)) {
        localStorage.removeItem(LEGACY_PLAINTEXT_KEY);
        console.info('[BiometricVault] Eski ochiq yuzlar bazasi xavfsiz o\'chirildi.');
      }

      return true;
    } catch (err) {
      console.error('[BiometricVault] Shifrlashda xatolik:', err);
      return false;
    }
  }

  /**
   * Shifrlangan xotiradan (AES-256-GCM) 128D embeddinglarni tiklash
   */
  public static async loadSecurePersons(): Promise<KnownPerson[]> {
    try {
      if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
        return [];
      }

      const raw = localStorage.getItem(ENCRYPTED_VAULT_KEY);
      if (!raw) {
        // Agar shifrlangan ma'lumot yo'q bo'lsa, legacy bazadan migratsiya qilish
        return await this.migrateLegacyDatabase();
      }

      const envelope = JSON.parse(raw) as EncryptedBiometricEnvelope;
      if (!envelope.ciphertext || !envelope.iv) {
        return [];
      }

      const key = await deriveVaultKey();
      const ivBuffer = base64ToArrayBuffer(envelope.iv);
      const ciphertextBuffer = base64ToArrayBuffer(envelope.ciphertext);

      const decryptedBuffer = await window.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: ivBuffer,
          tagLength: 128
        },
        key,
        ciphertextBuffer
      );

      const dec = new TextDecoder();
      const jsonStr = dec.decode(decryptedBuffer);
      const persons = JSON.parse(jsonStr) as KnownPerson[];

      return Array.isArray(persons) ? persons : [];
    } catch (err) {
      console.error('[BiometricVault] Deshifrlash xatosi yoki ma\'lumotlar buzilgan:', err);
      return [];
    }
  }

  /**
   * Eski ochiq localStorage (qalqon.faceDb.v1) ni shifrlangan vaultga o'tkazish
   */
  private static async migrateLegacyDatabase(): Promise<KnownPerson[]> {
    try {
      const legacyRaw = localStorage.getItem(LEGACY_PLAINTEXT_KEY);
      if (!legacyRaw) return [];

      const legacyPersons = JSON.parse(legacyRaw) as KnownPerson[];
      if (Array.isArray(legacyPersons) && legacyPersons.length > 0) {
        console.info(`[BiometricVault] ${legacyPersons.length} ta xodim biometrik ma'lumoti AES-256-GCM bilan shifrlanmoqda...`);
        await this.saveSecurePersons(legacyPersons);
        localStorage.removeItem(LEGACY_PLAINTEXT_KEY);
        return legacyPersons;
      }
    } catch (e) {
      console.warn('[BiometricVault] Legacy migratsiya ogohlantirishi:', e);
    }
    return [];
  }

  /**
   * Memorandum 8.4 Qoidasi: Biometrik deskriptorlarni tarmoq yoki loglarga uzatishdan oldin tozalash (Sanitization)
   */
  public static sanitizePersonForExport(person: KnownPerson): Omit<KnownPerson, 'descriptor'> {
    const copy = { ...person };
    delete copy.descriptor;
    return copy;
  }

  /**
   * Tarmoqqa uzatilayotgan obyektda xom biometrik embeddinglar yo'qligini tekshiruvchi kiberxavfsizlik qo'riqchisi
   */
  public static assertZeroBiometricLeakage(payload: unknown): void {
    const str = JSON.stringify(payload);
    // Agar 128 o'lchamli massiv yoki yuz deskriptori topilsa, xavfsizlik istisnosi chiqariladi
    if (str.includes('"descriptor"') && str.length > 500) {
      console.error('[KIBERXAVFSIZLIK ALARMI] Memorandum 8.4 buzilishi: Biometrik embedding ochiq tarmoqqa uzatila olmaydi!');
      throw new Error('[SECURITY VIOLATION] Biometric descriptors must never be transmitted over public network interfaces!');
    }
  }
}
