# Validação executada em 16/11/2026

Ambiente: Windows, Node 24.22.0, PostgreSQL 18.6 local, Next.js 16.4.6, React 19.3.1 e LangGraph 1.7.4. Dependências fixadas pelo package-lock.json; instalação reproduzível com npm ci.

## Resultados observados

- TypeScript estrito: passou.
- Prettier: todos os arquivos verificados formatados.
- Vitest: 25 testes passaram (19 agente e 6 SLA).
- Serviço HTTP com PostgreSQL: 16 assertions passaram, incluindo isolamento e idempotência.
- Playwright/Edge: 3 cenários completos passaram na versão de produção; cenário adicional de abertura confirmada e console passou separadamente.
- Build de produção: passou.
- Reinício dos dois processos (desenvolvimento para produção): hash de 13 registros de conversas e chamados idêntico. Não foi reiniciado o serviço Windows PostgreSQL.
- npm audit --omit=dev: zero vulnerabilidades reportadas na execução. Isso não é garantia permanente.
- Capturas login, chat desktop/celular, rascunho e console em docs/*.png. Login e chat móvel inspecionados visualmente; layout sem rolagem horizontal no teste de 390px.

## Correções da revisão

Corrigida rejeição indevida do login causada pela normalização de origem no Next.js. Mantida rejeição de origem externa. Corrigidos botão de assumir fora da fila e limite de mensagens na interface. Melhorada equivalência de alguns problemas recorrentes na deduplicação.

Código formatado com indentação de dois espaços, EditorConfig e Prettier. Listagem usa resumo da última mensagem em vez do histórico completo. Atualizações automáticas limitadas ao console e transferência humana, suspensas em aba oculta e protegidas contra sobreposição. Índices adicionados para e-mail, expiração de sessões e ordenação de conversas.

## Limites da validação

Não houve teste de carga, auditoria externa de segurança ou avaliação com LLM. O motor é determinístico e sua confiança é heurística. A correspondência de problemas pode falhar em paráfrases não previstas. Autenticação é demonstrativa. Datas úteis não consideram feriados. Não houve deploy/GitHub. Interface tem aproximação do protótipo, sem comparação pixel a pixel.

Os testes E2E deixam conversas fictícias no banco para inspeção; o seed não apaga esses dados.
