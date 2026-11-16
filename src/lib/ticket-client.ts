import type { Ticket, TicketGateway } from './types';

export class TicketServiceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'TicketServiceError';
  }
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function request<T>(ownerId: string, path: string, body?: unknown): Promise<T> {
  const url = process.env.TICKET_SERVICE_URL ?? 'http://127.0.0.1:4311';
  const key = process.env.TICKET_SERVICE_KEY;
  if (!key) throw new TicketServiceError(503, 'Serviço de chamados não configurado.');
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: 'Bearer ' + key,
          'X-Owner-Id': ownerId,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(2000),
        cache: 'no-store',
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof data === 'object' && data && 'error' in data && typeof data.error === 'string'
            ? data.error
            : 'Falha no serviço de chamados.';
        throw new TicketServiceError(response.status, message);
      }
      return data as T;
    } catch (error) {
      last = error;
      if (error instanceof TicketServiceError && error.status < 500) throw error;
      if (attempt < 2) await pause(150 * 2 ** attempt);
    }
  }
  if (last instanceof TicketServiceError) throw last;
  throw new TicketServiceError(
    503,
    'Não foi possível confirmar o resultado no serviço de chamados. Tente novamente; a mesma operação não cria duplicidade.',
  );
}
export const ticketGateway: TicketGateway = {
  list: (owner) => request<Ticket[]>(owner, '/tickets'),
  get: async (owner, id) => {
    try {
      return await request<Ticket>(owner, '/tickets/' + encodeURIComponent(id));
    } catch (error) {
      if (error instanceof TicketServiceError && error.status === 404) return null;
      throw error;
    }
  },
  commit: (owner, draft) => request<Ticket>(owner, '/tickets/commit', draft),
  transfer: (owner, id, summary) =>
    request<Ticket>(owner, '/tickets/' + encodeURIComponent(id) + '/transfer', { summary }),
};
