# Rastreabilidade PRD v5

| Requisito          | Implementação                                       | Evidência                        |
| ------------------ | --------------------------------------------------- | -------------------------------- |
| Login fictício     | API login, contas seed, cookie de sessão            | E2E autenticação                 |
| Chat e confirmação | UI rascunho e opções, state confirm                 | testes agent                     |
| Tipagem estrita    | tsconfig strict, contratos compartilhados           | typecheck e build                |
| Orquestração       | LangGraph classificar/aplicar_regras/responder      | teste invoca grafo               |
| LLM                | Substituído por motor determinístico autorizado     | Limitação explícita no README    |
| Serviço separado   | HTTP processo 4311, cliente com timeout             | 16 assertions integração         |
| Persistência       | PostgreSQL, estado/mensagens/decisões JSONB         | comparação de hash após reinício |
| Privacidade        | Sessão → owner validado → serviço escopado          | E2E e integração                 |
| Duplicidade        | heurísticas + lock + idempotência                   | testes agent/serviço             |
| Reabertura 7 dias  | elegibilidade validada no motor e no commit         | testes agent/serviço             |
| SLA                | relógio útil São Paulo, 1h crítica corrida          | 6 testes SLA                     |
| Transferência      | pedido, crítico, vencido, baixa confiança           | testes agent                     |
| Agente pausado     | servidor não chama motor em waiting/human           | E2E                              |
| Console            | fila, filtros, assumir/devolver/encerrar, histórico | E2E API e telas                  |
| Central            | artigos locais, condições Windows 10/11             | testes agent                     |
| Limite 30          | validado sob lock no servidor                       | E2E                              |
| Indisponibilidade  | retry limitado, contexto e key preservados          | testes agent/cliente             |
| Escopo TI          | redirecionamento de assuntos conhecidos             | testes agent                     |
| Fidelidade visual  | fontes, cores, colunas e estados do nexo.pen        | capturas docs                    |
| Publicação         | Não realizada, conforme autorização local           | sem remoto                       |
