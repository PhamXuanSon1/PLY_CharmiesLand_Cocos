#!/usr/bin/env python3
"""
psd2map.py - xuat map tu file PSD sang PNG + JSON cho SceneBuilder (Cocos Creator).

Cach dung:
    python tools/psd2map.py assets/3.Sprites/psd_/daiduong.psd
    python tools/psd2map.py file.psd --artboard "Artboard 1" --out assets/3.Sprites/daiduong
    python tools/psd2map.py file.psd --skip "^Curves|^Hue" --hidden
    python tools/psd2map.py file.psd --names assets/3.Sprites/daiduong/daiduong.names.json

    --names: JSON { "<path layer>" | "<key png>": "<ten node>" } -> ghi vao truong "name"
             cua tung node, SceneBuilder se dat ten node theo do (layer PSD ten so 1,2,3...).
             Mac dinh tu tim <out>/<psd_name>.names.json neu co.
    LUU Y: --skip "^Curves|^Hue" se bo qua ca layer ANH ma hoa si dat ten "Curves 1"/"Hue..." (vd BG).

Ket qua:
    <out>/sprites/<layer>.png   - tung layer da crop theo bbox
    <out>/<psd_name>.json       - schema SceneJson (xem SceneBuilder.ts)

Trong Cocos: gan SceneBuilder vao 1 node duoi Canvas, keo file JSON vao
"sceneJson", keo folder <out>/sprites vao "spriteFolder", tick "Build Now".

Quy uoc:
    - Goc toa do = tam artboard, Y huong len (khop Cocos).
    - Group PSD -> Node rong o (0,0,0); layer anh -> Node co Sprite, pivot 0.5/0.5.
    - Layer duoi cung trong PSD -> sortingOrder nho (ve truoc).
    - K = ppu = 100 -> contentSize = kich thuoc pixel that.
    - Layer trung ten: pixel giong het thi dung chung 1 PNG, khac thi them hau to _2, _3...
"""
import argparse
import hashlib
import io
import json
import re
import sys
from pathlib import Path

from psd_tools import PSDImage

K = 100  # ppu; f = K/ppu = 1 -> đơn vị pixel


def safe_name(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|]+', '_', name.strip())
    return name or 'layer'


def find_artboard(psd: PSDImage, wanted: str | None):
    boards = [l for l in psd if l.kind == 'artboard']
    if not boards:
        return psd, (0, 0, psd.width, psd.height)  # PSD thường, không có artboard
    if wanted:
        for b in boards:
            if b.name == wanted:
                return b, b.bbox
        names = ', '.join(repr(b.name) for b in boards)
        sys.exit(f'Không thấy artboard {wanted!r}. Có: {names}')
    return boards[0], boards[0].bbox


class Exporter:
    def __init__(self, out: Path, ab_bbox, skip: re.Pattern | None, include_hidden: bool, verbose: bool):
        self.sprites_dir = out / 'sprites'
        self.sprites_dir.mkdir(parents=True, exist_ok=True)
        self.ab_x, self.ab_y, ab_r, ab_b = ab_bbox
        self.ab_w, self.ab_h = ab_r - self.ab_x, ab_b - self.ab_y
        self.skip = skip
        self.include_hidden = include_hidden
        self.verbose = verbose
        self.nodes: list[dict] = []
        self.order = 0
        self.hash_to_key: dict[str, str] = {}   # pixel hash -> tên file đã ghi
        self.used_keys: set[str] = set()
        self.used_paths: set[str] = set()

    # ---- node path duy nhất
    def unique_path(self, parent: str | None, name: str) -> str:
        base = f'{parent}/{name}' if parent else name
        p, i = base, 2
        while p in self.used_paths:
            p = f'{base}_{i}'
            i += 1
        self.used_paths.add(p)
        return p

    # ---- tên file duy nhất, dedupe theo pixel
    def sprite_key(self, name: str, png_bytes: bytes) -> str:
        h = hashlib.md5(png_bytes).hexdigest()
        if h in self.hash_to_key:
            return self.hash_to_key[h]
        key, i = name, 2
        while key in self.used_keys:
            key = f'{name}_{i}'
            i += 1
        self.used_keys.add(key)
        self.hash_to_key[h] = key
        (self.sprites_dir / f'{key}.png').write_bytes(png_bytes)
        return key

    def walk(self, group, parent_path: str | None):
        for layer in group:  # psd-tools: index 0 = dưới cùng
            if not layer.visible and not self.include_hidden:
                continue
            if self.skip and self.skip.search(layer.name):
                if self.verbose:
                    print(f'  skip  {layer.name}')
                continue
            name = safe_name(layer.name)
            path = self.unique_path(parent_path, name)

            if layer.is_group():
                self.nodes.append({
                    'path': path, 'parentPath': parent_path, 'active': True,
                    'pos': [0, 0, 0], 'rot': [0, 0, 0], 'scale': [1, 1, 1],
                })
                self.walk(layer, path)
                continue

            img = layer.composite()  # đã áp smart object / effects / mask
            if img is None or img.width == 0 or img.height == 0:
                if self.verbose:
                    print(f'  empty {layer.name}')
                continue
            img = img.convert('RGBA')
            alpha_box = img.getbbox()
            if not alpha_box:
                if self.verbose:
                    print(f'  blank {layer.name}')
                continue
            img = img.crop(alpha_box)
            l, t = layer.bbox[0] + alpha_box[0], layer.bbox[1] + alpha_box[1]
            w, h = img.size

            buf = io.BytesIO()
            img.save(buf, 'PNG', optimize=True)
            key = self.sprite_key(name, buf.getvalue())

            # tâm layer -> toạ độ Cocos (gốc giữa artboard, Y hướng lên)
            cx = l + w / 2 - self.ab_x - self.ab_w / 2
            cy = self.ab_y + self.ab_h / 2 - (t + h / 2)

            self.order += 1
            self.nodes.append({
                'path': path, 'parentPath': parent_path, 'active': bool(layer.visible),
                'pos': [round(cx, 2), round(cy, 2), 0], 'rot': [0, 0, 0], 'scale': [1, 1, 1],
                'sprite': {
                    'key': key, 'guid': '', 'ppu': K,
                    'nativeSize': [w, h], 'pivot': [0.5, 0.5],
                    'color': [1, 1, 1, round(layer.opacity / 255, 3)],
                    'sortingOrder': self.order * 10,
                    'flipX': False, 'flipY': False,
                },
            })
            if self.verbose:
                print(f'  {path:40s} -> {key}.png {w}x{h} @({cx:.0f},{cy:.0f})')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('psd')
    ap.add_argument('--artboard', help='Tên artboard cần xuất (mặc định: artboard đầu tiên)')
    ap.add_argument('--out', help='Thư mục xuất (mặc định: assets/3.Sprites/<tên psd>)')
    ap.add_argument('--skip', help='Regex tên layer cần bỏ qua, vd "^Curves|^Hue"')
    ap.add_argument('--hidden', action='store_true', help='Xuất cả layer đang ẩn')
    ap.add_argument('--names', help='JSON map tên node (mặc định: <out>/<tên psd>.names.json nếu có)')
    ap.add_argument('--list', action='store_true', help='Chi liet ke artboard roi thoat')
    ap.add_argument('-q', '--quiet', action='store_true')
    a = ap.parse_args()

    psd_path = Path(a.psd)
    out = Path(a.out) if a.out else Path('assets/3.Sprites') / psd_path.stem
    psd = PSDImage.open(psd_path)
    if a.list:
        boards = [l for l in psd if l.kind == 'artboard']
        print(f'PSD {psd_path.name} {psd.size}')
        if not boards:
            print('  (khong co artboard - xuat ca file)')
        for i, b in enumerate(boards, 1):
            print(f'  {i}. {b.name}  bbox={b.bbox}')
        return
    root, bbox = find_artboard(psd, a.artboard)
    ab_name = getattr(root, 'name', psd_path.stem)
    print(f'PSD {psd_path.name} {psd.size}  artboard {ab_name!r} bbox={bbox}  -> {out}')

    ex = Exporter(out, bbox, re.compile(a.skip) if a.skip else None, a.hidden, not a.quiet)
    ex.walk(root, None)

    names_path = Path(a.names) if a.names else out / f'{psd_path.stem}.names.json'
    if names_path.is_file():
        names = {k: v for k, v in json.loads(names_path.read_text(encoding='utf-8')).items()
                 if isinstance(v, str) and v.strip() and not k.startswith('_')}
        renamed = 0
        for n in ex.nodes:
            new = names.get(n['path']) or (names.get(n['sprite']['key']) if 'sprite' in n else None)
            if new:
                n['name'] = new.strip()
                renamed += 1
        print(f'Doi ten {renamed}/{len(ex.nodes)} node theo {names_path}')

    data = {
        'meta': {'K': K, 'scene': ab_name, 'exportRoot': None, 'exportInactive': a.hidden,
                 'source': psd_path.name, 'artboardSize': [ex.ab_w, ex.ab_h]},
        'assetMap': {},
        'nodes': ex.nodes,
        'conflicts': [],
    }
    out.mkdir(parents=True, exist_ok=True)
    json_path = out / f'{psd_path.stem}.json'
    json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    n_sprites = sum(1 for n in ex.nodes if 'sprite' in n)
    print(f'Xong: {len(ex.nodes)} node ({n_sprites} sprite, {len(ex.used_keys)} PNG) -> {json_path}')


if __name__ == '__main__':
    main()
