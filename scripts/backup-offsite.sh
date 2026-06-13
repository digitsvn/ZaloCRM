#!/usr/bin/env bash
#
# backup-offsite.sh — Đẩy backup ra NGOÀI máy chủ (offsite) để chống mất dữ liệu
# khi hỏng ổ đĩa / mất máy chủ.
#
# Sao lưu 2 thứ:
#   1. Dump Postgres (pg_dump custom format, nén) → offsite .../postgres/
#   2. Toàn bộ bucket MinIO (file media: ảnh/video/file chat) → offsite .../minio/
#
# Đích là 1 bucket S3-compatible ở NHÀ CUNG CẤP KHÁC (Cloudflare R2, AWS S3,
# Backblaze B2…). Cấu hình qua biến môi trường OFFSITE_S3_* trong .env.
#
# Yêu cầu công cụ: `mc` (MinIO Client) và `pg_dump`. Trên Docker có thể dùng
# image minio/mc (mc) + postgres:16-alpine (pg_dump), hoặc cài trên host.
#
# Cách dùng:
#   set -a; . ./.env; set +a            # nạp biến môi trường
#   ./scripts/backup-offsite.sh
#
# Tự động hoá: thêm vào host crontab, ví dụ 02:30 mỗi ngày:
#   30 2 * * * cd /opt/zalocrm && set -a && . ./.env && set +a && ./scripts/backup-offsite.sh >> /var/log/zalocrm-backup.log 2>&1
# Hoặc bật service `backup-offsite` trong docker-compose (profile: offsite).

set -euo pipefail

# ── Tắt nếu chưa cấu hình offsite ───────────────────────────────────────────
if [ -z "${OFFSITE_S3_ENDPOINT:-}" ]; then
  echo "[backup-offsite] OFFSITE_S3_ENDPOINT trống → backup offsite TẮT. Bỏ qua."
  exit 0
fi

# ── Tham số (lấy từ .env, có default hợp lý) ────────────────────────────────
SRC_S3_ENDPOINT="${S3_ENDPOINT:-http://minio:9000}"
SRC_S3_ACCESS_KEY="${S3_ACCESS_KEY:-${MINIO_ROOT_USER:-minioadmin}}"
SRC_S3_SECRET_KEY="${S3_SECRET_KEY:-${MINIO_ROOT_PASSWORD:-minioadmin}}"
SRC_S3_BUCKET="${S3_BUCKET:-zalocrm-attachments}"

DST_BUCKET="${OFFSITE_S3_BUCKET:-zalocrm-backups}"
KEEP_DAYS="${OFFSITE_BACKUP_KEEP_DAYS:-30}"

TS="$(date +%Y%m%d-%H%M%S)"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

command -v mc >/dev/null 2>&1 || { echo "✗ thiếu 'mc' (MinIO Client)"; exit 1; }

# ── 1. Dump Postgres ────────────────────────────────────────────────────────
if [ -n "${DATABASE_URL:-}" ] && command -v pg_dump >/dev/null 2>&1; then
  DUMP="$TMPDIR/zalocrm-$TS.dump"
  echo "[backup-offsite] pg_dump → $DUMP"
  pg_dump "$DATABASE_URL" -Fc -f "$DUMP"
  echo "[backup-offsite] dump size: $(du -h "$DUMP" | cut -f1)"
else
  echo "[backup-offsite] ⚠ bỏ qua pg_dump (thiếu DATABASE_URL hoặc pg_dump). Chỉ mirror MinIO."
fi

# ── 2. Cấu hình alias mc (idempotent) ───────────────────────────────────────
echo "[backup-offsite] cấu hình alias mc…"
mc alias set zsrc "$SRC_S3_ENDPOINT" "$SRC_S3_ACCESS_KEY" "$SRC_S3_SECRET_KEY" >/dev/null
mc alias set zdst "$OFFSITE_S3_ENDPOINT" "$OFFSITE_S3_ACCESS_KEY" "$OFFSITE_S3_SECRET_KEY" >/dev/null
# Tạo bucket đích nếu chưa có (bỏ qua nếu đã tồn tại)
mc mb --ignore-existing "zdst/$DST_BUCKET" >/dev/null 2>&1 || true

# ── 3. Upload dump Postgres ─────────────────────────────────────────────────
if [ -n "${DUMP:-}" ] && [ -f "${DUMP:-/nonexistent}" ]; then
  echo "[backup-offsite] upload dump → zdst/$DST_BUCKET/postgres/"
  mc cp "$DUMP" "zdst/$DST_BUCKET/postgres/"
  # Retention: xoá dump cũ hơn KEEP_DAYS
  echo "[backup-offsite] retention: xoá dump > ${KEEP_DAYS} ngày"
  mc rm --recursive --force --older-than "${KEEP_DAYS}d" "zdst/$DST_BUCKET/postgres/" 2>/dev/null || true
fi

# ── 4. Mirror bucket MinIO (additive — KHÔNG --remove để giữ cả file đã xoá) ─
echo "[backup-offsite] mirror MinIO bucket '$SRC_S3_BUCKET' → zdst/$DST_BUCKET/minio/$SRC_S3_BUCKET"
mc mirror --overwrite "zsrc/$SRC_S3_BUCKET" "zdst/$DST_BUCKET/minio/$SRC_S3_BUCKET"

echo "[backup-offsite] ✓ xong lúc $(date -u +%FT%TZ)"
