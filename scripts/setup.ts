import pg from 'pg';
import { dueDate } from '../src/agent/sla';
import type { Ticket, Employee, Conversation } from '../src/lib/types';
const url = new URL(process.env.DATABASE_URL ?? '');
const database = url.pathname.slice(1);
if (!/^nexo_assist_[a-z0-9_]+$/.test(database))
  throw new Error('Use um banco exclusivo com prefixo nexo_assist_.');
url.pathname = '/postgres';
const admin = new pg.Pool({ connectionString: url.toString() });
if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount)
  await admin.query('CREATE DATABASE "' + database + '"');
await admin.end();
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await db.query(`
CREATE TABLE IF NOT EXISTS employees(id text PRIMARY KEY,data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash text PRIMARY KEY,employee_id text NOT NULL REFERENCES employees(id),expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS conversations(id text PRIMARY KEY,owner_id text NOT NULL REFERENCES employees(id),data jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS conversations_owner ON conversations(owner_id);
CREATE INDEX IF NOT EXISTS conversations_updated ON conversations((data->>'updatedAt') DESC);
CREATE INDEX IF NOT EXISTS conversations_owner_updated ON conversations(owner_id,(data->>'updatedAt') DESC);
CREATE INDEX IF NOT EXISTS employees_email ON employees(lower(data->>'email'));
CREATE INDEX IF NOT EXISTS sessions_expiration ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS conversation_requests(conversation_id text REFERENCES conversations(id),request_id text,response jsonb NOT NULL,PRIMARY KEY(conversation_id,request_id));
CREATE TABLE IF NOT EXISTS tickets(id text PRIMARY KEY,owner_id text NOT NULL REFERENCES employees(id),data jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS tickets_owner ON tickets(owner_id);
CREATE TABLE IF NOT EXISTS ticket_operations(key text PRIMARY KEY,owner_id text NOT NULL,ticket_id text NOT NULL REFERENCES tickets(id));
CREATE SEQUENCE IF NOT EXISTS ticket_number START 21000;
`);
const employees: Employee[] = [
  {
    id: 'ana',
    name: 'Ana Souza',
    email: 'ana.souza@nexo.com.br',
    role: 'employee',
    department: 'Financeiro',
  },
  {
    id: 'bruno',
    name: 'Bruno Lima',
    email: 'bruno.lima@nexo.com.br',
    role: 'employee',
    department: 'Operações',
  },
  {
    id: 'carla',
    name: 'Carla Mendes',
    email: 'carla.mendes@nexo.com.br',
    role: 'employee',
    department: 'Comercial',
  },
  {
    id: 'rafael',
    name: 'Rafael Lima',
    email: 'rafael.lima@nexo.com.br',
    role: 'analyst',
    department: 'Suporte N1',
  },
  {
    id: 'marina',
    name: 'Marina Costa',
    email: 'marina.costa@nexo.com.br',
    role: 'analyst',
    department: 'Suporte N2',
  },
];
for (const employee of employees)
  await db.query('INSERT INTO employees VALUES($1,$2) ON CONFLICT DO NOTHING', [
    employee.id,
    JSON.stringify(employee),
  ]);
const now = new Date();
const ago = (hours: number) => new Date(now.getTime() - hours * 3600000).toISOString();
const seeds: Array<
  Partial<Ticket> & Pick<Ticket, 'id' | 'ownerId' | 'title' | 'category' | 'priority' | 'status'>
> = [
  {
    id: 'INC-20311',
    ownerId: 'ana',
    title: 'Notebook lento após atualização do Windows',
    category: 'Hardware',
    priority: 'Média',
    status: 'Aguardando analista',
    updatedAt: ago(144),
  },
  {
    id: 'REQ-10442',
    ownerId: 'ana',
    title: 'Segundo monitor para home office',
    category: 'Hardware',
    priority: 'Baixa',
    status: 'Aprovado',
    type: 'REQ',
    updatedAt: ago(168),
  },
  {
    id: 'INC-20150',
    ownerId: 'ana',
    title: 'Senha do SAP bloqueada',
    category: 'Acesso',
    priority: 'Média',
    status: 'Resolvido',
    resolvedAt: ago(96),
  },
  {
    id: 'INC-20298',
    ownerId: 'ana',
    title: 'Acesso à pasta Financeiro',
    category: 'Acesso',
    priority: 'Média',
    status: 'Em andamento',
  },
  {
    id: 'INC-19877',
    ownerId: 'ana',
    title: 'Outlook não sincroniza no celular',
    category: 'E-mail',
    priority: 'Média',
    status: 'Resolvido',
    resolvedAt: ago(720),
  },
  {
    id: 'INC-20400',
    ownerId: 'bruno',
    title: 'VPN não conecta',
    category: 'Rede e VPN',
    priority: 'Alta',
    status: 'Aberto',
  },
  {
    id: 'REQ-10450',
    ownerId: 'carla',
    title: 'Instalação de software de design',
    category: 'Software',
    priority: 'Baixa',
    status: 'Aberto',
    type: 'REQ',
  },
  {
    id: 'INC-20410',
    ownerId: 'carla',
    title: 'Equipe sem internet',
    category: 'Rede e VPN',
    priority: 'Crítica',
    status: 'Aguardando analista',
    updatedAt: ago(2),
  },
];
for (const seed of seeds) {
  const updatedAt = seed.updatedAt ?? ago(0.25);
  const ticket: Ticket = {
    description: seed.title,
    affected: 'Uma pessoa',
    type: 'INC',
    createdAt: ago(192),
    resolvedAt: null,
    history: [{ at: updatedAt, text: 'Dado fictício criado para demonstração.' }],
    ...seed,
    updatedAt,
    dueAt: dueDate(seed.priority, new Date(updatedAt)).toISOString(),
  };
  await db.query('INSERT INTO tickets VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [
    ticket.id,
    ticket.ownerId,
    JSON.stringify(ticket),
  ]);
}
const c: Conversation = {
  id: 'demo-ana',
  ownerId: 'ana',
  ownerName: 'Ana Souza',
  title: 'Notebook lento após atualização',
  mode: 'waiting',
  analystId: null,
  messageCount: 1,
  state: { lastTicketId: 'INC-20311' },
  summary: 'Ana relata notebook lento. INC-20311 está vencido; solicita atendimento humano.',
  createdAt: ago(0.5),
  updatedAt: ago(0.2),
  messages: [
    {
      id: 'demo-m1',
      role: 'user',
      text: 'Meu notebook continua lento. Como está o chamado INC-20311?',
      at: ago(0.5),
    },
    {
      id: 'demo-m2',
      role: 'assistant',
      text: 'O chamado INC-20311 está vencido. Encaminhei a conversa para um analista com o contexto do problema.',
      at: ago(0.2),
      decision: {
        intent: 'consulta',
        confidence: 1,
        actions: ['Consultou seus chamados', 'Verificou prazo', 'Transferiu para analista'],
        reason: 'Última atualização há seis dias; prazo de três dias úteis excedido.',
        rules: ['A: prazo', 'A: transferência'],
        engine: 'deterministic',
      },
    },
  ],
};
await db.query('INSERT INTO conversations VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [
  c.id,
  c.ownerId,
  JSON.stringify(c),
]);
await db.end();
console.log(
  'Banco exclusivo preparado; 5 funcionários, 8 chamados e 1 conversa de demonstração. Seed preserva registros existentes.',
);
