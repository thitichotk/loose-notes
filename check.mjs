// Run with `node check.mjs`: the signature table is the part that silently breaks.
import assert from "node:assert/strict";
import { kindOf } from "./detect.js";

const bytes = (...parts) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

assert.equal(kindOf(bytes([0, 0, 0, 0x20], "ftypM4A ")).ext, "m4a"); // GoodNotes recordings
assert.equal(kindOf(bytes([0, 0, 0, 0x18], "ftypheic")).type, "image"); // iPhone photos
assert.equal(kindOf(bytes("%PDF-1.7")).ext, "pdf");
assert.equal(kindOf(bytes([0x89], "PNG\r\n")).ext, "png");
assert.equal(kindOf(bytes([0xff, 0xd8, 0xff, 0xe0])).ext, "jpg");
assert.equal(kindOf(bytes("RIFF", [1, 2, 3, 4], "WEBP")).ext, "webp");
assert.equal(kindOf(bytes("ID3", [4, 0])).ext, "mp3");
assert.equal(kindOf(bytes("PK", [3, 4])), null); // not something to offer
assert.equal(kindOf(bytes("bplist00")), null); // GoodNotes' own metadata

console.log("detect.js: ok");
