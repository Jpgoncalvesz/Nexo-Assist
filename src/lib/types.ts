export type Role = 'employee' | 'analyst';
export type Mode = 'agent' | 'waiting' | 'human' | 'closed';
export type Priority = 'Crítica' | 'Alta' | 'Média' | 'Baixa';
export type Category = 'Acesso' | 'Rede e VPN' | 'Hardware' | 'Software' | 'E-mail' | 'Outros';
export interface Employee {
  id: string;
  name: string;
  email: string;
  role: Role;
  department: string;
}
export interface Ticket {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  type: 'INC' | 'REQ';
  category: Category;
  priority: Priority;
  affected: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  dueAt: string;
  history: { at: string; text: string }[];
}
export interface Draft {
  operation: 'create' | 'update' | 'reopen';
  ticketId?: string;
  title: string;
  description: string;
  type: 'INC' | 'REQ';
  category: Category;
  priority: Priority;
  affected: string;
  key: string;
}
export interface Decision {
  intent: string;
  confidence: number;
  actions: string[];
  reason: string;
  rules: string[];
  engine: 'deterministic' | 'ollama';
  model?: string;
  interpretation?: string;
  elapsedMs?: number;
}
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'analyst' | 'system';
  text: string;
  at: string;
  decision?: Decision;
  tickets?: Ticket[];
  draft?: Draft;
  options?: string[];
}
export interface AgentState {
  stage?: 'impact' | 'urgency' | 'confirm' | 'os';
  description?: string;
  affected?: string;
  urgency?: string;
  draft?: Draft;
  lastTicketId?: string;
  failures?: number;
}
export interface Conversation {
  id: string;
  ownerId: string;
  ownerName: string;
  title: string;
  mode: Mode;
  analystId: string | null;
  messages: Message[];
  state: AgentState;
  messageCount: number;
  summary: string;
  createdAt: string;
  updatedAt: string;
}
export interface TicketGateway {
  list(ownerId: string): Promise<Ticket[]>;
  get(ownerId: string, id: string): Promise<Ticket | null>;
  commit(ownerId: string, draft: Draft): Promise<Ticket>;
  transfer(ownerId: string, id: string, summary: string): Promise<Ticket>;
}
export interface AgentResult {
  state: AgentState;
  message: Omit<Message, 'id' | 'at' | 'role'>;
  mode?: Mode;
  summary?: string;
}
