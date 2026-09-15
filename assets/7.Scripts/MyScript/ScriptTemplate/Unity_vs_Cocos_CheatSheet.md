# 📘 Unity C# ➔ Cocos Creator TS Cheatsheet

Tài liệu so sánh trực quan dưới dạng bảng giúp lập trình viên từ **Unity (C#)** chuyển sang **Cocos Creator (TypeScript)** dễ tra cứu và ghi nhớ.

---

## 1. 🧬 Khái Niệm Cơ Bản (Core Concepts)

| Tính năng / Mục đích | Unity (C#) | Cocos Creator (TypeScript) | Ghi Chú / Chi Tiết |
| :--- | :--- | :--- | :--- |
| **Lớp thành phần** | `MonoBehaviour` | `Component` | Lớp cơ sở cho các script gắn vào Object/Node |
| **Đối tượng chứa** | `Transform` / `GameObject` | `Node` | Trong Cocos, `Node` quản lý trực tiếp vị trí, góc xoay, tỉ lệ và cha-con |
| **Bật / Tắt Object** | `gameObject.SetActive(true)` | `this.node.active = true` | Thuộc tính `active` nằm trực tiếp trên `Node` |
| **Tạo bản sao** | `Instantiate(prefab)` | `instantiate(this.prefab)` | Khởi tạo instance từ Prefab |
| **Hủy đối tượng** | `Destroy(gameObject)` | `node.destroy()` | Hủy node khỏi bộ nhớ |
| **Gán đối tượng cha** | `transform.SetParent(parent)` | `this.node.setParent(parent)` | Hoặc dùng `parent.addChild(childNode)` |
| **Lấy Component** | `GetComponent<T>()` | `this.getComponent(T)` | Tìm Component cùng gắn trên Node |
| **Lấy Component con** | `GetComponentInChildren<T>()` | `this.getComponentInChildren(T)` | Tìm Component trong các Node con |

---

## 2. ⏳ Vòng Đời Component (Lifecycle Callbacks)

| Giai Đoạn | Unity (C#) | Cocos Creator (TS) | Thời Điểm Thực Thi |
| :---: | :--- | :--- | :--- |
| **1** | `Awake()` | `onLoad()` | Gọi ngay khi Node được khởi tạo (chỉ gọi 1 lần trong đời) |
| **2** | `OnEnable()` | `onEnable()` | Gọi mỗi khi Node/Component được kích hoạt (`active = true`) |
| **3** | `Start()` | `start()` | Gọi trước frame `update` đầu tiên |
| **4** | `Update()` | `update(dt: number)` | Gọi mỗi frame. `dt` là DeltaTime (thời gian trôi qua, tính bằng giây) |
| **5** | `LateUpdate()` | `lateUpdate(dt: number)` | Gọi cuối mỗi frame (sau khi tất cả hàm `update` hoàn tất) |
| **6** | `OnDisable()` | `onDisable()` | Gọi mỗi khi Node/Component bị tắt (`active = false`) |
| **7** | `OnDestroy()` | `onDestroy()` | Gọi ngay trước khi Node/Component bị hủy hoàn toàn |

---

## 3. 🎯 Thao Tác Thường Dùng (Code Comparison)

| Thao tác | Unity (C#) | Cocos Creator (TypeScript) |
| :--- | :--- | :--- |
| **Set vị trí 3D** | `transform.position = new Vector3(x, y, z);` | `this.node.setPosition(x, y, z);`<br>*(hoặc `this.node.position = v3(x, y, z);`)* |
| **Lấy vị trí 3D** | `Vector3 pos = transform.position;` | `const pos = this.node.position;` |
| **Set góc quay (Euler)**| `transform.eulerAngles = new Vector3(x,y,z);`| `this.node.setRotationFromEuler(x, y, z);` |
| **Set Tỉ lệ (Scale)** | `transform.localScale = new Vector3(x,y,z);` | `this.node.setScale(x, y, z);` |
| **Tìm Node theo tên** | `GameObject.Find("Canvas/Bg")` | `find("Canvas/Bg")` *(import từ `'cc'`)* |
| **Thêm Component** | `gameObject.AddComponent<T>()` | `this.node.addComponent(T)` |
| **Biến gán Inspector** | `[SerializeField] private Sprite icon;` | `@property(Sprite)<br>icon: Sprite = null!;` |

---

## 4. 🧮 Toán Học & Cấu Trúc Dữ Liệu (Math & Data Types)

| Loại dữ liệu | Unity (C#) | Cocos Creator (TS) | Cú Pháp / Helper Trong Cocos |
| :--- | :--- | :--- | :--- |
| **Véctơ 3D** | `Vector3` | `Vec3` | `new Vec3(x, y, z)` hoặc hàm viết tắt `v3(x, y, z)` |
| **Véctơ 2D** | `Vector2` | `Vec2` | `new Vec2(x, y)` hoặc hàm viết tắt `v2(x, y)` |
| **Góc Quay** | `Quaternion` | `Quat` | `new Quat()` hoặc hàm viết tắt `quat()` |
| **Màu Sắc** | `Color` | `Color` | `new Color(255, 255, 255, 255)` hoặc `Color.RED` |
| **Ma Trận 4x4** | `Matrix4x4` | `Mat4` | `new Mat4()` hoặc `mat4()` |

---

## 5. ⏱ Coroutine vs Time & Async

| Nhu Cầu | Unity (C#) | Cocos Creator (TypeScript) |
| :--- | :--- | :--- |
| **Chờ X giây** | `yield return new WaitForSeconds(2);` | `this.scheduleOnce(() => { /* Code */ }, 2);`<br>*(Hoặc dùng `async/await` với Promise)* |
| **Lặp lại định kỳ** | `InvokeRepeating("DoSomething", 1f, 1f);` | `this.schedule(() => { /* Code */ }, 1);` |
| **Hủy đếm giờ** | `CancelInvoke()` / `StopCoroutine()` | `this.unscheduleAllCallbacks();` |
| **Hàm Async Native** | `async Task MyFunc()` | `async myFunc(): Promise<void>` |

---

## 6. 🔊 Âm Thanh & Sự Kiện (Audio & Events)

| Tính Năng | Unity (C#) | Cocos Creator (TypeScript) |
| :--- | :--- | :--- |
| **Component Âm thanh** | `AudioSource` | `AudioSource` |
| **Phát âm thanh** | `audioSource.Play();` | `this.audioSource.play();` |
| **Phát 1 lần (Effect)** | `audioSource.PlayOneShot(clip);` | `this.audioSource.playOneShot(clip);` |
| **Đăng ký sự kiện Click** | `button.onClick.AddListener(...)` | `this.node.on(Node.EventType.TOUCH_END, this.onClick, this);` |
| **Hủy đăng ký sự kiện** | `button.onClick.RemoveListener(...)` | `this.node.off(Node.EventType.TOUCH_END, this.onClick, this);` |

---

## 7. 💡 5 Mẹo Ghi Nhớ Nhanh Cho Newbie

| STT | Quy Tắc | Mô Tả |
| :---: | :--- | :--- |
| **1** | **`this.node`** | Mọi thao tác GameObject / Transform trong Unity đều thông qua `this.node` trong Cocos. |
| **2** | **Cú pháp camelCase** | Tên phương thức trong Cocos dùng chữ thường đầu từ: `start()`, `onLoad()`, `getComponent()`. |
| **3** | **Decorator `@property`** | Cần thêm `@property(...)` phía trên thuộc tính để hiện ra ngoài bảng Inspector. |
| **4** | **Helper Functions** | Dùng `v3()`, `v2()`, `quat()`, `color()` giúp viết code ngắn gọn hơn `new Vec3()`. |
| **5** | **`active` là thuộc tính** | Trong Unity là hàm `SetActive(bool)`, trong Cocos là gán biến: `node.active = true/false`. |
