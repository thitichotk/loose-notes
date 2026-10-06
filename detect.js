// What kind of file an attachment is, from its first bytes.
// GoodNotes stores attachments without extensions, so the signature is all there is.

const HEIF_BRANDS = ["heic", "heix", "hevc", "mif1", "msf1"];

export function kindOf(bytes) {
  const ascii = (from, to) => String.fromCharCode(...bytes.slice(from, to));

  if (ascii(0, 12).includes("%PDF")) return { type: "pdf", ext: "pdf", mime: "application/pdf" };
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return { type: "image", ext: "png", mime: "image/png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: "image", ext: "jpg", mime: "image/jpeg" };
  if (ascii(0, 4) === "GIF8") return { type: "image", ext: "gif", mime: "image/gif" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { type: "image", ext: "webp", mime: "image/webp" };
  // ISO media: "ftyp" sits at byte 4. GoodNotes recordings are M4A; iPhone photos are HEIC.
  if (ascii(4, 8) === "ftyp") {
    return HEIF_BRANDS.includes(ascii(8, 12))
      ? { type: "image", ext: "heic", mime: "image/heic" }
      : { type: "audio", ext: "m4a", mime: "audio/mp4" };
  }
  if (ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    return { type: "audio", ext: "mp3", mime: "audio/mpeg" };
  }
  return null;
}
