#!/usr/bin/env node
/**
 * Tìm tất cả SpriteFrame (image meta có type "sprite-frame") trong một thư mục
 * và bật Texture Compress với preset chỉ định.
 *
 * Usage:
 *   node extensions/texture-compress-batch/scripts/set-texture-compress.js <folder> [options]
 *
 * Options:
 *   --preset <name|id>   Preset trong settings/v2/packages/builder.json (mặc định: preset đầu tiên)
 *   --atlas              Áp dụng thêm cho auto-atlas (*.pac.meta)
 *   --off                Tắt compress (xoá compressSettings) thay vì bật
 *   --force              Ghi đè kể cả khi đã bật với preset khác
 *   --dry-run            Chỉ liệt kê, không ghi file
 *   --list-presets       In danh sách preset rồi thoát
 *
 * Ví dụ:
 *   node extensions/texture-compress-batch/scripts/set-texture-compress.js assets/3.Sprites --preset SingleHTML
 *   node extensions/texture-compress-batch/scripts/set-texture-compress.js assets/3.Sprites/BG --preset BG --atlas
 *   node extensions/texture-compress-batch/scripts/set-texture-compress.js assets/3.Sprites --off
 *
 * Sau khi chạy: quay lại Cocos Creator, Assets panel -> chuột phải -> Refresh (hoặc Ctrl+R)
 * để editor re-import meta.
 */
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const BUILDER_JSON = path.join(PROJECT_ROOT, 'settings/v2/packages/builder.json');
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tga', '.psd']);

// ---------- args ----------
const args = process.argv.slice(2);
const opts = { folder: null, preset: null, atlas: false, off: false, force: false, dryRun: false, listPresets: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  switch (a) {
    case '--preset': opts.preset = args[++i]; break;
    case '--atlas': opts.atlas = true; break;
    case '--off': opts.off = true; break;
    case '--force': opts.force = true; break;
    case '--dry-run': opts.dryRun = true; break;
    case '--list-presets': opts.listPresets = true; break;
    case '-h': case '--help': printHelp(); process.exit(0);
    default:
      if (a.startsWith('-')) { console.error(`Unknown option: ${a}`); printHelp(); process.exit(1); }
      opts.folder = a;
  }
}

function printHelp() {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 24).map(l => l.replace(/^ \*\/?/, '')).join('\n'));
}

// ---------- presets ----------
function loadPresets() {
  if (!fs.existsSync(BUILDER_JSON)) return {};
  const json = JSON.parse(fs.readFileSync(BUILDER_JSON, 'utf8'));
  return (json.textureCompressConfig && json.textureCompressConfig.userPreset) || {};
}

function describePreset(id, p) {
  const fmts = [];
  for (const [platform, formats] of Object.entries(p.options || {})) {
    for (const [fmt, cfg] of Object.entries(formats)) fmts.push(`${platform}:${fmt}@${cfg.quality}`);
  }
  return `${p.name}  (id: ${id})  [${fmts.join(', ')}]`;
}

const presets = loadPresets();
if (opts.listPresets) {
  console.log('Presets trong builder.json:');
  for (const [id, p] of Object.entries(presets)) console.log('  ' + describePreset(id, p));
  process.exit(0);
}

if (!opts.folder) { printHelp(); process.exit(1); }
const folder = path.resolve(PROJECT_ROOT, opts.folder);
if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
  console.error(`Folder không tồn tại: ${folder}`);
  process.exit(1);
}

let presetId = null;
if (!opts.off) {
  const entries = Object.entries(presets);
  if (entries.length === 0) { console.error('Không có preset nào trong builder.json. Tạo preset trong Project Settings -> Texture Compress trước.'); process.exit(1); }
  if (opts.preset) {
    const hit = entries.find(([id, p]) => id === opts.preset || p.name === opts.preset);
    if (!hit) {
      console.error(`Không tìm thấy preset "${opts.preset}". Có sẵn:`);
      for (const [id, p] of entries) console.error('  ' + describePreset(id, p));
      process.exit(1);
    }
    presetId = hit[0];
  } else {
    presetId = entries[0][0];
  }
  console.log(`Preset: ${describePreset(presetId, presets[presetId])}`);
}

// ---------- scan ----------
function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (ent.name.endsWith('.meta')) out.push(full);
  }
  return out;
}

function isSpriteFrameMeta(metaPath, json) {
  const assetExt = path.extname(metaPath.slice(0, -'.meta'.length)).toLowerCase();
  return json.importer === 'image' && IMAGE_EXTS.has(assetExt)
    && json.userData && json.userData.type === 'sprite-frame';
}
function isAutoAtlasMeta(json) { return json.importer === 'auto-atlas'; }

const stats = { updated: 0, skipped: 0, ignored: 0, errors: 0 };
const rel = p => path.relative(PROJECT_ROOT, p).split(path.sep).join('/');

for (const metaPath of walk(folder)) {
  let raw, json;
  try {
    raw = fs.readFileSync(metaPath, 'utf8');
    json = JSON.parse(raw);
  } catch (e) {
    stats.errors++; console.error(`[ERR ] ${rel(metaPath)}: ${e.message}`); continue;
  }

  const target = isSpriteFrameMeta(metaPath, json) || (opts.atlas && isAutoAtlasMeta(json));
  if (!target) { stats.ignored++; continue; }

  json.userData = json.userData || {};
  const cur = json.userData.compressSettings;

  if (opts.off) {
    if (!cur) { stats.skipped++; continue; }
    delete json.userData.compressSettings;
  } else {
    if (cur && cur.useCompressTexture && cur.presetId === presetId) { stats.skipped++; continue; }
    if (cur && cur.useCompressTexture && cur.presetId !== presetId && !opts.force) {
      stats.skipped++;
      console.log(`[SKIP] ${rel(metaPath)} đang dùng preset khác (${cur.presetId}) — dùng --force để ghi đè`);
      continue;
    }
    json.userData.compressSettings = { useCompressTexture: true, presetId };
  }

  stats.updated++;
  console.log(`[${opts.dryRun ? 'DRY ' : 'OK  '}] ${rel(metaPath)}`);
  if (!opts.dryRun) {
    // Giữ format 2 space, line ending (CRLF/LF) và newline cuối như file gốc
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const trailing = /\r?\n$/.test(raw) ? eol : '';
    fs.writeFileSync(metaPath, JSON.stringify(json, null, 2).replace(/\n/g, eol) + trailing, 'utf8');
  }
}

console.log(`\nDone. updated=${stats.updated} skipped=${stats.skipped} ignored=${stats.ignored} errors=${stats.errors}${opts.dryRun ? '  (dry-run, chưa ghi file)' : ''}`);
if (!opts.dryRun && stats.updated > 0) {
  console.log('-> Mở Cocos Creator, Assets panel: chuột phải -> Refresh (Ctrl+R) để re-import.');
}
