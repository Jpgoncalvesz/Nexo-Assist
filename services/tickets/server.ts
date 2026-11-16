import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../../src/lib/db';
import { dueDate } from '../../src/agent/sla';
import { sameProblem, recentlyResolved } from '../../src/lib/duplicates';
import type { Draft, Ticket } from '../../src/lib/types';

const secret = process.env.TICKET_SERVICE_KEY;
if (!secret || secret.length < 24)
  throw new Error('Configure TICKET_SERVICE_KEY com pelo menos 24 caracteres.');
const key = secret;
const draftSchema = z
  .object({
    operation: z.enum(['create', 'update', 'reopen']),
    ticketId: z
      .string()
      .regex(/^(INC|REQ)-\d+$/)
      .optional(),
    title: z.string().trim().min(3).max(180),
    description: z.string().trim().min(5).max(12000),
    type: z.enum(['INC', 'REQ']),
    category: z.enum(['Acesso', 'Rede e VPN', 'Hardware', 'Software', 'E-mail', 'Outros']),
    priority: z.enum(['Crítica', 'Alta', 'Média', 'Baixa']),
    affected: z.string().trim().min(2).max(500),
    key: z.string().min(12).max(200),
  })
  .strict()
  .refine((d) => d.operation === 'create' || !!d.ticketId, 'Chamado obrigatório para atualização');
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}
async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const part: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    length += part.length;
    if (length > 65536) throw new HttpError(413, 'Corpo excede 64 KB.');
    chunks.push(part);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, 'JSON inválido.');
  }
}
async function commit(owner: string, draft: Draft): Promise<Ticket> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    // Serialize writes per employee, including independent conversations.
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [owner]);
    const cached = await db.query<{ data: Ticket }>(
      'SELECT t.data FROM ticket_operations o JOIN tickets t ON t.id=o.ticket_id AND t.owner_id=o.owner_id WHERE o.key=$1 AND o.owner_id=$2',
      [draft.key, owner],
    );
    if (cached.rows[0]) {
      await db.query('COMMIT');
      return cached.rows[0].data;
    }
    const rows = await db.query<{ data: Ticket }>(
      'SELECT data FROM tickets WHERE owner_id=$1 FOR UPDATE',
      [owner],
    );
    const existing = rows.rows.map((r) => r.data);
    const now = new Date();
    const at = now.toISOString();
    let ticket: Ticket;
    if (draft.operation === 'create') {
      const duplicate = existing.find(
        (t) => sameProblem(t, draft) && (!t.resolvedAt || recentlyResolved(t, now)),
      );
      // Do not silently update a different ticket than the one the person confirmed.
      if (duplicate)
        throw new HttpError(
          409,
          'Já existe um chamado para este problema. Consulte seus chamados e confirme a atualização ou reabertura.',
        );
      const seq = await db.query<{ value: string }>(
        "SELECT nextval('ticket_number')::text AS value",
      );
      const id = draft.type + '-' + seq.rows[0].value;
      ticket = {
        id,
        ownerId: owner,
        title: draft.title,
        description: draft.description,
        type: draft.type,
        category: draft.category,
        priority: draft.priority,
        affected: draft.affected,
        status: 'Aberto',
        createdAt: at,
        updatedAt: at,
        resolvedAt: null,
        dueAt: dueDate(draft.priority, now).toISOString(),
        history: [{ at, text: 'Chamado criado após confirmação do funcionário.' }],
      };
      await db.query('INSERT INTO tickets(id,owner_id,data) VALUES($1,$2,$3)', [id, owner, ticket]);
    } else {
      const original = existing.find((t) => t.id === draft.ticketId);
      if (!original) throw new HttpError(404, 'Chamado não encontrado.');
      if (draft.operation === 'reopen' && !recentlyResolved(original, now))
        throw new HttpError(409, 'Somente chamados resolvidos há até 7 dias podem ser reabertos.');
      if (draft.operation === 'update' && original.resolvedAt)
        throw new HttpError(
          409,
          'Este chamado está resolvido. Confirme uma reabertura quando elegível.',
        );
      ticket = {
        ...original,
        title: draft.title,
        description: draft.description,
        category: draft.category,
        priority: draft.priority,
        affected: draft.affected,
        status: draft.operation === 'reopen' ? 'Aberto' : original.status,
        updatedAt: at,
        resolvedAt: null,
        dueAt: dueDate(draft.priority, now).toISOString(),
        history: [
          ...original.history,
          {
            at,
            text:
              (draft.operation === 'reopen' ? 'Reabertura' : 'Atualização') +
              ' confirmada pelo funcionário: ' +
              draft.description,
          },
        ],
      };
      await db.query('UPDATE tickets SET data=$1 WHERE id=$2 AND owner_id=$3', [
        ticket,
        ticket.id,
        owner,
      ]);
    }
    await db.query('INSERT INTO ticket_operations(key,owner_id,ticket_id) VALUES($1,$2,$3)', [
      draft.key,
      owner,
      ticket.id,
    ]);
    await db.query('COMMIT');
    return ticket;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
async function transfer(owner: string, id: string, summary: string) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await db.query<{ data: Ticket }>(
      'SELECT data FROM tickets WHERE id=$1 AND owner_id=$2 FOR UPDATE',
      [id, owner],
    );
    const original = result.rows[0]?.data;
    if (!original) throw new HttpError(404, 'Chamado não encontrado.');
    const text = 'Encaminhado ao analista: ' + summary;
    if (original.history.at(-1)?.text === text) {
      await db.query('COMMIT');
      return original;
    }
    const ticket: Ticket = {
      ...original,
      status: original.resolvedAt ? original.status : 'Aguardando analista',
      history: [...original.history, { at: new Date().toISOString(), text }],
    };
    // A handoff is not an analyst response: preserve updatedAt and dueAt.
    await db.query('UPDATE tickets SET data=$1 WHERE id=$2 AND owner_id=$3', [ticket, id, owner]);
    await db.query('COMMIT');
    return ticket;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
let requests = 0;
const failureEvery = Number(process.env.TICKET_FAILURE_EVERY ?? 0);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health' && req.method === 'GET') {
      await pool.query('SELECT 1');
      return send(res, 200, { status: 'ok', service: 'tickets' });
    }
    const auth = req.headers.authorization ?? '';
    const expected = Buffer.from('Bearer ' + key);
    const supplied = Buffer.from(auth);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      throw new HttpError(401, 'Autenticação de serviço necessária.');
    const owner = req.headers['x-owner-id'];
    if (typeof owner !== 'string' || owner.length < 1 || owner.length > 200)
      throw new HttpError(400, 'Funcionário obrigatório.');
    requests += 1;
    if (failureEvery > 0 && requests % failureEvery === 0)
      throw new HttpError(503, 'Serviço legado temporariamente indisponível.');
    if (url.pathname === '/tickets' && req.method === 'GET') {
      const result = await pool.query<{ data: Ticket }>(
        "SELECT data FROM tickets WHERE owner_id=$1 ORDER BY data->>'updatedAt' DESC",
        [owner],
      );
      return send(
        res,
        200,
        result.rows.map((r) => r.data),
      );
    }
    if (url.pathname === '/tickets/commit' && req.method === 'POST')
      return send(res, 200, await commit(owner, draftSchema.parse(await body(req))));
    const match = /^\/tickets\/((?:INC|REQ)-\d+)(\/transfer)?$/.exec(url.pathname);
    if (match && !match[2] && req.method === 'GET') {
      const result = await pool.query<{ data: Ticket }>(
        'SELECT data FROM tickets WHERE id=$1 AND owner_id=$2',
        [match[1], owner],
      );
      if (!result.rows[0]) throw new HttpError(404, 'Chamado não encontrado.');
      return send(res, 200, result.rows[0].data);
    }
    if (match?.[2] && req.method === 'POST') {
      const input = z
        .object({ summary: z.string().trim().min(3).max(12000) })
        .strict()
        .parse(await body(req));
      return send(res, 200, await transfer(owner, match[1], input.summary));
    }
    throw new HttpError(404, 'Recurso não encontrado.');
  } catch (error) {
    if (error instanceof HttpError) return send(res, error.status, { error: error.message });
    if (error instanceof z.ZodError)
      return send(res, 400, {
        error: 'Dados do chamado inválidos.',
        issues: error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    console.error(
      'Ticket service request failed:',
      error instanceof Error ? error.name : 'UnknownError',
    );
    send(res, 503, { error: 'Serviço de chamados indisponível. Tente novamente.' });
  }
});
server.requestTimeout = 5000;
server.headersTimeout = 5000;
server.listen(Number(process.env.TICKET_SERVICE_PORT ?? 4311), '127.0.0.1', () =>
  console.log(
    'Serviço de chamados em http://127.0.0.1:' + (process.env.TICKET_SERVICE_PORT ?? 4311),
  ),
);
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    server.close();
    void pool.end().then(() => process.exit(0));
  });
