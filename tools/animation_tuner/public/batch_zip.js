(function attachBatchZip(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BatchZip = api;
}(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const textEncoder = new TextEncoder();
  let crcTable = null;

  /**
   * Returns a lazily generated CRC-32 lookup table.
   * @returns {Uint32Array}
   */
  function getCrcTable() {
    if (crcTable) return crcTable;
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      }
      crcTable[index] = value >>> 0;
    }
    return crcTable;
  }

  /**
   * Calculates the ZIP CRC-32 checksum for an entry.
   * @param {Uint8Array} bytes Entry bytes.
   * @returns {number}
   */
  function crc32(bytes) {
    const table = getCrcTable();
    let checksum = 0xffffffff;
    for (const byte of bytes) checksum = table[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
    return (checksum ^ 0xffffffff) >>> 0;
  }

  /**
   * Converts supported entry data to bytes.
   * @param {Uint8Array|ArrayBuffer|Blob|string} value Binary input or base64 data URL.
   * @returns {Promise<Uint8Array>}
   */
  async function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (typeof Blob !== "undefined" && value instanceof Blob) {
      return new Uint8Array(await value.arrayBuffer());
    }
    if (typeof value === "string" && value.startsWith("data:")) {
      const separator = value.indexOf(",");
      if (separator < 0) throw new Error("Invalid data URL.");
      const metadata = value.slice(0, separator);
      const payload = value.slice(separator + 1);
      if (metadata.includes(";base64")) {
        const binary = root.atob(payload);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return bytes;
      }
      return textEncoder.encode(decodeURIComponent(payload));
    }
    if (typeof value === "string") return textEncoder.encode(value);
    throw new TypeError("Unsupported ZIP entry data.");
  }

  /**
   * Attempts raw DEFLATE compression and falls back to stored entries.
   * @param {Uint8Array} bytes Original bytes.
   * @returns {Promise<{method:number,bytes:Uint8Array}>}
   */
  async function compressEntry(bytes) {
    if (typeof root.CompressionStream !== "function" || typeof Blob === "undefined") {
      return { method: 0, bytes };
    }
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new root.CompressionStream("deflate-raw"));
      const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
      if (compressed.length < bytes.length) return { method: 8, bytes: compressed };
    } catch (_error) {
      // Some WebKit versions expose CompressionStream without deflate-raw support.
    }
    return { method: 0, bytes };
  }

  /**
   * Encodes a JavaScript date in DOS time/date fields used by ZIP.
   * @param {Date} date Entry timestamp.
   * @returns {{time:number,date:number}}
   */
  function dosTimestamp(date) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  }

  /**
   * Writes a little-endian unsigned 16-bit integer.
   * @param {DataView} view Target view.
   * @param {number} offset Byte offset.
   * @param {number} value Value.
   * @returns {void}
   */
  function writeUint16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  /**
   * Writes a little-endian unsigned 32-bit integer.
   * @param {DataView} view Target view.
   * @param {number} offset Byte offset.
   * @param {number} value Value.
   * @returns {void}
   */
  function writeUint32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  /**
   * Builds a standards-compatible ZIP archive in memory.
   * @param {Array<{name:string,data:Uint8Array|ArrayBuffer|Blob|string,date?:Date}>} entries Archive entries.
   * @param {{compress?:boolean,onProgress?:(current:number,total:number)=>void}} options Build options.
   * @returns {Promise<Blob>}
   */
  async function buildZip(entries, options = {}) {
    if (!Array.isArray(entries) || !entries.length) throw new Error("ZIP requires at least one entry.");
    if (entries.length > 0xffff) throw new Error("ZIP entry limit exceeded.");
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const name = String(entry.name || `file_${index + 1}`).replaceAll("\\", "/");
      const nameBytes = textEncoder.encode(name);
      const original = await toBytes(entry.data);
      const compressed = options.compress === false
        ? { method: 0, bytes: original }
        : await compressEntry(original);
      if (original.length > 0xffffffff || compressed.bytes.length > 0xffffffff) {
        throw new Error(`ZIP64 is required for ${name}.`);
      }
      const checksum = crc32(original);
      const timestamp = dosTimestamp(entry.date instanceof Date ? entry.date : new Date());
      const flags = 0x0800;

      const localHeader = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(localHeader.buffer);
      writeUint32(localView, 0, 0x04034b50);
      writeUint16(localView, 4, 20);
      writeUint16(localView, 6, flags);
      writeUint16(localView, 8, compressed.method);
      writeUint16(localView, 10, timestamp.time);
      writeUint16(localView, 12, timestamp.date);
      writeUint32(localView, 14, checksum);
      writeUint32(localView, 18, compressed.bytes.length);
      writeUint32(localView, 22, original.length);
      writeUint16(localView, 26, nameBytes.length);
      writeUint16(localView, 28, 0);
      localHeader.set(nameBytes, 30);
      localParts.push(localHeader, compressed.bytes);

      const centralHeader = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(centralHeader.buffer);
      writeUint32(centralView, 0, 0x02014b50);
      writeUint16(centralView, 4, 20);
      writeUint16(centralView, 6, 20);
      writeUint16(centralView, 8, flags);
      writeUint16(centralView, 10, compressed.method);
      writeUint16(centralView, 12, timestamp.time);
      writeUint16(centralView, 14, timestamp.date);
      writeUint32(centralView, 16, checksum);
      writeUint32(centralView, 20, compressed.bytes.length);
      writeUint32(centralView, 24, original.length);
      writeUint16(centralView, 28, nameBytes.length);
      writeUint16(centralView, 30, 0);
      writeUint16(centralView, 32, 0);
      writeUint16(centralView, 34, 0);
      writeUint16(centralView, 36, 0);
      writeUint32(centralView, 38, 0);
      writeUint32(centralView, 42, localOffset);
      centralHeader.set(nameBytes, 46);
      centralParts.push(centralHeader);
      localOffset += localHeader.length + compressed.bytes.length;
      options.onProgress?.(index + 1, entries.length);
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    if (localOffset + centralSize > 0xffffffff) throw new Error("ZIP64 archive size limit exceeded.");
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    writeUint32(endView, 0, 0x06054b50);
    writeUint16(endView, 4, 0);
    writeUint16(endView, 6, 0);
    writeUint16(endView, 8, entries.length);
    writeUint16(endView, 10, entries.length);
    writeUint32(endView, 12, centralSize);
    writeUint32(endView, 16, localOffset);
    writeUint16(endView, 20, 0);
    return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
  }

  return { buildZip, crc32, toBytes };
}));
