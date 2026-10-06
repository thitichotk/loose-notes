// Loose-Notes: reads .goodnotes files (zip archives) in the browser with JSZip and offers
// the audio, PDFs and images inside. Nothing leaves the page.
import { kindOf } from "./detect.js";

const MIN_SIZE = 10 * 1024; // smaller attachments are GoodNotes' own page templates and icons
const LABEL = { audio: "Audio", pdf: "PDF", image: "Image" };
const ICON = { audio: "audio-lines", pdf: "file-text", image: "image" };
const NOT_GOODNOTES = "This isn't a GoodNotes file. Export the notebook from GoodNotes as .goodnotes and try again.";

const $ = (id) => document.getElementById(id);
const drop = $("drop"), input = $("file"), results = $("results"), list = $("books");
const preview = $("preview");

// Each notebook: { id, name, key, state: "reading" | "done" | "failed", done, total, files, error }
let books = [];
let nextId = 0;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const icon = (id) => `<svg class="icon" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const fmtSize = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);
const fmtTime = (s) => (s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);
const safeName = (s) => s.replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_").trim() || "notebook"; // keeps Thai
const stem = (name) => name.replace(/\.goodnotes$/i, "");

function summary(files) {
  const count = (t) => files.filter((f) => f.kind.type === t).length;
  const parts = [];
  if (count("audio")) parts.push(`${count("audio")} audio`);
  if (count("pdf")) parts.push(plural(count("pdf"), "PDF"));
  if (count("image")) parts.push(plural(count("image"), "image"));
  return parts.join(" · ");
}

// ---------- Reading ----------

async function addFiles(fileList) {
  for (const file of fileList) {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (books.some((b) => b.key === key)) continue; // same file dropped twice
    const book = { id: nextId++, name: file.name, key, state: "reading", done: 0, total: 0, files: [] };
    books.push(book);
    render();
    try {
      if (!/\.goodnotes$/i.test(file.name)) throw new Error(NOT_GOODNOTES);
      book.files = await readNotebook(file, (done, total) => {
        Object.assign(book, { done, total });
        updateProgress(book);
      });
      book.state = "done";
    } catch (error) {
      book.state = "failed";
      book.error = error.message === NOT_GOODNOTES ? NOT_GOODNOTES : `${NOT_GOODNOTES} (${error.message})`;
    }
    render();
  }
}

async function readNotebook(file, onProgress) {
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error(NOT_GOODNOTES);
  }
  const entries = Object.values(zip.files).filter((e) => !e.dir && e.name.toLowerCase().includes("attachments/"));
  const found = [];
  for (const [i, entry] of entries.entries()) {
    try {
      const raw = await entry.async("blob");
      if (raw.size >= MIN_SIZE) {
        const kind = kindOf(new Uint8Array(await raw.slice(0, 16).arrayBuffer()));
        if (kind) found.push({ kind, blob: new Blob([raw], { type: kind.mime }), date: entry.date });
      }
    } catch (error) {
      console.warn(`Skipped an unreadable attachment in ${file.name}:`, error); // one bad entry shouldn't sink the notebook
    }
    onProgress(i + 1, entries.length);
  }

  // Oldest first, numbered per type: "Audio 01.m4a", "PDF 01.pdf", "Image 03.jpg".
  found.sort((a, b) => a.date - b.date);
  const seen = {};
  const files = found.map((f) => {
    seen[f.kind.type] = (seen[f.kind.type] || 0) + 1;
    const name = `${LABEL[f.kind.type]} ${String(seen[f.kind.type]).padStart(2, "0")}.${f.kind.ext}`;
    return { ...f, name, url: URL.createObjectURL(f.blob), meta: "" };
  });
  await Promise.all(files.map(addMeta));
  return files;
}

// Recording length and photo size, read from the media itself. Gives up quietly after 3 s.
function addMeta(f) {
  return new Promise((resolve) => {
    const done = (meta) => { f.meta = meta || ""; resolve(); };
    setTimeout(done, 3000);
    if (f.kind.type === "audio") {
      const a = new Audio();
      a.preload = "metadata";
      a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? fmtTime(a.duration) : "");
      a.onerror = () => done();
      a.src = f.url;
    } else if (f.kind.type === "image") {
      const img = new Image();
      img.onload = () => done(`${img.naturalWidth} × ${img.naturalHeight}`);
      img.onerror = () => done();
      img.src = f.url;
    } else {
      done();
    }
  });
}

// ---------- Rendering ----------

function render() {
  results.hidden = books.length === 0;
  $("reset").hidden = books.length === 0;
  const ready = books.filter((b) => b.state === "done");
  const total = ready.reduce((n, b) => n + b.files.length, 0);
  $("results-title").textContent = plural(books.length, "notebook");
  const all = $("download-all");
  all.hidden = total === 0;
  all.innerHTML = `${icon("download")}Download all · ${plural(total, "file")}`;
  list.innerHTML = books.map(bookHTML).join("");
}

function bookHTML(book) {
  const name = `<h3 title="${esc(book.name)}">${esc(book.name)}</h3>`;
  if (book.state === "reading") {
    return `<section class="book" data-book="${book.id}">
      <header><span class="cover reading">${icon("loader")}</span><div class="grow">${name}<p>Reading the notebook</p></div></header>
      <div class="reading"><div class="progress"><i></i></div><span class="help num"></span></div></section>`;
  }
  if (book.state === "failed") {
    return `<section class="book" data-book="${book.id}">
      <header><span class="cover failed">${icon("circle-alert")}</span><div class="grow">${name}<p>Couldn't read this file</p></div></header>
      <p class="error" role="alert">${esc(book.error)}</p></section>`;
  }
  if (book.files.length === 0) {
    return `<section class="book" data-book="${book.id}">
      <header><span class="cover">${icon("notebook")}</span><div class="grow">${name}<p>No audio, PDFs or images in this notebook.</p></div></header></section>`;
  }
  return `<section class="book" data-book="${book.id}">
    <header><span class="cover">${icon("notebook")}</span><div class="grow">${name}<p>${summary(book.files)}</p></div>
      <button class="btn btn-secondary btn-sm" type="button" data-zip="${book.id}">${icon("download")}Download all</button></header>
    ${book.files.map((f, i) => fileHTML(book, f, i)).join("")}</section>`;
}

function fileHTML(book, f, i) {
  const ref = `data-book="${book.id}" data-file="${i}"`;
  const thumb = f.kind.type === "image" && f.kind.ext !== "heic" ? `<img src="${f.url}" alt="">` : icon(ICON[f.kind.type]);
  return `<div class="file">
    <span class="kind">${thumb}</span>
    <div><button class="name" type="button" data-open ${ref} title="${f.kind.type === "pdf" ? "Open" : "Preview"} ${esc(f.name)}">${esc(f.name)}</button>
      <div class="sub"><span class="type">${icon(ICON[f.kind.type])}${LABEL[f.kind.type]}</span>${esc(f.meta)}</div></div>
    <span class="size">${fmtSize(f.blob.size)}</span>
    <button class="icon-btn" type="button" data-save ${ref} aria-label="Download ${esc(f.name)}">${icon("download")}</button>
  </div>`;
}

// Updating only the bar keeps a long read from rebuilding the whole list on every attachment.
function updateProgress(book) {
  const el = list.querySelector(`[data-book="${book.id}"]`);
  if (!el || !book.total) return;
  const pct = Math.round((book.done / book.total) * 100);
  el.querySelector(".progress i").style.width = `${pct}%`;
  el.querySelector(".reading .help").textContent = `${pct}% · ${book.done} of ${book.total} files`;
}

// ---------- Saving ----------

function save(blob, filename) {
  const a = document.createElement("a");
  a.href = blob instanceof Blob ? URL.createObjectURL(blob) : blob;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  if (blob instanceof Blob) setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

const downloadName = (book, f) => `${safeName(stem(book.name))} - ${f.name}`;

// One zip instead of a burst of downloads, which browsers block. Files are stored, not
// recompressed: audio, PDFs and photos are already compressed.
async function saveZip(targets, button) {
  const label = button.innerHTML;
  button.disabled = true;
  button.textContent = "Packing…";
  try {
    const zip = new JSZip();
    for (const book of targets) {
      const folder = targets.length > 1 ? zip.folder(safeName(stem(book.name))) : zip;
      book.files.forEach((f) => folder.file(f.name, f.blob));
    }
    const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
    save(blob, targets.length > 1 ? "Loose-Notes.zip" : `${safeName(stem(targets[0].name))}.zip`);
  } finally {
    button.disabled = false;
    button.innerHTML = label;
  }
}

// ---------- Preview ----------

let previewing = null;

function openPreview(book, f) {
  if (f.kind.type === "pdf") return window.open(f.url, "_blank", "noopener");
  previewing = { book, f };
  $("preview-body").innerHTML =
    f.kind.type === "image" ? `<img src="${f.url}" alt="${esc(f.name)}">` : `<audio controls autoplay src="${f.url}"></audio>`;
  $("preview-name").textContent = f.name;
  $("preview-size").textContent = [fmtSize(f.blob.size), f.meta].filter(Boolean).join(" · ");
  preview.showModal();
}

preview.addEventListener("close", () => { $("preview-body").innerHTML = ""; previewing = null; });
preview.addEventListener("click", (e) => { if (e.target === preview) preview.close(); }); // backdrop
$("preview-close").addEventListener("click", () => preview.close());
$("preview-download").addEventListener("click", () => previewing && save(previewing.f.url, downloadName(previewing.book, previewing.f)));

// ---------- Wiring ----------

list.addEventListener("click", (e) => {
  const target = e.target.closest("[data-save], [data-open], [data-zip]");
  if (!target) return;
  if (target.dataset.zip !== undefined) {
    return saveZip(books.filter((b) => b.id === Number(target.dataset.zip)), target);
  }
  const book = books.find((b) => b.id === Number(target.dataset.book));
  const f = book?.files[Number(target.dataset.file)];
  if (!f) return;
  if (target.dataset.save !== undefined) save(f.url, downloadName(book, f));
  else openPreview(book, f);
});

$("download-all").addEventListener("click", (e) =>
  saveZip(books.filter((b) => b.state === "done" && b.files.length), e.currentTarget));

$("reset").addEventListener("click", () => {
  books.forEach((b) => b.files.forEach((f) => URL.revokeObjectURL(f.url)));
  books = [];
  input.value = "";
  render();
});

input.addEventListener("change", () => {
  addFiles([...input.files]);
  input.value = ""; // so choosing the same file again still fires
});

drop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
});
["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => addFiles([...e.dataTransfer.files]));
