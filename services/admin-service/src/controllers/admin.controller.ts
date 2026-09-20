import type { FastifyRequest, FastifyReply } from 'fastify';
import { AdminService } from '../services/admin.service';

export class AdminController {
  constructor(private service: AdminService) {}

  listUsers = async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as any;
    const result = await this.service.listUsers({
      tier: q.tier,
      suspended:
        q.suspended === 'true' ? true : q.suspended === 'false' ? false : undefined,
      page: q.page ? parseInt(q.page) : 1,
      pageSize: q.pageSize ? parseInt(q.pageSize) : 20,
    });
    return reply.status(200).send(result);
  };

  getUser = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    try {
      return reply.status(200).send(await this.service.getUser(id));
    } catch (err: any) {
      if (err.statusCode === 404)
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: err.message } });
      throw err;
    }
  };

  suspendUser = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    try {
      return reply.status(200).send(await this.service.suspendUser(id));
    } catch (err: any) {
      if (err.statusCode === 404)
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: err.message } });
      throw err;
    }
  };

  unsuspendUser = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    try {
      return reply.status(200).send(await this.service.unsuspendUser(id));
    } catch (err: any) {
      if (err.statusCode === 404)
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: err.message } });
      throw err;
    }
  };

  listJobs = async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as any;
    const result = await this.service.listJobs({
      userId: q.userId,
      status: q.status,
      page: q.page ? parseInt(q.page) : 1,
      pageSize: q.pageSize ? parseInt(q.pageSize) : 20,
    });
    return reply.status(200).send(result);
  };

  getJob = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    try {
      return reply.status(200).send(await this.service.getJob(id));
    } catch (err: any) {
      if (err.statusCode === 404)
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: err.message } });
      throw err;
    }
  };

  retryJob = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    try {
      return reply.status(200).send(await this.service.retryJob(id));
    } catch (err: any) {
      if (err.statusCode === 404)
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: err.message } });
      if (err.statusCode === 409)
        return reply
          .status(409)
          .send({ error: { code: err.code ?? 'INVALID_STATE', message: err.message } });
      throw err;
    }
  };

  cancelJob = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    try {
      return reply.status(200).send(await this.service.cancelJob(id));
    } catch (err: any) {
      if (err.statusCode === 404)
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: err.message } });
      if (err.statusCode === 409)
        return reply
          .status(409)
          .send({ error: { code: err.code ?? 'INVALID_STATE', message: err.message } });
      throw err;
    }
  };

  getMetrics = async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send(await this.service.getSystemMetrics());
  };
}
