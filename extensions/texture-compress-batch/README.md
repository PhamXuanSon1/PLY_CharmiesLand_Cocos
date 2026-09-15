# Texture Compress Batch

Tìm tất cả **SpriteFrame** (và tuỳ chọn **auto-atlas**) trong một thư mục và bật / tắt
**Texture Compress** hàng loạt với preset đã tạo trong *Project Settings → Texture Compress*.

Mở bằng menu **Tool → Texture Compress Batch**, hoặc chuột phải thư mục trong panel Assets → **Texture Compress → Enable: <preset>**.

## Panel

1. **Folder** – kéo thư mục từ Assets thả vào, bấm *Use selected*, hoặc *Browse...*
2. **Preset** – danh sách đọc từ `settings/v2/packages/builder.json`. Bấm ↻ nếu vừa tạo preset mới.
3. **Options**
   - *Include auto-atlas* – áp dụng thêm cho `*.pac`
   - *Override other preset* – ghi đè cả những asset đang dùng preset khác (mặc định bỏ qua)
4. **Scan (dry run)** xem trước, **Apply** để ghi.

Meta được ghi bằng `asset-db.save-asset-meta` nên editor tự re-import; nếu editor không hỗ trợ
message này thì extension ghi file `.meta` trực tiếp (giữ CRLF/indent) rồi `refresh-asset`.

## Assets context menu

Chuột phải thư mục → **Texture Compress** → chọn preset hoặc *Disable*. Áp dụng ngay cho toàn bộ
SpriteFrame + auto-atlas bên dưới, ghi đè preset cũ.

## Chỉ sửa gì trong meta

```json
"userData": {
  "type": "sprite-frame",
  "compressSettings": { "useCompressTexture": true, "presetId": "<preset id>" }
}
```

*Disable* xoá key `compressSettings`. Không đụng tới gì khác.
