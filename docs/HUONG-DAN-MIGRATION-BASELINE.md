# Hướng dẫn chuyển deploy: `db push` → `prisma migrate deploy`

## Vì sao đổi?

Trước đây container chạy `npx prisma db push --accept-data-loss` mỗi lần khởi
động. Hai vấn đề:

1. **`--accept-data-loss`**: nếu một thay đổi schema cần xoá cột/bảng, `db push`
   sẽ **âm thầm xoá dữ liệu** khi deploy — rất nguy hiểm cho prod.
2. **Migrations không phải nguồn chân lý**: schema thật chỉ tồn tại trong
   `schema.prisma`; các file trong `prisma/migrations` đã **drift** (thiếu cột
   `messages.zalo_msg_id_num`, `sent_via`, unique index dedup
   `messages_conversation_id_zalo_msg_id_key`…). Một môi trường dựng bằng
   `migrate deploy` từ các file cũ sẽ ra schema sai/thiếu.

Sau khi đổi: deploy bằng `prisma migrate deploy` — chỉ áp các migration theo thứ
tự, **không bao giờ tự xoá dữ liệu**, và `prisma/migrations` là nguồn chân lý.

## Đã làm gì trong repo

- Sinh **1 migration `init` duy nhất** (`prisma/migrations/00000000000000_init/`)
  phản ánh đúng `schema.prisma` hiện tại (= đúng schema mà `db push` đã tạo ở
  prod). Lệnh dùng: `prisma migrate diff --from-empty --to-schema prisma/schema --script`.
- Chuyển 20 migration cũ (đã drift) vào `prisma/_migrations_archive_pre_baseline/`
  để tham khảo; Prisma không còn đọc chúng.
- Đổi `docker/Dockerfile` CMD: `prisma db push --accept-data-loss` →
  `prisma migrate deploy`.

## Quy trình triển khai (làm theo đúng thứ tự)

### A. DB prod HIỆN CÓ (đang chạy, từng dùng `db push`)

DB này đã có sẵn toàn bộ schema. Phải **baseline 1 lần** để Prisma biết `init` đã
"áp dụng rồi", nếu không `migrate deploy` sẽ cố tạo lại bảng → lỗi.

1. **Backup trước** (xem `scripts/backup-offsite.sh` hoặc dump thủ công):
   ```bash
   pg_dump "$DATABASE_URL" -Fc -f pre-baseline-$(date +%Y%m%d).dump
   ```
2. **Baseline** — chạy ĐÚNG 1 LẦN, trỏ vào DB prod:
   ```bash
   DATABASE_URL="postgresql://user:pass@host:5432/zalocrm" \
     ./scripts/baseline-existing-db.sh
   ```
   Script gọi `prisma migrate resolve --applied 00000000000000_init` — chỉ ghi
   vào bảng `_prisma_migrations`, KHÔNG chạy `CREATE TABLE`.
3. **Xác minh**: `npx prisma migrate status` → phải báo "Database schema is up to
   date" và liệt kê `00000000000000_init` là applied.
4. **Deploy image mới** (CMD đã là `migrate deploy`). Lần này `migrate deploy`
   thấy init đã applied → không làm gì, app khởi động bình thường.

> ⚠️ **Khuyến nghị mạnh**: diễn tập toàn bộ bước A trên 1 bản clone của DB prod
> (staging) trước, để chắc chắn `init` khớp 100% schema thật. Nếu `migrate status`
> sau baseline báo "drift detected", nghĩa là schema prod lệch với `schema.prisma`
> — xử lý drift đó trước khi deploy.

### B. DB MỚI HOÀN TOÀN (môi trường trống)

Không cần baseline. `migrate deploy` (chạy tự động trong container) sẽ áp `init`
→ tạo đủ schema. Xong.

## Từ giờ đổi schema thế nào?

1. Sửa `schema.prisma`.
2. Sinh migration tăng dần (cần DB dev):
   ```bash
   npx prisma migrate dev --name <mo_ta_ngan>
   ```
3. Commit cả `schema.prisma` lẫn folder migration mới.
4. Deploy → container tự `migrate deploy`.

**Không dùng lại `db push` cho prod.** (Vẫn dùng được cho thử nhanh ở máy dev với
DB vứt-đi.)
