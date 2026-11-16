import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { ticketGateway } from '@/lib/ticket-client';
import { runAgent } from '@/agent/engine';
import type { Conversation, Employee, Message } from '@/lib/types';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function body(request: NextRequest): Promise<unknown> {
  const text = await request.text();
  if (text.length > 16000) throw new HttpError(413, 'Mensagem muito grande.');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Requisição inválida.');
  }
}
async function userFor(request: NextRequest): Promise<Employee | null> {
  const token = request.cookies.get('nexo_session')?.value;
  if (!token) return null;
  const r = await pool.query<{ data: Employee }>(
    `SELECT e.data FROM sessions s JOIN employees e ON e.id=s.employee_id WHERE s.token_hash=$1 AND s.expires_at>NOW()`,
    [hash(token)],
  );
  return r.rows[0]?.data ?? null;
}
function authorizeConversation(user: Employee, c: Conversation) {
  if (user.role !== 'analyst' && c.ownerId !== user.id)
    throw new HttpError(404, 'Conversa não encontrada.');
}
function system(text: string): Message {
  return { id: randomUUID(), role: 'system', text, at: new Date().toISOString() };
}
async function handle(request: NextRequest) {
  try {
    const path = request.nextUrl.pathname
      .replace(/^\/api\/?/, '')
      .split('/')
      .filter(Boolean);
    const method = request.method;
    if (method === 'POST') {
      const origin = request.headers.get('origin');
      if (
        origin &&
        !new Set([process.env.APP_ORIGIN ?? 'http://127.0.0.1:3100', 'http://localhost:3100']).has(
          origin,
        )
      )
        throw new HttpError(403, 'Origem não autorizada.');
    }
    if (path[0] === 'health') {
      await pool.query('SELECT 1');
      const r = await fetch(
        (process.env.TICKET_SERVICE_URL ?? 'http://127.0.0.1:4311') + '/health',
        { signal: AbortSignal.timeout(2000), cache: 'no-store' },
      );
      return json(
        {
          status: r.ok ? 'ok' : 'degraded',
          database: 'ok',
          tickets: r.ok ? 'ok' : 'unavailable',
          engine: 'deterministic',
        },
        r.ok ? 200 : 503,
      );
    }
    if (path[0] === 'login' && method === 'POST') {
      if (process.env.DEMO_AUTH !== 'true')
        throw new HttpError(403, 'Login de demonstração desativado.');
      const credentials = z
        .object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(200) })
        .parse(await body(request));
      const r = await pool.query<{ data: Employee }>(
        `SELECT data FROM employees WHERE lower(data->>'email')=$1`,
        [credentials.email.toLowerCase()],
      );
      const user = r.rows[0]?.data;
      if (!user)
        throw new HttpError(401, 'Funcionário não encontrado. Use uma conta de demonstração.');
      const token = randomBytes(32).toString('hex');
      await pool.query('DELETE FROM sessions WHERE expires_at<NOW()');
      await pool.query("INSERT INTO sessions VALUES($1,$2,NOW()+INTERVAL '12 hours')", [
        hash(token),
        user.id,
      ]);
      const response = json({ user });
      response.cookies.set('nexo_session', token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: request.nextUrl.protocol === 'https:',
        path: '/',
        maxAge: 43200,
      });
      return response;
    }
    const user = await userFor(request);
    if (path[0] === 'me') return json({ user });
    if (!user) throw new HttpError(401, 'Entre para continuar.');
    if (path[0] === 'logout' && method === 'POST') {
      await pool.query('DELETE FROM sessions WHERE token_hash=$1', [
        hash(request.cookies.get('nexo_session')?.value ?? ''),
      ]);
      const response = json({ ok: true });
      response.cookies.delete('nexo_session');
      return response;
    }
    if (path[0] === 'tickets' && method === 'GET') {
      const ownerId =
        user.role === 'analyst' ? request.nextUrl.searchParams.get('ownerId') : user.id;
      if (!ownerId) throw new HttpError(400, 'Selecione um funcionário.');
      return json({ tickets: await ticketGateway.list(ownerId) });
    }
    if (path[0] !== 'conversations') throw new HttpError(404, 'Recurso não encontrado.');
    if (path.length === 1) {
      if (method === 'GET') {
        const r = await pool.query<{ data: Conversation }>(
          user.role === 'analyst'
            ? "SELECT (data - 'messages' - 'state') || jsonb_build_object('messages', jsonb_build_array(data->'messages'->-1), 'state', '{}'::jsonb) AS data FROM conversations ORDER BY data->>'updatedAt' DESC"
            : "SELECT (data - 'messages' - 'state') || jsonb_build_object('messages', jsonb_build_array(data->'messages'->-1), 'state', '{}'::jsonb) AS data FROM conversations WHERE owner_id=$1 ORDER BY data->>'updatedAt' DESC",
          user.role === 'analyst' ? [] : [user.id],
        );
        return json({ conversations: r.rows.map((row) => row.data) });
      }
      if (method === 'POST') {
        if (user.role !== 'employee')
          throw new HttpError(403, 'Apenas funcionários iniciam conversas.');
        const now = new Date().toISOString();
        const conversation: Conversation = {
          id: randomUUID(),
          ownerId: user.id,
          ownerName: user.name,
          title: 'Novo atendimento',
          mode: 'agent',
          analystId: null,
          messages: [
            {
              id: randomUUID(),
              role: 'assistant',
              text:
                'Olá, ' +
                user.name.split(' ')[0] +
                '! Sou o Nexo Assist. Como posso ajudar com TI hoje?',
              at: now,
              options: ['Abrir chamado', 'Consultar meus chamados', 'Horário do service desk'],
              decision: {
                intent: 'boas-vindas',
                confidence: 1,
                actions: ['Iniciou atendimento'],
                reason: 'Conversa nova; aguardando a descrição do funcionário.',
                rules: ['Escopo: TI'],
                engine: 'deterministic',
              },
            },
          ],
          state: {},
          messageCount: 0,
          summary: '',
          createdAt: now,
          updatedAt: now,
        };
        await pool.query('INSERT INTO conversations VALUES($1,$2,$3)', [
          conversation.id,
          user.id,
          JSON.stringify(conversation),
        ]);
        return json({ conversation }, 201);
      }
    }
    const id = path[1];
    if (!id) throw new HttpError(404, 'Conversa não encontrada.');
    if (method === 'GET') {
      const result = await pool.query<{ data: Conversation }>(
        'SELECT data FROM conversations WHERE id=$1',
        [id],
      );
      const conversation = result.rows[0]?.data;
      if (!conversation) throw new HttpError(404, 'Conversa não encontrada.');
      authorizeConversation(user, conversation);
      return json({ conversation });
    }
    if (method !== 'POST') throw new HttpError(405, 'Método não permitido.');
    const payload = await body(request);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ data: Conversation }>(
        'SELECT data FROM conversations WHERE id=$1 FOR UPDATE',
        [id],
      );
      const c = result.rows[0]?.data;
      if (!c) throw new HttpError(404, 'Conversa não encontrada.');
      authorizeConversation(user, c);
      if (path[2] === 'messages') {
        const { text, requestId } = z
          .object({ text: z.string().trim().min(1).max(4000), requestId: z.string().uuid() })
          .parse(payload);
        const previous = await client.query(
          'SELECT 1 FROM conversation_requests WHERE conversation_id=$1 AND request_id=$2',
          [id, requestId],
        );
        if (previous.rowCount) {
          await client.query('COMMIT');
          return json({ conversation: c });
        }
        if (c.mode === 'closed')
          throw new HttpError(409, 'Conversa encerrada. Inicie um novo atendimento.');
        if (user.role === 'analyst') {
          if (c.mode !== 'human' || c.analystId !== user.id)
            throw new HttpError(403, 'Assuma esta conversa antes de responder.');
          c.messages.push({
            id: randomUUID(),
            role: 'analyst',
            text,
            at: new Date().toISOString(),
          });
        } else {
          if (c.messageCount >= 30)
            throw new HttpError(409, 'Limite de 30 mensagens atingido. Inicie outro atendimento.');
          c.messageCount++;
          c.messages.push({ id: randomUUID(), role: 'user', text, at: new Date().toISOString() });
          if (c.title === 'Novo atendimento') c.title = text.slice(0, 65);
          if (c.mode === 'agent') {
            const started = Date.now();
            const response = await runAgent(text, c.state, c.ownerId, ticketGateway);
            c.state = response.state;
            if (response.mode) c.mode = response.mode;
            if (response.summary) c.summary = response.summary;
            if (response.message.decision)
              response.message.decision.elapsedMs = Date.now() - started;
            c.messages.push({
              ...response.message,
              id: randomUUID(),
              role: 'assistant',
              at: new Date().toISOString(),
            });
          }
        }
        await client.query('INSERT INTO conversation_requests VALUES($1,$2,$3)', [
          id,
          requestId,
          JSON.stringify({ ok: true }),
        ]);
      } else if (path[2] === 'action') {
        if (user.role !== 'analyst') throw new HttpError(403, 'Ação exclusiva do analista.');
        const { action } = z
          .object({ action: z.enum(['claim', 'release', 'close']) })
          .parse(payload);
        if (action === 'claim') {
          if (c.mode !== 'waiting')
            throw new HttpError(409, 'Esta conversa não está aguardando atendimento.');
          c.mode = 'human';
          c.analystId = user.id;
          c.messages.push(system(user.name + ' assumiu o atendimento. O agente está pausado.'));
        } else {
          if (c.mode !== 'human' || c.analystId !== user.id)
            throw new HttpError(409, 'Apenas o analista responsável pode alterar o atendimento.');
          c.mode = action === 'release' ? 'agent' : 'closed';
          c.analystId = null;
          c.state = {};
          c.messages.push(
            system(
              action === 'release'
                ? 'Atendimento devolvido ao Nexo Assist.'
                : 'Atendimento encerrado por ' + user.name + '.',
            ),
          );
        }
      } else throw new HttpError(404, 'Ação não encontrada.');
      c.updatedAt = new Date().toISOString();
      await client.query('UPDATE conversations SET data=$2 WHERE id=$1', [id, JSON.stringify(c)]);
      await client.query('COMMIT');
      return json({ conversation: c });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError) return json({ error: 'Confira os campos informados.' }, 400);
    console.error('Nexo API:', error instanceof Error ? error.name : 'UnknownError');
    return json(
      {
        error:
          'Serviço temporariamente indisponível. Seus dados anteriores estão preservados; tente novamente.',
      },
      503,
    );
  }
}
export const GET = handle;
export const POST = handle;
