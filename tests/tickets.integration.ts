// Run with the independent ticket service active:
// npx tsx --env-file=.env tests/tickets.integration.ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../src/lib/db';
import type { Draft, Ticket } from '../src/lib/types';

const base = process.env.TICKET_SERVICE_URL ?? 'http://127.0.0.1:4311';
const owner = 'test-service-' + randomUUID();
const other = 'test-service-' + randomUUID();
let assertions = 0;
function ok(value: unknown, message: string) {
  assert.ok(value, message);
  assertions++;
}
async function call(path: string, actor = owner, payload?: unknown) {
  return fetch(base + path, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.TICKET_SERVICE_KEY,
      'X-Owner-Id': actor,
      'Content-Type': 'application/json',
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}
async function main() {
  try {
    for (const id of [owner, other])
      await pool.query('INSERT INTO employees(id,data) VALUES($1,$2)', [
        id,
        {
          id,
          name: 'Teste automatizado',
          email: id + '@nexo.test',
          role: 'employee',
          department: 'QA',
        },
      ]);
    ok((await fetch(base + '/tickets')).status === 401, 'Service requires internal authentication');
    const draft: Draft = {
      key: randomUUID(),
      operation: 'create',
      title: 'Monitor sem imagem',
      description: 'Monitor externo sem imagem mesmo após reconectar o cabo.',
      type: 'INC',
      category: 'Hardware',
      priority: 'Média',
      affected: 'Uma pessoa com alternativa',
    };
    ok(
      (await call('/tickets/commit', owner, { ...draft, priority: 'Inválida' })).status === 400,
      'Invalid draft rejected',
    );
    const concurrent = await Promise.all([
      call('/tickets/commit', owner, draft),
      call('/tickets/commit', owner, draft),
    ]);
    ok(
      concurrent.every((r) => r.ok),
      'Concurrent idempotent requests succeed',
    );
    const [first, second] = await Promise.all(concurrent.map((r) => r.json() as Promise<Ticket>));
    ok(first.id === second.id, 'Same operation creates exactly one ticket');
    const list = (await (await call('/tickets')).json()) as Ticket[];
    ok(list.length === 1, 'One persisted ticket after concurrent calls');
    ok((await call('/tickets/' + first.id, other)).status === 404, 'Foreign read concealed');
    ok(
      (
        await call('/tickets/commit', other, {
          ...draft,
          operation: 'update',
          ticketId: first.id,
          key: randomUUID(),
        })
      ).status === 404,
      'Foreign update rejected',
    );
    ok(
      (await call('/tickets/' + first.id + '/transfer', other, { summary: 'Tentativa indevida' }))
        .status === 404,
      'Foreign transfer rejected',
    );
    ok(
      (await call('/tickets/commit', owner, { ...draft, key: randomUUID() })).status === 409,
      'Duplicate new operation blocked',
    );
    const update = await call('/tickets/commit', owner, {
      ...draft,
      operation: 'update',
      ticketId: first.id,
      key: randomUUID(),
      description: 'Nova informação confirmada: outro cabo também falha.',
    });
    ok(update.ok, 'Confirmed update succeeds');
    const changed = (await update.json()) as Ticket;
    ok(
      changed.history.length === 2 && changed.description.includes('outro cabo'),
      'Update and audit persisted',
    );
    const handoff = await call('/tickets/' + first.id + '/transfer', owner, {
      summary: 'Monitor sem imagem; funcionário pede analista.',
    });
    ok(handoff.ok, 'Handoff succeeds');
    const transferred = (await handoff.json()) as Ticket;
    ok(
      transferred.dueAt === changed.dueAt && transferred.updatedAt === changed.updatedAt,
      'Handoff does not hide overdue deadline',
    );
    const repeat = (await (
      await call('/tickets/' + first.id + '/transfer', owner, {
        summary: 'Monitor sem imagem; funcionário pede analista.',
      })
    ).json()) as Ticket;
    ok(repeat.history.length === transferred.history.length, 'Handoff retry is idempotent');
    const resolved = {
      ...transferred,
      status: 'Resolvido',
      resolvedAt: new Date(Date.now() - 4 * 86400000).toISOString(),
    };
    await pool.query('UPDATE tickets SET data=$1 WHERE id=$2 AND owner_id=$3', [
      resolved,
      first.id,
      owner,
    ]);
    const reopened = await call('/tickets/commit', owner, {
      ...draft,
      operation: 'reopen',
      ticketId: first.id,
      key: randomUUID(),
    });
    ok(
      reopened.ok && ((await reopened.json()) as Ticket).resolvedAt === null,
      'Resolved four days ago can reopen',
    );
    await pool.query('UPDATE tickets SET data=$1 WHERE id=$2 AND owner_id=$3', [
      { ...resolved, resolvedAt: new Date(Date.now() - 8 * 86400000).toISOString() },
      first.id,
      owner,
    ]);
    ok(
      (
        await call('/tickets/commit', owner, {
          ...draft,
          operation: 'reopen',
          ticketId: first.id,
          key: randomUUID(),
        })
      ).status === 409,
      'Resolved eight days ago cannot reopen',
    );
    console.log('Ticket service integration: ' + assertions + ' assertions passed.');
  } finally {
    await pool.query('DELETE FROM ticket_operations WHERE owner_id=ANY($1::text[])', [
      [owner, other],
    ]);
    await pool.query('DELETE FROM tickets WHERE owner_id=ANY($1::text[])', [[owner, other]]);
    await pool.query('DELETE FROM employees WHERE id=ANY($1::text[])', [[owner, other]]);
    await pool.end();
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Integration failed');
  process.exitCode = 1;
});
