# Audio Converter

Chuyển đổi định dạng file âm thanh ngay trong Cocos Creator: **mp3 ↔ ogg ↔ wav ↔ m4a ↔ flac ↔ opus**.
Chạy hàng loạt, kèm resample, gộp mono, chuẩn hoá âm lượng và cắt khoảng lặng.

Mở bằng menu **Tool → Audio Converter**.

## Cần gì

`ffmpeg` (và `ffprobe` nếu muốn xem thông tin file). Extension tự tìm theo thứ tự:

1. `extensions/audio-converter/tools/ffmpeg/`
2. `extensions/playable-size-inspector/tools/ffmpeg/` ← project này đã có sẵn
3. `extensions/image-resizer/tools/ffmpeg/`
4. `PATH` của hệ thống

Không cần cài thêm gì.

## Dùng

1. **Files** — kéo file/thư mục từ panel Assets thả vào, hoặc *Add selected in Assets*, hoặc *Browse files...*.
   Thả cả thư mục thì tool tự quét đệ quy mọi file âm thanh bên trong.
2. **Output format** — chọn định dạng đích. Với mp3/ogg có thêm chế độ VBR (nhỏ hơn CBR ở cùng chất lượng).
3. **Audio settings** — sample rate, số kênh, normalize, trim silence. Để "Giữ nguyên" nếu không cần.
4. **Output** — ghi cạnh file gốc / thêm hậu tố / vào thư mục khác.
5. Bấm **Preview** để xem trước sẽ tạo ra file nào, file nào bị bỏ qua. Bấm **Convert** để chạy thật.

## ⚠️ Đổi định dạng làm mất tham chiếu AudioClip

Cocos gắn uuid theo **đường dẫn file**. Đổi `.ogg` thành `.mp3` nghĩa là một asset **mới** với uuid **mới**.
Mọi chỗ đang gán AudioClip cũ trong scene/prefab sẽ thành `null` và phải gán lại tay.

- Muốn **giữ nguyên tham chiếu** → đừng đổi định dạng. Bật *Re-encode same format* để hạ bitrate / sample rate
  của chính định dạng đó (mp3 → mp3). Lúc này đường dẫn không đổi nên uuid giữ nguyên.
- Muốn **đổi định dạng** → chấp nhận gán lại, hoặc đổi trước khi bắt đầu gắn vào scene.

## Các lựa chọn đáng lưu ý

| Tuỳ chọn | Ý nghĩa |
|---|---|
| **Delete source** | Xoá file gốc + `.meta` sau khi convert. Mặc định TẮT. |
| **Overwrite existing** | Cho phép ghi đè nếu file đích đã tồn tại. Mặc định TẮT (những file đó bị bỏ qua). |
| **Re-encode same format** | Cho phép mp3 → mp3. Mặc định TẮT nên file đã đúng định dạng sẽ bị bỏ qua. |
| **Backup** | Chép file gốc + `.meta` vào `temp/audio-converter-backup/<timestamp>/` trước khi chạy. Mặc định BẬT. |
| **Refresh asset-db** | Gọi refresh các thư mục bị đụng để asset mới hiện ra ngay. Mặc định BẬT. |

## Gợi ý cho playable ad

- **SFX ngắn**: mp3 VBR q5–q7, 22050 Hz, mono — thường giảm 60–70% dung lượng mà tai gần như không phân biệt được.
- **BGM**: mp3 96–128 kbps stereo, hoặc ogg VBR q3.
- **Trim silence** cho SFX cần phát tức thì; khoảng lặng đầu file gây cảm giác trễ.
- Đừng dùng wav/flac trong bản build playable — chúng lớn gấp nhiều lần.

## Cấu trúc

```
audio-converter/
  main.js                    # entry của editor: asset-db, thu thập input, vòng lặp convert
  src/core/audio.js          # tìm ffmpeg, probe, convert (không phụ thuộc Editor API)
  src/core/fsx.js            # mkdirp / rmrf
  src/panels/default.js      # UI panel
  static/template|style/     # html + css
```

`src/core/audio.js` không import gì từ `Editor` nên có thể gọi trực tiếp từ Node để viết script batch riêng.
