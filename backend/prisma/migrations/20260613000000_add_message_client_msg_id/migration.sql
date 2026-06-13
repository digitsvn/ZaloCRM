-- AlterTable
ALTER TABLE "messages" ADD COLUMN "client_msg_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversation_id_client_msg_id_key" ON "messages"("conversation_id", "client_msg_id");
