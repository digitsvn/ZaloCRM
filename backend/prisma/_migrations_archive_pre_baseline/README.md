# Migrations cũ (lưu trữ trước khi baseline)

Đây là 20 migration được tạo trong giai đoạn dự án deploy bằng `prisma db push`
(KHÔNG dùng `prisma migrate`). Vì `db push` đồng bộ thẳng `schema.prisma` vào DB
và không ghi vào bảng `_prisma_migrations`, các file migration này:

- **chưa từng được áp dụng qua `migrate`** ở môi trường prod/dev thực tế, và
- **đã drift** (thiếu nhiều cột/constraint mà `schema.prisma` có — ví dụ
  `messages.zalo_msg_id_num`, `messages.sent_via`, unique index
  `messages_conversation_id_zalo_msg_id_key`...). Dùng chúng làm nguồn migrate sẽ
  tạo ra schema KHÔNG đầy đủ.

Vì vậy chúng được thay bằng **một migration `init` duy nhất** (squash) tại
`prisma/migrations/00000000000000_init/` — sinh bằng:

```
npx prisma migrate diff --from-empty --to-schema prisma/schema --script
```

init này phản ánh chính xác `schema.prisma` hiện tại (= đúng schema mà `db push`
đã tạo ở prod).

Giữ lại các file ở đây chỉ để tham khảo lịch sử. **Không** đặt lại vào
`prisma/migrations/` (sẽ làm hỏng trạng thái migrate). Xem
`docs/HUONG-DAN-MIGRATION-BASELINE.md` cho quy trình chuyển đổi.
