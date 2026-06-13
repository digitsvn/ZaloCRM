#!/usr/bin/env bash
#
# baseline-existing-db.sh — Baseline 1 LẦN cho DB hiện hữu (từng deploy bằng
# `prisma db push`) trước khi chuyển sang `prisma migrate deploy`.
#
# Bối cảnh: trước đây prod đồng bộ schema bằng `db push` nên bảng
# `_prisma_migrations` trống. Nếu chạy thẳng `migrate deploy`, Prisma sẽ cố tạo
# lại toàn bộ bảng (đã tồn tại) → lỗi. Lệnh `migrate resolve --applied` đánh dấu
# migration `init` là "đã áp dụng" mà KHÔNG chạy SQL, vì DB đã khớp schema rồi.
#
# CHẠY ĐÚNG 1 LẦN, trên DB prod hiện có, TRƯỚC khi deploy image mới.
# Với DB MỚI HOÀN TOÀN (trống): KHÔNG chạy script này — cứ để `migrate deploy`
# tự tạo schema từ init.
#
# Yêu cầu: DATABASE_URL trỏ tới DB prod cần baseline.
#
# Cách dùng:
#   DATABASE_URL="postgresql://user:pass@host:5432/zalocrm" ./scripts/baseline-existing-db.sh
#   # hoặc trong container app:
#   docker compose exec app sh -c './scripts/baseline-existing-db.sh'

set -euo pipefail

INIT_MIGRATION="00000000000000_init"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "✗ DATABASE_URL chưa được set. Export trước khi chạy." >&2
  exit 1
fi

cd "$(dirname "$0")/../backend"

echo "▶ Kiểm tra trạng thái migration hiện tại…"
if npx prisma migrate status 2>/dev/null | grep -q "$INIT_MIGRATION"; then
  echo "✓ '$INIT_MIGRATION' đã được ghi nhận — DB có vẻ đã baseline. Không làm gì thêm."
  exit 0
fi

echo "▶ Đánh dấu '$INIT_MIGRATION' là đã-áp-dụng (resolve --applied)…"
echo "  (KHÔNG chạy CREATE TABLE — chỉ ghi vào _prisma_migrations vì DB đã khớp schema)"
npx prisma migrate resolve --applied "$INIT_MIGRATION"

echo "▶ Xác minh lại trạng thái…"
npx prisma migrate status || true

echo ""
echo "✓ Baseline xong. Từ giờ deploy bằng 'prisma migrate deploy' là an toàn."
echo "  Lần đổi schema tiếp theo: dùng 'prisma migrate dev --name <ten>' để sinh migration tăng dần."
