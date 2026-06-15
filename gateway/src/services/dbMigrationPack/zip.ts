/**
 * Minimal deterministic ZIP writer for the DB migration pack download.
 *
 * Spec: 2026-06-11 Source-Grade DB Schema + Data Migration Pack — Task 4.5.
 *
 * The pack zip is assembled ON DEMAND from AMS `db_migration_pack_files`
 * rows (file_path -> entry path) — no filesystem artifacts at any point.
 * No zip library exists anywhere in the repo's dependency set, so this is a
 * self-contained STORE-method (no compression) ZIP implementation per the
 * PKWARE APPNOTE: local file headers + central directory + end-of-central-
 * directory record, CRC-32 per entry, UTF-8 entry names (general-purpose
 * flag bit 11).
 *
 * DETERMINISM: entry timestamps are fixed at the DOS epoch (1980-01-01
 * 00:00:00) so two downloads of an unchanged pack are byte-identical — the
 * same checksum-stability discipline as the Liquibase changesets.
 *
 * Pack content is text (changelogs / SQL scripts / manifest / readme), so
 * STORE keeps the implementation tiny; archive size is not a concern at
 * pack scale.
 */

export interface ZipEntry {
  /** Relative path inside the archive (forward slashes). */
  path: string;
  /** UTF-8 text content. */
  content: string;
}

// ---------------------------------------------------------------------------
// CRC-32 (IEEE 802.3 polynomial, the ZIP standard)
// ---------------------------------------------------------------------------

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Archive assembly
// ---------------------------------------------------------------------------

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
/** General-purpose flag bit 11: entry name is UTF-8. */
const UTF8_FLAG = 0x0800;
/** Fixed DOS date 1980-01-01 (day 1, month 1, year offset 0) — determinism. */
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;

/**
 * Build a complete ZIP archive (STORE method) from text entries. Entries are
 * written in the given order — callers pass AMS rows in `sort_order` so the
 * archive layout mirrors the pack layout.
 */
export function buildZipArchive(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.path, 'utf8');
    const dataBytes = Buffer.from(entry.content, 'utf8');
    const crc = crc32(dataBytes);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER_SIG, 0);
    local.writeUInt16LE(20, 4); // version needed to extract (2.0)
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(0, 8); // method: STORE
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dataBytes.length, 18); // compressed size (== size)
    local.writeUInt32LE(dataBytes.length, 22); // uncompressed size
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    localParts.push(local, nameBytes, dataBytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER_SIG, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed to extract
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(0, 10); // method: STORE
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(dataBytes.length, 20);
    central.writeUInt32LE(dataBytes.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42); // local header offset
    centralParts.push(central, nameBytes);

    offset += local.length + nameBytes.length + dataBytes.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4); // this disk
  eocd.writeUInt16LE(0, 6); // central-directory start disk
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16); // central-directory offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

/**
 * Read the entry paths back out of an archive built by {@link buildZipArchive}
 * (central-directory walk). Used by tests to prove the download's entry paths
 * match the AMS `db_migration_pack_files.file_path` rows.
 */
export function listZipEntryPaths(archive: Buffer): string[] {
  // Find the EOCD record (no comment is ever written, so it is the last 22
  // bytes — but scan defensively from the end anyway).
  let eocdOffset = -1;
  for (let i = archive.length - 22; i >= 0; i--) {
    if (archive.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('listZipEntryPaths: no end-of-central-directory record found.');
  }
  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  let cursor = archive.readUInt32LE(eocdOffset + 16);

  const paths: string[] = [];
  for (let n = 0; n < entryCount; n++) {
    if (archive.readUInt32LE(cursor) !== CENTRAL_HEADER_SIG) {
      throw new Error(`listZipEntryPaths: bad central-directory signature at ${cursor}.`);
    }
    const nameLen = archive.readUInt16LE(cursor + 28);
    const extraLen = archive.readUInt16LE(cursor + 30);
    const commentLen = archive.readUInt16LE(cursor + 32);
    paths.push(
      archive.slice(cursor + 46, cursor + 46 + nameLen).toString('utf8')
    );
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return paths;
}
