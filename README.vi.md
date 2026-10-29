<p align="center">
  <img src="assets/logo.svg" width="128" alt="GitHistory logo">
</p>

<h1 align="center">GitHistory</h1>

<p align="center">
  Ứng dụng Git miễn phí, mã nguồn mở: graph commit đẹp mắt, diff song song và công cụ giải conflict 3 cột.<br>
  Bản desktop cho <b>macOS</b>, <b>Windows</b> và <b>Ubuntu</b> — cùng plugin cho <a href="https://paseo.sh">Paseo</a> dùng được trên máy tính, web và điện thoại.
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="https://github.com/ltd412/GitHistory/releases/latest"><b>Tải về</b></a> ·
  <a href="#cài-đặt">Cài đặt</a> ·
  <a href="#plugin-paseo">Plugin Paseo</a> ·
  <a href="#build-từ-mã-nguồn">Build từ mã nguồn</a>
</p>

![GitHistory — graph commit, branch và working tree](docs/screenshots/graph-dark.png)

## Vì sao chọn GitHistory

- **Nhìn thấy lịch sử.** Graph kiểu GitKraken: mỗi nhánh một làn màu, merge cong về nhánh cha, nhãn branch/tag gắn
  đúng commit, avatar tác giả, stash và thay đổi chưa commit hiện ngay trên graph.
- **Làm mọi thứ từ graph.** Chuột phải vào commit hay nhãn là ra cùng một menu: checkout, merge (chọn kiểu merge),
  rebase (cảnh báo khi sẽ viết lại commit đã push), cherry-pick, revert, reset, tag, so sánh, và sửa nhanh lịch sử
  (reword, squash, fixup, đổi thứ tự, drop).
- **Xem thay đổi cho kỹ.** Diff song song cả file kiểu PyCharm với tô sáng từng từ, gấp các dòng không đổi, nút ▲/▼
  nhảy giữa các thay đổi — hoặc xem theo hunk. Stage, unstage, huỷ theo file, hunk hay từng dòng.
- **Giải conflict bình tĩnh.** Công cụ 3 cột — Yours | Result | Theirs — `»` / `«` lấy một bên, `×` bỏ qua, kết quả
  vẫn sửa được, đi lần lượt qua từng file conflict. Abort luôn cách một cú bấm.
- **Undo gần như mọi thứ.** Commit, merge, rebase, reset, xoá branch và sửa lịch sử đều undo/redo được.
- **Dùng đúng Git của bạn.** GitHistory chạy `git` có sẵn trên máy — config, hook, credential và khoá ký hoạt động
  y như trên dòng lệnh.

| Diff song song | Công cụ giải conflict 3 cột |
|---|---|
| ![Diff song song với tô sáng từng từ](docs/screenshots/diff-dark.png) | ![Giải conflict 3 cột](docs/screenshots/merge-tool-dark.png) |

Giao diện sáng, hoặc tự đổi theo giờ trong ngày:

![Giao diện sáng](docs/screenshots/graph-light.png)

## Tính năng

| Mảng | Có gì |
|---|---|
| Graph | Làn màu với merge bo tròn, cuộn ngang cho lịch sử rộng, chế độ gọn, thẻ hover hiện đủ message, tìm theo message/tác giả/SHA, ⌘/Ctrl-click hai commit để so sánh |
| Branch & ref | Branch local dạng thư mục, remote, tag, stash, submodule; checkout, tạo, đổi tên, xoá, đặt upstream, fast-forward; kéo branch này thả lên branch kia để merge hoặc rebase |
| Working tree | Danh sách staged / unstaged / conflict (dạng đường dẫn hoặc cây), stage theo dòng, huỷ, ignore, commit, amend, push sau khi commit |
| So sánh | Hai commit/branch/tag bất kỳ, hoặc bất cứ thứ gì với working tree; theo từng file: so sánh với branch hay revision khác |
| File | Blame, lịch sử file, xem file ở mọi revision, khôi phục phiên bản, diff ảnh |
| Remote | Fetch, pull (merge / rebase / ff-only), push với force-with-lease khi bị từ chối, thêm/sửa/xoá remote |
| Lịch sử | Interactive rebase, reword/squash/fixup/move/drop nhanh, undo merge, undo/redo |
| Không gian làm việc | Nhiều repo dạng tab, quản lý repo, mở nhanh, lệnh tuỳ chỉnh, giao diện tối/sáng/tự động |

## Cài đặt

Tải file đúng hệ điều hành ở **[bản phát hành mới nhất](https://github.com/ltd412/GitHistory/releases/latest)**.
Máy cần có Git (`git --version` trong terminal).

| Hệ điều hành | File | Ghi chú |
|---|---|---|
| macOS (Apple Silicon) | `GitHistory-<phiên bản>-mac-arm64.dmg` | Mở `.dmg`, kéo **GitHistory** vào Applications |
| macOS (Intel) | `GitHistory-<phiên bản>-mac-x64.dmg` | Như trên |
| Windows 10/11 | `GitHistory-<phiên bản>-win-x64-setup.exe` | Bộ cài; hoặc bản portable `…-win-x64.zip` |
| Ubuntu / Debian | `GitHistory-<phiên bản>-linux-amd64.deb` | `sudo apt install ./GitHistory-<phiên bản>-linux-amd64.deb` |
| Linux bất kỳ | `GitHistory-<phiên bản>-linux-x86_64.AppImage` | `chmod +x` rồi chạy |

**Lưu ý cho Linux**

- File `.deb` tự cài icon ứng dụng và sandbox của Chromium (từ bản 0.1.2, đã thử trên Ubuntu 24.04). Nếu `apt` báo lỗi
  nguồn (sources), cài thẳng bằng: `sudo dpkg -i GitHistory-<phiên bản>-linux-amd64.deb`.
- AppImage không cần cài; nó chạy không sandbox vì AppImage không thể setuid.
- Lỗi "System limit for number of file watchers reached" nghĩa là `fs.inotify.max_user_watches` đã cạn (IDE và terminal
  dùng rất nhiều). Từ 0.1.2 app chuyển sang polling thay vì crash; muốn nâng giới hạn:
  `echo fs.inotify.max_user_watches=524288 | sudo tee /etc/sysctl.d/60-inotify.conf && sudo sysctl --system`.
- Gõ tiếng Việt trên Ubuntu: [hướng dẫn](https://ltd412.github.io/go-tieng-viet-ubuntu/).

**Các bản build chưa được ký số**, nên lần mở đầu tiên hệ điều hành sẽ hỏi xác nhận:

- **macOS** — chuột phải GitHistory trong Applications → **Open** → **Open**. Nếu vẫn bị chặn, chạy một lần
  `xattr -dr com.apple.quarantine /Applications/GitHistory.app`.
- **Windows** — ở màn hình SmartScreen bấm **More info** → **Run anyway**.

## Plugin Paseo

GitHistory cũng chạy bên trong [Paseo](https://paseo.sh) dưới dạng plugin: mục **Git** trên sidebar của Paseo mở một
màn hình với nhiều project dạng tab — cùng graph, diff, công cụ giải conflict và thao tác, trên máy tính, web và
điện thoại.

| Trong Paseo | Trên điện thoại |
|---|---|
| ![GitHistory trong Paseo](docs/screenshots/paseo-plugin.png) | ![GitHistory trong Paseo trên điện thoại](docs/screenshots/paseo-phone.png) |

Cài trên máy chạy daemon Paseo (Paseo ≥ 0.12):

```bash
paseo plugin install https://github.com/ltd412/GitHistory.git:plugins/paseo
paseo plugin ls            # githistory  running
```

Với daemon ở máy khác, thêm `--host <host:port | pairing URL>` (và `PASEO_PASSWORD` nếu có mật khẩu). Cập nhật bằng
`paseo plugin update githistory --yes`. Mở project bằng **＋**: một workspace Paseo hoặc thư mục bất kỳ trên máy của
daemon. Chi tiết: [plugins/paseo/README.md](plugins/paseo/README.md).

> **Bảo mật:** plugin chỉ chạy `git` trên máy daemon; đường dẫn file bị giới hạn trong repo đang mở. Nhưng ai đăng nhập
> được daemon đều duyệt được thư mục và chạy git trong mọi repo mà user của daemon truy cập được — hãy đặt mật khẩu cho
> daemon và chỉ dùng trong mạng tin cậy.

## Build từ mã nguồn

Cần Node.js 22+ và Git.

```bash
git clone https://github.com/ltd412/GitHistory.git
cd GitHistory
npm install
npm run dev        # chạy app với hot reload
npm test           # test đơn vị + tích hợp (repo git thật)
npm run dist       # tạo bộ cài cho hệ điều hành hiện tại vào out/
```

Cấu trúc thư mục:

```
core/            logic không phụ thuộc UI, dùng chung cho app và plugin (layout và vẽ graph, diff, merge, menu, action)
core-node/       chỉ chạy trên Node: dịch vụ git, lịch sử undo, watcher theo dõi thay đổi
src/             giao diện desktop (React + Vite)
electron/        tiến trình main và preload của Electron
plugins/paseo/   plugin Paseo (client React Native + server plugin)
scripts/         script hỗ trợ build; demo-repo.sh dựng repo dùng cho ảnh chụp màn hình
```

Bản phát hành do GitHub Actions (`.github/workflows/release.yml`) build cho cả ba hệ điều hành mỗi khi push tag `v*`.

## Giấy phép

[MIT](LICENSE) © 2026 ltd412
