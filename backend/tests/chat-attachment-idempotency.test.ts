/**
 * chat-attachment-idempotency.test.ts — Dedup gửi media qua /attachments.
 * Verify: cùng clientMsgId (batch) bị retry → trả lại tin đã gửi, KHÔNG gửi lại Zalo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import FormData from 'form-data';
import { mockUser } from './test-helpers.js';

const prismaMock = {
  conversation: { findFirst: vi.fn(), update: vi.fn() },
  message: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
};
const sendMessageMock = vi.fn().mockResolvedValue({ msgId: 'z-1' });
const uploadBufferMock = vi.fn().mockResolvedValue({ url: 'http://minio/x.png', size: 10 });
const zaloPoolMock = { getInstance: vi.fn() };
const zaloRateLimiterMock = { checkLimits: vi.fn(), recordSend: vi.fn() };

vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: prismaMock }));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: async (req: any) => { req.user = mockUser(); },
}));
vi.mock('../src/modules/zalo/zalo-access-middleware.js', () => ({
  requireZaloAccess: () => async () => {},
}));
vi.mock('../src/modules/zalo/zalo-pool.js', () => ({ zaloPool: zaloPoolMock }));
vi.mock('../src/modules/zalo/zalo-rate-limiter.js', () => ({ zaloRateLimiter: zaloRateLimiterMock }));
vi.mock('../src/shared/zalo-operations.js', () => ({ zaloOps: { sendFile: vi.fn() } }));
vi.mock('../src/shared/video-processor.js', () => ({
  generateThumbnail: vi.fn(), sendNativeVideo: vi.fn(),
}));
vi.mock('../src/shared/storage/minio-client.js', () => ({ uploadBuffer: uploadBufferMock }));

const { chatAttachmentRoutes } = await import('../src/modules/chat/chat-attachment-routes.js');

const CONV = {
  id: 'conv-1',
  orgId: 'org-1',
  threadType: 'user',
  externalThreadId: 'ext-1',
  zaloAccountId: 'za-1',
  zaloAccount: { id: 'za-1', zaloUid: 'own-1', privacyMode: 'open', ownerUserId: 'u-1' },
};

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate('io', { emit: vi.fn() });
  await app.register(fastifyMultipart);
  await app.register(chatAttachmentRoutes);
  return app;
}

function imageForm(clientMsgId: string) {
  const fd = new FormData();
  fd.append('clientMsgId', clientMsgId);
  fd.append('files', Buffer.from('fake-png-bytes'), { filename: 'a.png', contentType: 'image/png' });
  return { payload: fd.getBuffer(), headers: fd.getHeaders() };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.conversation.findFirst.mockResolvedValue(CONV);
  prismaMock.conversation.update.mockResolvedValue({});
  prismaMock.message.create.mockResolvedValue({ id: 'm-new', clientMsgId: 'cm-1:0', zaloMsgIdNum: null });
  zaloPoolMock.getInstance.mockReturnValue({ api: { sendMessage: sendMessageMock } });
  zaloRateLimiterMock.checkLimits.mockResolvedValue({ allowed: true });
  zaloRateLimiterMock.recordSend.mockReturnValue(undefined);
});

describe('POST /api/v1/conversations/:id/attachments — idempotency', () => {
  it('idempotent — trả tin đã gửi, KHÔNG gửi lại khi clientMsgId batch đã tồn tại', async () => {
    // Pre-check findMany theo prefix `${clientMsgId}:` trả về batch cũ → short-circuit.
    prismaMock.message.findMany.mockResolvedValue([{ id: 'old-0', clientMsgId: 'cm-1:0', zaloMsgIdNum: null }]);
    const app = await buildApp();
    const { payload, headers } = imageForm('cm-1');
    const res = await app.inject({ method: 'POST', url: '/api/v1/conversations/conv-1/attachments', payload, headers });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ messages: [{ id: 'old-0' }] });
    // KHÔNG upload MinIO + KHÔNG gọi Zalo SDK + KHÔNG tạo Message mới
    expect(uploadBufferMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });

  it('lần gửi đầu — lưu clientMsgId dạng ${batch}:${index} và gửi qua Zalo', async () => {
    prismaMock.message.findMany.mockResolvedValue([]); // chưa có batch
    const app = await buildApp();
    const { payload, headers } = imageForm('cm-2');
    const res = await app.inject({ method: 'POST', url: '/api/v1/conversations/conv-1/attachments', payload, headers });

    expect(res.statusCode).toBe(200);
    expect(sendMessageMock).toHaveBeenCalled();
    expect(prismaMock.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ clientMsgId: 'cm-2:0', contentType: 'image' }),
    }));
  });
});
