export const zipCrcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[index] = crc >>> 0;
  }
  return table;
})();

export function createZipBytePart(value: number, size: 2 | 4) {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    bytes[index] = (value >>> (8 * index)) & 0xff;
  }
  return bytes;
}

export function concatBytes(...parts: Uint8Array[]) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

export function getZipDateParts(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time:
      ((date.getHours() & 0x1f) << 11) |
      ((date.getMinutes() & 0x3f) << 5) |
      Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = zipCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (~crc) >>> 0;
}

export async function buildZipBlob(
  files: Array<{ name: string; blob: Blob }>,
): Promise<Blob> {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;
  const { time, date } = getZipDateParts();

  for (const file of files) {
    const fileNameBytes = encoder.encode(file.name);
    const fileBytes = new Uint8Array(await file.blob.arrayBuffer());
    const crc = crc32(fileBytes);

    const localHeader = concatBytes(
      createZipBytePart(0x04034b50, 4),
      createZipBytePart(20, 2),
      createZipBytePart(0x0800, 2),
      createZipBytePart(0, 2),
      createZipBytePart(time, 2),
      createZipBytePart(date, 2),
      createZipBytePart(crc, 4),
      createZipBytePart(fileBytes.length, 4),
      createZipBytePart(fileBytes.length, 4),
      createZipBytePart(fileNameBytes.length, 2),
      createZipBytePart(0, 2),
      fileNameBytes,
    );
    localChunks.push(localHeader, fileBytes);

    const centralHeader = concatBytes(
      createZipBytePart(0x02014b50, 4),
      createZipBytePart(20, 2),
      createZipBytePart(20, 2),
      createZipBytePart(0x0800, 2),
      createZipBytePart(0, 2),
      createZipBytePart(time, 2),
      createZipBytePart(date, 2),
      createZipBytePart(crc, 4),
      createZipBytePart(fileBytes.length, 4),
      createZipBytePart(fileBytes.length, 4),
      createZipBytePart(fileNameBytes.length, 2),
      createZipBytePart(0, 2),
      createZipBytePart(0, 2),
      createZipBytePart(0, 2),
      createZipBytePart(0, 2),
      createZipBytePart(0, 4),
      createZipBytePart(offset, 4),
      fileNameBytes,
    );
    centralChunks.push(centralHeader);
    offset += localHeader.length + fileBytes.length;
  }

  const centralDirectory = concatBytes(...centralChunks);
  const endOfCentralDirectory = concatBytes(
    createZipBytePart(0x06054b50, 4),
    createZipBytePart(0, 2),
    createZipBytePart(0, 2),
    createZipBytePart(files.length, 2),
    createZipBytePart(files.length, 2),
    createZipBytePart(centralDirectory.length, 4),
    createZipBytePart(offset, 4),
    createZipBytePart(0, 2),
  );

  return new Blob(
    [...localChunks, centralDirectory, endOfCentralDirectory] as BlobPart[],
    {
      type: "application/zip",
    },
  );
}
