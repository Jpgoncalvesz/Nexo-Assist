'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileText,
  LogOut,
  MessageSquare,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import type { Conversation, Employee, Message, Ticket, Draft } from '@/lib/types';

type View = 'chat' | 'profile';
type Filter = 'all' | 'waiting' | 'agent' | 'mine';
const demoUsers = [
  ['ana.souza@nexo.com.br', 'Ana · colaboradora'],
  ['bruno.lima@nexo.com.br', 'Bruno · colaborador'],
  ['carla.mendes@nexo.com.br', 'Carla · colaboradora'],
  ['rafael.lima@nexo.com.br', 'Rafael · analista'],
];
const modeLabel: Record<Conversation['mode'], string> = {
  agent: 'Assistente atendendo',
  waiting: 'Aguardando analista',
  human: 'Atendimento humano',
  closed: 'Conversa encerrada',
};
function initials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0])
    .join('');
}
function date(value: string) {
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function time(value: string) {
  return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
async function api<T>(path: string, body?: object, method = 'POST'): Promise<T> {
  const response = await fetch(
    path,
    body
      ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { cache: 'no-store' },
  );
  const result: unknown = await response.json();
  if (!response.ok)
    throw new Error(
      typeof result === 'object' && result && 'error' in result
        ? String(result.error)
        : 'Não foi possível concluir. Tente novamente.',
    );
  return result as T;
}
function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? 'brand-light' : ''}`}>
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>Nexo Assist</span>
    </div>
  );
}
function Badge({ children, tone = '' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function TicketCard({ ticket, onSelect }: { ticket: Ticket; onSelect?: () => void }) {
  const overdue = !ticket.resolvedAt && new Date(ticket.dueAt).getTime() < Date.now();
  return (
    <article className="ticket-card">
      <div className="between">
        <span className="mono ticket-id">{ticket.id}</span>
        <Badge tone={overdue ? 'warning' : ''}>{ticket.status}</Badge>
      </div>
      <h3>{ticket.title}</h3>
      <p>{ticket.description}</p>
      <dl className="ticket-facts">
        <div>
          <dt>Categoria</dt>
          <dd>{ticket.category}</dd>
        </div>
        <div>
          <dt>Prioridade</dt>
          <dd>
            <span
              className={`priority-dot ${ticket.priority === 'Crítica' || ticket.priority === 'Alta' ? 'high' : ''}`}
            />
            {ticket.priority}
          </dd>
        </div>
        <div>
          <dt>Última atualização</dt>
          <dd>{date(ticket.updatedAt)}</dd>
        </div>
        <div>
          <dt>Prazo</dt>
          <dd className={overdue ? 'warning-text' : ''}>
            {date(ticket.dueAt)}
            {overdue ? ' · vencido' : ''}
          </dd>
        </div>
      </dl>
      {onSelect && (
        <button className="button secondary small" onClick={onSelect}>
          Consultar chamado <ArrowRight size={14} />
        </button>
      )}
    </article>
  );
}
function DraftCard({
  draft,
  active,
  busy,
  send,
}: {
  draft: Draft;
  active: boolean;
  busy: boolean;
  send: (text: string) => void;
}) {
  return (
    <article className="ticket-card draft-card">
      <div className="between">
        <span className="eyebrow">
          {draft.operation === 'create'
            ? 'Novo chamado'
            : draft.operation === 'reopen'
              ? 'Reabrir chamado'
              : 'Atualizar chamado'}
        </span>
        <Badge tone={active ? 'warning' : ''}>
          {active ? 'Aguardando confirmação' : 'Rascunho registrado'}
        </Badge>
      </div>
      <h3>{draft.title}</h3>
      <p>{draft.description}</p>
      <dl className="ticket-facts">
        <div>
          <dt>Categoria</dt>
          <dd>{draft.category}</dd>
        </div>
        <div>
          <dt>Prioridade</dt>
          <dd>
            <span
              className={`priority-dot ${draft.priority === 'Alta' || draft.priority === 'Crítica' ? 'high' : ''}`}
            />
            {draft.priority}
          </dd>
        </div>
        <div>
          <dt>Afetados</dt>
          <dd>{draft.affected}</dd>
        </div>
        <div>
          <dt>Tipo</dt>
          <dd>{draft.type === 'INC' ? 'Incidente' : 'Requisição'}</dd>
        </div>
      </dl>
      {active && (
        <div className="actions">
          <button disabled={busy} className="button small" onClick={() => send('Confirmar')}>
            <Check size={14} />
            Confirmar
          </button>
          <button disabled={busy} className="button secondary small" onClick={() => send('Editar')}>
            Editar
          </button>
          <button disabled={busy} className="button ghost small" onClick={() => send('Cancelar')}>
            Cancelar
          </button>
        </div>
      )}
    </article>
  );
}
function MessageItem({
  message,
  active,
  busy,
  send,
}: {
  message: Message;
  active: boolean;
  busy: boolean;
  send: (text: string) => void;
}) {
  if (message.role === 'system')
    return (
      <div className="system-message">
        <ShieldCheck size={13} />
        {message.text}
      </div>
    );
  const incoming = message.role !== 'user';
  return (
    <div className={`message ${incoming ? 'incoming' : 'outgoing'}`}>
      {incoming && (
        <div className="message-author">
          <span className={`mini-avatar ${message.role === 'analyst' ? 'human-avatar' : ''}`}>
            {message.role === 'analyst' ? <UserRound size={13} /> : <Sparkles size={13} />}
          </span>
          {message.role === 'analyst' ? 'Analista de TI' : 'Nexo Assist'}
          {message.role === 'analyst' && <Badge tone="success">Suporte humano</Badge>}
        </div>
      )}
      <div className="bubble">
        {message.decision && (
          <div className="tool-labels">
            {message.decision.actions.map((action, i) => (
              <span key={i}>
                <Check size={12} />
                {action}
              </span>
            ))}
          </div>
        )}
        <p className="message-text">{message.text}</p>
        {message.tickets?.map((ticket) => (
          <TicketCard
            key={ticket.id}
            ticket={ticket}
            onSelect={active ? () => send(ticket.id) : undefined}
          />
        ))}
        {message.draft && (
          <DraftCard draft={message.draft} active={active} busy={busy} send={send} />
        )}
        {active && !!message.options?.length && (
          <div className="options">
            {message.options.map((option, i) => (
              <button className="option" key={option} disabled={busy} onClick={() => send(option)}>
                <span>{i + 1}</span>
                {option}
              </button>
            ))}
          </div>
        )}
        {message.decision && (
          <details className="decision">
            <summary>
              <ShieldCheck size={13} />
              Entenda esta decisão <span>{Math.round(message.decision.confidence * 100)}%</span>
            </summary>
            <div>
              <p>{message.decision.reason}</p>
              <dl>
                <dt>Intenção</dt>
                <dd>{message.decision.intent}</dd>
                <dt>Regras consultadas</dt>
                <dd>{message.decision.rules.join(' · ') || 'Fluxo de atendimento'}</dd>
                <dt>Motor</dt>
                <dd>
                  {message.decision.engine === 'ollama'
                    ? `LLM local · ${message.decision.model}`
                    : 'Regras determinísticas'}{' '}
                  — confiança heurística
                </dd>
                {message.decision.interpretation && (
                  <>
                    <dt>Interpretação</dt>
                    <dd>{message.decision.interpretation}</dd>
                  </>
                )}
              </dl>
            </div>
          </details>
        )}
      </div>
      <time className="message-time" dateTime={message.at}>
        {time(message.at)}
      </time>
    </div>
  );
}

export default function Home() {
  const [user, setUser] = useState<Employee | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState(demoUsers[0][0]);
  const [password, setPassword] = useState('nexo-demo');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [view, setView] = useState<View>('chat');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selectedRef = useRef<string | null>(null);
  const refreshing = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const analyst = user?.role === 'analyst';
  const choose = useCallback((id: string) => {
    selectedRef.current = id;
    setSelected(id);
    setConversation(null);
    setText('');
    setView('chat');
  }, []);

  useEffect(() => {
    api<{ user: Employee | null }>('/api/me')
      .then((r) => setUser(r.user))
      .catch((e) => setError(String(e.message)))
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void api<{ conversations: Conversation[] }>('/api/conversations')
      .then(async (r) => {
        if (cancelled) return;
        setConversations(r.conversations);
        if (r.conversations.length) choose(r.conversations[0].id);
        else if (user.role === 'employee') {
          const fresh = await api<{ conversation: Conversation }>('/api/conversations', {});
          if (!cancelled) {
            setConversations([fresh.conversation]);
            choose(fresh.conversation.id);
          }
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e.message));
      });
    return () => {
      cancelled = true;
    };
  }, [user, choose]);

  const refresh = useCallback(async () => {
    if (!user || refreshing.current) return;
    refreshing.current = true;
    try {
      const listing = await api<{ conversations: Conversation[] }>('/api/conversations');
      setConversations(listing.conversations);
      const id = selectedRef.current;
      if (id) {
        const detail = await api<{ conversation: Conversation }>(`/api/conversations/${id}`);
        if (selectedRef.current === id) setConversation(detail.conversation);
        if (user.role === 'analyst') {
          const history = await api<{ tickets: Ticket[] }>(
            `/api/tickets?ownerId=${encodeURIComponent(detail.conversation.ownerId)}`,
          );
          if (selectedRef.current === id) setTickets(history.tickets);
        }
      }
    } finally {
      refreshing.current = false;
    }
  }, [user]);
  useEffect(() => {
    if (selected) void refresh().catch((e) => setError(String(e.message)));
  }, [selected, refresh]);
  useEffect(() => {
    if (
      !user ||
      view !== 'chat' ||
      (!analyst && conversation?.mode !== 'waiting' && conversation?.mode !== 'human')
    )
      return;
    const interval = setInterval(() => {
      if (!busy && document.visibilityState === 'visible')
        void refresh().catch((e) => setError(String(e.message)));
    }, 2500);
    return () => clearInterval(interval);
  }, [user, view, busy, refresh, analyst, conversation?.mode]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conversation?.messages.length, selected]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ user: Employee }>('/api/login', { email, password });
      setUser(result.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao entrar.');
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await api('/api/logout', {});
      setUser(null);
      setSelected(null);
      selectedRef.current = null;
      setConversation(null);
      setConversations([]);
      setTickets([]);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao sair.');
    } finally {
      setBusy(false);
    }
  }
  async function newConversation() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ conversation: Conversation }>('/api/conversations', {});
      choose(result.conversation.id);
      setConversations((prev) => [result.conversation, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao iniciar conversa.');
    } finally {
      setBusy(false);
    }
  }
  async function send(value: string) {
    const id = selectedRef.current;
    if (!id || busy || !value.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ conversation: Conversation }>(
        `/api/conversations/${id}/messages`,
        { text: value.trim(), requestId: crypto.randomUUID() },
      );
      if (selectedRef.current === id) {
        setConversation(result.conversation);
        setText('');
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao enviar. Sua mensagem foi preservada.');
    } finally {
      setBusy(false);
    }
  }
  async function action(value: 'claim' | 'release' | 'close') {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/conversations/${selected}/action`, { action: value });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha na ação.');
    } finally {
      setBusy(false);
    }
  }
  const errorBanner = error && (
    <div className="error-banner" role="alert">
      <span>{error}</span>
      <button aria-label="Fechar aviso" onClick={() => setError('')}>
        <X size={16} />
      </button>
    </div>
  );
  if (checking)
    return (
      <main className="loading-screen">
        <Brand />
        <p>Preparando seu atendimento…</p>
      </main>
    );
  if (!user)
    return (
      <main className="login-page">
        <section className="showcase">
          <Brand light />
          <div className="showcase-story">
            <div className="kicker">Service desk de TI da Nexo</div>
            <h1>
              Seu problema de TI,
              <br />
              resolvido em uma conversa.
            </h1>
            <p className="showcase-description">
              Descreva o que está acontecendo. O assistente consulta seus chamados, busca na central
              de ajuda e chama um analista quando precisa.
            </p>
            <div className="preview-chat" aria-label="Exemplo ilustrativo de atendimento">
              <div className="preview-user">Meu notebook não conecta na VPN. Erro 809.</div>
              <div className="preview-author">
                <Sparkles size={16} />
                Nexo Assist
              </div>
              <div className="preview-tools">
                <Check size={13} />
                consulta chamados · verifica a central de ajuda
              </div>
              <p>
                Vamos verificar o que aconteceu e preparar seu chamado. Você confere tudo antes de
                confirmar.
              </p>
              <div className="preview-ticket">
                <FileText size={18} />
                <div>
                  <strong>Rede e VPN</strong>
                  <small>Classificação e decisões visíveis</small>
                </div>
                <ChevronRight size={17} />
              </div>
            </div>
          </div>
          <div className="showcase-stats">
            <div>
              <strong>01</strong>
              <span>uma conversa para começar</span>
            </div>
            <div>
              <strong>100%</strong>
              <span>dados de demonstração</span>
            </div>
            <div>
              <strong>Você</strong>
              <span>confirma cada alteração</span>
            </div>
          </div>
        </section>
        <section className="signin">
          <div className="signin-help">
            <CircleHelp size={15} />
            Ambiente local de demonstração
          </div>
          <div className="signin-center">
            <h2>Entrar</h2>
            <p>Use uma identidade de demonstração para conhecer o service desk.</p>
            <form onSubmit={login}>
              <label htmlFor="email">E-mail corporativo</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <label htmlFor="password">Senha de demonstração</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="field-hint">Qualquer senha não vazia. Não use sua senha real.</p>
              {errorBanner}
              <button className="button login-submit" disabled={busy} type="submit">
                {busy ? 'Entrando…' : 'Entrar'}
                <ArrowRight size={17} />
              </button>
            </form>
            <div className="demo-identities">
              <span>EXPLORE COMO</span>
              <div>
                {demoUsers.map(([value, name]) => (
                  <button
                    type="button"
                    key={value}
                    className={email === value ? 'selected' : ''}
                    onClick={() => setEmail(value)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
            <div className="simulation-note">
              <ShieldCheck size={15} />
              <span>
                Dados fictícios. Interpretação por IA local quando habilitada; ações validadas pelas
                regras do service desk.
              </span>
            </div>
          </div>
          <footer>
            © 2026 Nexo · Service desk de TI<span>Projeto demonstrativo</span>
          </footer>
        </section>
      </main>
    );

  const canReply =
    conversation &&
    conversation.mode !== 'closed' &&
    (!analyst || (conversation.mode === 'human' && conversation.analystId === user.id));
  const limit = !analyst && !!conversation && conversation.messageCount >= 30;
  const visibleConversations = conversations.filter(
    (c) =>
      (filter === 'all' ||
        (filter === 'waiting' && c.mode === 'waiting') ||
        (filter === 'agent' && c.mode === 'agent') ||
        (filter === 'mine' && c.analystId === user.id)) &&
      `${c.ownerName} ${c.title} ${c.messages.map((m) => m.text).join(' ')}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const profile = (
    <section className="profile">
      <h1>Meu perfil</h1>
      <p>Seus dados de acesso ao service desk de TI.</p>
      <div className="profile-fields">
        <label>
          Nome
          <input value={user.name} readOnly />
        </label>
        <label>
          E-mail corporativo
          <input value={user.email} readOnly />
          <small>Gerenciado pela TI</small>
        </label>
        <label>
          Departamento
          <input value={user.department} readOnly />
        </label>
        <label>
          Perfil
          <input value={analyst ? 'Analista de suporte' : 'Colaborador'} readOnly />
        </label>
        <div className="simulation-note">
          <ShieldCheck size={16} />
          Identidade simulada. Não há senha corporativa cadastrada ou e-mail de recuperação neste
          ambiente.
        </div>
      </div>
    </section>
  );
  const messages = (
    <>
      <div className="messages" aria-live="polite" aria-relevant="additions">
        {conversation ? (
          conversation.messages.length ? (
            conversation.messages.map((message, i) => (
              <MessageItem
                key={message.id}
                message={message}
                active={
                  !analyst &&
                  conversation.mode === 'agent' &&
                  i === conversation.messages.length - 1
                }
                busy={busy}
                send={(value) => void send(value)}
              />
            ))
          ) : (
            <div className="empty-conversation">
              <span className="welcome-icon">
                <Sparkles size={25} />
              </span>
              <h1>Olá, {user.name.split(' ')[0]}.</h1>
              <p>Como posso ajudar com seu TI hoje?</p>
              <div className="starter-options">
                {[
                  'Meu notebook não conecta na VPN. Erro 809.',
                  'Quero consultar meus chamados',
                  'Preciso de acesso a um sistema',
                ].map((option) => (
                  <button key={option} onClick={() => void send(option)} disabled={busy}>
                    {option}
                    <ArrowRight size={16} />
                  </button>
                ))}
              </div>
            </div>
          )
        ) : (
          <div className="empty-conversation">
            <MessageSquare size={30} />
            <h2>{analyst ? 'Selecione uma conversa' : 'Carregando atendimento…'}</h2>
            <p>{analyst ? 'O histórico completo e as decisões aparecem aqui.' : ''}</p>
          </div>
        )}
        <div ref={end} />
      </div>
      {conversation?.mode === 'waiting' && (
        <div className="handoff-note">
          <Clock3 size={16} />
          Conversa encaminhada. O assistente está pausado enquanto aguarda um analista.
        </div>
      )}
      {conversation?.mode === 'human' && (
        <div className="handoff-note human-note">
          <UserRound size={16} />
          {analyst
            ? 'Atendimento humano · o assistente está pausado'
            : 'Um analista assumiu esta conversa.'}
        </div>
      )}
      {analyst && conversation && (
        <div className="analyst-actions">
          <span>
            {conversation.mode === 'human'
              ? conversation.analystId === user.id
                ? 'Você está atendendo'
                : 'Em atendimento por outro analista'
              : modeLabel[conversation.mode]}
          </span>
          <div className="actions">
            {conversation.mode === 'waiting' && (
              <button className="button small" disabled={busy} onClick={() => void action('claim')}>
                Assumir atendimento
              </button>
            )}
            {conversation.mode === 'human' && conversation.analystId === user.id && (
              <>
                <button
                  className="button secondary small"
                  disabled={busy}
                  onClick={() => void action('release')}
                >
                  Devolver ao assistente
                </button>
                <button
                  className="button ghost danger-text small"
                  disabled={busy}
                  onClick={() => void action('close')}
                >
                  Encerrar atendimento
                </button>
              </>
            )}
          </div>
        </div>
      )}
      <div className="composer-area">
        {errorBanner}
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send(text);
          }}
        >
          <textarea
            aria-label="Mensagem"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (canReply && !limit) void send(text);
              }
            }}
            maxLength={4000}
            disabled={!canReply || !!limit}
            placeholder={
              !canReply
                ? analyst
                  ? 'Assuma o atendimento para responder'
                  : 'Conversa encerrada. Inicie uma nova conversa.'
                : limit
                  ? 'Limite de mensagens atingido.'
                  : analyst
                    ? 'Escreva para o colaborador…'
                    : 'Escreva para o Nexo…'
            }
            rows={2}
          />
          <button
            className="button small"
            type="submit"
            disabled={busy || !text.trim() || !canReply || !!limit}
          >
            {busy ? 'Enviando…' : 'Enviar'}
            <Send size={14} />
          </button>
        </form>
        <div className="composer-meta">
          <span>
            {conversation ? `${conversation.messageCount}/30 mensagens nesta sessão` : ''}
          </span>
          <span>Decisões rastreáveis · você confirma as alterações</span>
        </div>
      </div>
    </>
  );

  if (analyst)
    return (
      <main className="analyst-shell">
        <aside className="rail">
          <span className="brand-mark" title="Nexo Assist">
            <i />
            <i />
            <i />
          </span>
          <button
            aria-label="Conversas"
            title="Conversas"
            className={view === 'chat' ? 'active' : ''}
            onClick={() => setView('chat')}
          >
            <MessageSquare size={21} />
          </button>
          <span className="rail-spacer" />
          <button
            className="avatar"
            aria-label="Meu perfil"
            title="Meu perfil"
            onClick={() => setView('profile')}
          >
            {initials(user.name)}
          </button>
          <button aria-label="Sair" title="Sair" onClick={() => void logout()}>
            <LogOut size={19} />
          </button>
        </aside>
        <aside className="conversation-list">
          <header>
            <div className="between">
              <h1>Conversas</h1>
              <Badge tone="success">
                <span className="status-dot" />
                Disponível
              </Badge>
            </div>
            <label className="search">
              <Search size={15} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Pesquisar conversa ou chamado"
                aria-label="Pesquisar conversa ou chamado"
              />
            </label>
            <nav className="filter-tabs" aria-label="Filtrar conversas">
              {(
                [
                  ['all', 'Todas'],
                  ['waiting', 'Para você'],
                  ['agent', 'Com o assistente'],
                  ['mine', 'Minhas'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={filter === value ? 'active' : ''}
                >
                  {label}
                </button>
              ))}
            </nav>
          </header>
          <div className="conversation-items">
            {visibleConversations.map((c) => (
              <button
                className={`conversation-item ${selected === c.id ? 'selected' : ''}`}
                key={c.id}
                onClick={() => choose(c.id)}
              >
                <span className="avatar">{initials(c.ownerName)}</span>
                <div>
                  <div className="between">
                    <strong>{c.ownerName}</strong>
                    <time>{time(c.updatedAt)}</time>
                  </div>
                  <p>{c.messages.at(-1)?.text || c.title}</p>
                  <small
                    className={
                      c.mode === 'waiting'
                        ? 'warning-text'
                        : c.mode === 'human'
                          ? 'primary-text'
                          : ''
                    }
                  >
                    {modeLabel[c.mode]}
                  </small>
                </div>
              </button>
            ))}
            {!visibleConversations.length && (
              <p className="empty-list">Nenhuma conversa neste filtro.</p>
            )}
          </div>
          <footer>
            <ShieldCheck size={13} />
            Console demonstrativo
          </footer>
        </aside>
        <section className="analyst-conversation">
          <header className="topbar">
            <div className="avatar">{initials(conversation?.ownerName || user.name)}</div>
            <div>
              <strong>{conversation?.ownerName || 'Console do analista'}</strong>
              <small>{conversation ? modeLabel[conversation.mode] : 'Atendimento de TI'}</small>
            </div>
          </header>
          {view === 'profile' ? profile : messages}
        </section>
        {view === 'chat' && (
          <aside className="ticket-history">
            <header>
              <h2>Chamados {conversation ? `de ${conversation.ownerName.split(' ')[0]}` : ''}</h2>
              <small>
                {tickets.filter((t) => !t.resolvedAt).length} abertos ·{' '}
                {tickets.filter((t) => t.resolvedAt).length} encerrados
              </small>
            </header>
            <div className="ticket-history-body">
              {conversation?.summary && (
                <div className="handoff-summary">
                  <h3>Contexto da transferência</h3>
                  <p>{conversation.summary}</p>
                </div>
              )}
              {tickets.map((ticket) => (
                <TicketCard ticket={ticket} key={ticket.id} />
              ))}
              {!tickets.length && <p className="empty-list">Nenhum chamado para esta pessoa.</p>}
            </div>
          </aside>
        )}
      </main>
    );
  return (
    <main className="employee-shell">
      <aside className="sidebar">
        <Brand />
        <nav>
          <button className={view === 'chat' ? 'active' : ''} onClick={() => setView('chat')}>
            <MessageSquare size={17} />
            Atendimento
          </button>
          <button className={view === 'profile' ? 'active' : ''} onClick={() => setView('profile')}>
            <UserRound size={17} />
            Meu perfil
          </button>
        </nav>
        <div className="sidebar-conversations">
          <button className="new-chat" disabled={busy} onClick={() => void newConversation()}>
            <Plus size={15} />
            Nova conversa
          </button>
          {conversations.slice(0, 8).map((c) => (
            <button
              key={c.id}
              title={c.title}
              className={selected === c.id && view === 'chat' ? 'selected' : ''}
              onClick={() => choose(c.id)}
            >
              <MessageSquare size={13} />
              <span>{c.title || 'Atendimento de TI'}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-spacer" />
        <div className="sidebar-user">
          <span className="avatar">{initials(user.name)}</span>
          <div>
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </div>
        </div>
        <button className="logout" disabled={busy} onClick={() => void logout()}>
          <LogOut size={16} />
          Sair
        </button>
      </aside>
      <section className="employee-main">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Service desk de TI</span>
            <ChevronRight size={14} />
            <strong>{view === 'chat' ? 'Atendimento' : 'Meu perfil'}</strong>
          </div>
          <Badge tone={conversation?.mode === 'waiting' ? 'warning' : 'success'}>
            <span className="status-dot" />
            {conversation && view === 'chat' ? modeLabel[conversation.mode] : 'Ambiente simulado'}
          </Badge>
        </header>
        {view === 'profile' ? profile : <div className="employee-chat">{messages}</div>}
      </section>
    </main>
  );
}
