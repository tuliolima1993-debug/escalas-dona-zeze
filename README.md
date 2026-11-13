# Dona Zezé Conde | Gestão de Escalas

Sistema web para gerar, ajustar, publicar, imprimir e acompanhar as escalas de trabalho aos sábados do **Cultivo Dona Zezé Conde**.

React + TypeScript + Vite · Tailwind CSS + componentes no padrão shadcn/ui (Radix) · Lucide · Supabase (PostgreSQL, Auth, RLS) · Netlify · jsPDF · date-fns (pt-BR) · Recharts · Vitest.

---

## 1. Arquitetura

```
src/
  domain/                 Regras de negócio puras (sem React, sem banco) — 100% testadas
    types.ts              Modelo de domínio
    dates.ts              Sábados do mês, formatação pt-BR
    eligibility.ts        Disponibilidade (situação, admissão, afastamentos, sábados específicos)
    scheduler.ts          Motor de geração (determinístico, pontuação transparente)
    validate.ts           Restrições obrigatórias × preferências, contagem por atividade
    mutations.ts          Edição manual (troca, mover, substituir, reservar, bloquear, publicar)
    stats.ts              Frequência, KPIs e históricos calculados dos registros
    generate-input.ts     Monta a entrada do motor a partir dos dados salvos
  data/
    repository.ts         Contrato único da camada de dados
    supabaseRepository.ts Produção (Supabase + RPCs transacionais)
    demoRepository.ts     Modo demonstração (mesmas regras, dados no navegador)
    DataProvider.tsx      Estado global, permissões, mês selecionado
  features/               Telas: dashboard, schedule, employees, reports, print, settings, history, users, auth
  components/             UI (button, card, dialog, form, tabs, menu…) e layout
supabase/migrations/      Esquema, funções/gatilhos, RLS e dados iniciais (versionados)
netlify/functions/        invite-user (usa a service_role apenas no servidor)
tests/                    Motor, banco (PGlite + migrations reais) e impressão
```

**Decisões técnicas (resumo)**

- **Motor determinístico em 3 fases** (`scheduler.ts`): (A) atividades obrigatórias resolvidas por emparelhamento com caminhos aumentantes — se existe uma cobertura possível de Clonagem, ela é encontrada; (B) preenchimento pela menor pontuação; (C) trocas entre sábados que reduzem sábados consecutivos, intervalos curtos e duplas repetidas. Nada de sorteio: desempates usam um hash estável (varia de mês para mês, mas a mesma entrada sempre gera a mesma escala).
- **Pontuação transparente**: `100 × sábados no mês + 12 × desvio do histórico (±2) + 30 × consecutivo + 6 × semanas abaixo do intervalo + 2 × dupla repetida` (prioridade alta). O peso do mês supera a soma dos demais, garantindo diferença máxima de 1 entre elegíveis; o histórico decide quem recebe a participação a menos, compensando nos meses seguintes. Cada nome na prévia mostra o motivo da escolha.
- **Regras no backend também**: limite de transporte, duplicidade, habilidade × atividade, sábados bloqueados, escala encerrada e bloqueio de publicação com restrição obrigatória violada são garantidos por constraints e gatilhos no PostgreSQL — não apenas na interface.
- **Operações atômicas** (RPC `commit_month`, `swap_assignments`, `replace_assignment`…): ou tudo é salvo, ou nada — sem escala pela metade em falha de conexão.
- **Histórico**: gatilho de auditoria grava usuário, data/hora, versão anterior e atual de cada registro.
- **Substituição preserva histórico**: o registro original fica com situação “substituído” e aponta para o novo.
- **Impressão fiel**: a prévia HTML, a impressão do navegador e o PDF usam o mesmo cálculo de layout (milímetros/pontos). A fonte dos nomes é ajustada para caber; testes garantem que nada é cortado em A4 e A3 com 4 ou 5 sábados.
- **Dados sensíveis separados**: restrições e observações internas ficam na tabela `employee_private`, invisível ao perfil visualizador (RLS). A impressão nunca as inclui.
- **Modo demonstração**: permite avaliar tudo sem criar o Supabase (`VITE_DATA_MODE=demo`).

## 2. Executar localmente

Requisitos: Node.js 20+.

```bash
npm install
npm run dev            # sem variáveis → abre em modo demonstração
npm test               # 31 testes: motor, banco (migrations reais em PGlite) e impressão
npm run build          # build de produção
```

## 3. Configurar o Supabase

1. Crie um projeto em <https://supabase.com> (região São Paulo, de preferência).
2. **Aplique as migrations** — escolha uma opção:
   - *Supabase CLI*: `npx supabase link --project-ref SEU_REF` e `npx supabase db push`.
   - *Painel*: SQL Editor → cole e execute, nesta ordem, os arquivos de `supabase/migrations/`.
3. **Authentication → Providers → Email**: mantenha habilitado. Em **Authentication → Sign In / Up**, **desative “Allow new users to sign up”** (somente convites).
4. **Authentication → URL Configuration**: em *Site URL* coloque o endereço do Netlify (ex.: `https://escalas-dzc.netlify.app`).
5. **Primeiro administrador**: Authentication → Users → *Add user* (e-mail + senha, marque *Auto Confirm*). O **primeiro usuário criado vira administrador** automaticamente. Os demais são convidados pela tela **Usuários** do sistema.
6. Copie em **Project Settings → API** a *Project URL* e a *anon public key*.

## 4. Variáveis de ambiente

Crie `.env` (local) a partir de `.env.example`:

```
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anon
VITE_DATA_MODE=supabase
```

A chave *anon* é pública por design — a proteção vem das políticas RLS.
**Nunca** coloque a `service_role` em variáveis `VITE_`.

## 5. Publicar no Netlify

1. Envie o projeto para um repositório (GitHub/GitLab) e em Netlify: *Add new site → Import an existing project*.
   O `netlify.toml` já define build (`npm run build`), pasta `dist`, funções e redirecionamento SPA.
2. Em **Site configuration → Environment variables** cadastre:

| Variável | Valor | Uso |
|---|---|---|
| `VITE_SUPABASE_URL` | Project URL | navegador |
| `VITE_SUPABASE_ANON_KEY` | anon public key | navegador |
| `VITE_DATA_MODE` | `supabase` | navegador |
| `SUPABASE_URL` | Project URL | função de convite (servidor) |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key | função de convite (servidor, **secreta**) |

3. *Deploy*. Acesse, entre com o administrador e convide os demais usuários.

> Alternativa sem Git: `npm run build` e arraste a pasta `dist` em *Netlify → Deploy manually* (nesse caso a função de convite não é publicada; convide usuários pelo painel do Supabase e ajuste o perfil na tela Usuários).

## 6. Perfis de acesso

| Perfil | Pode |
|---|---|
| Administrador | tudo: colaboradores, setores, habilidades, configurações, escalas, usuários |
| Supervisor | gerar, editar, confirmar, publicar e encerrar escalas; presença; indisponibilidades; histórico |
| Visualizador | consultar escalas publicadas/encerradas e imprimir |

## 7. Fluxo de uso

1. **Colaboradores** — cadastre/atualize pessoas, habilidades e indisponibilidades.
2. **Escalas** — escolha o mês → **Gerar escala** → ajuste parâmetros → **Gerar prévia**.
3. Confira a prévia (motivo de cada escolha, alertas, distribuição) → **Confirmar e salvar**.
4. Ajuste manualmente: arraste um nome sobre outro para **trocar**, sobre outro cartão para **mover**; menu “⋯” para substituir, alterar atividade, reservar vaga, bloquear sábado.
5. Resolva alertas → **Confirmar e publicar** (bloqueado se houver restrição obrigatória não atendida).
6. **Impressão** → A4/A3 → *Visualizar*, *Imprimir* ou *Exportar PDF*.
7. Após cada sábado: **Escalas → Presença** (✓ presente, ✕ ausente, registrar substituto).
8. **Frequência** — comparativos, gráficos, exportação CSV/Excel. **Encerrar mês** ao final.

## 8. Cobertura de testes (cenários exigidos)

| # | Cenário | Teste |
|---|---|---|
| 1 | Mês com 4 sábados (7×2 + 2×1) | `scheduler.test.ts` |
| 2 | Mês com 5 sábados | `scheduler.test.ts` |
| 3 | Colaboradores insuficientes | `scheduler.test.ts` |
| 4 | Todos os habilitados para clonagem indisponíveis | `scheduler.test.ts` |
| 5 | Pessoa com várias habilidades | `scheduler.test.ts` |
| 6 | Troca Marcelo (28/11) ↔ Edna (14/11) | `scheduler.test.ts`, `database.test.ts` |
| 7 | Regeração parcial com sábados bloqueados | `scheduler.test.ts` |
| 8 | Duas participações no mês sem consecutivos | `scheduler.test.ts` |
| 9 | Equilíbrio entre meses | `scheduler.test.ts` |
| 10 | Novos colaboradores | `scheduler.test.ts` |
| 11 | Vaga reservada preenchida depois | `scheduler.test.ts` |
| 12 | Limite de 4 passageiros | `scheduler.test.ts`, `database.test.ts` |
| 13 | Ausência e substituição | `scheduler.test.ts`, `database.test.ts` |
| 14 | Impressão A4/A3 sem cortes | `print.test.ts` |

Os testes de banco executam as **migrations reais** em um PostgreSQL embarcado e verificam RLS, gatilhos, publicação bloqueada, auditoria e as funções RPC.
