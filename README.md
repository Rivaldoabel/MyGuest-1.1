# My Guest

Plataforma web para criação e gestão de convites digitais com QR Code, controlo de entradas de utilização única e relatórios. Esta versão segue a estrutura da primeira imagem: Vite + Supabase, com `src/`, `supabase/`, `public/`, `index.html`, `package.json` e `vite.config.js`.

## Funcionalidades
- Login de administrador e operador.
- Criação e gestão de eventos.
- Criação de convites individuais em lote (um nome por linha).
- QR Code único por convidado.
- Geração de convite em PDF.
- Leitura QR pela câmara e validação manual.
- A primeira leitura é aceite; leituras seguintes são recusadas pela função SQL transaccional.
- Painel com totais, relatórios e exportação CSV.
- Segurança por Supabase Auth e Row Level Security.

## Publicar tudo pelo navegador (GitHub + Cloudflare Pages + Supabase)

### 1. Criar o projecto Supabase
1. Aceda a https://supabase.com e crie um projecto.
2. Abra **SQL Editor**.
3. Copie e execute todo o conteúdo de `supabase/migrations/0001_my_guest.sql`.
4. Em **Project Settings → API**, copie `Project URL` e a chave `anon`/`publishable` (nunca a `service_role`).

### 2. Criar o primeiro administrador
1. Em Supabase, abra **Authentication → Users → Add user**.
2. Crie o utilizador com email e palavra-passe.
3. Copie o UUID desse utilizador.
4. No SQL Editor execute, substituindo o UUID:
   `update public.profiles set role='admin', full_name='Administrador' where id='UUID_DO_UTILIZADOR';`
5. Para cada operador, crie um utilizador em Authentication → Users. O perfil será criado automaticamente como `operator`.

### 3. Carregar para o GitHub
1. Crie um repositório chamado `my-guest`.
2. Carregue todos os ficheiros e pastas desta pasta, preservando a estrutura.
3. Não carregue `.env.local` nem qualquer chave secreta.

### 4. Configurar variáveis de ambiente na Cloudflare
1. Na Cloudflare, abra **Workers & Pages → Create → Pages → Connect to Git**.
2. Escolha o repositório `my-guest`.
3. Build command: `npm run build`
4. Build output directory: `dist`
5. Em Settings → Environment variables, configure:
   - `VITE_SUPABASE_URL` = Project URL do Supabase
   - `VITE_SUPABASE_ANON_KEY` = chave anon/publishable do Supabase
6. Faça o deploy.

A chave anon/publishable pode ser usada no frontend porque as permissões são controladas pelas políticas RLS. Nunca use a chave `service_role` no frontend ou no GitHub.

## Testar localmente (opcional)
Este projecto pode ser publicado sem instalar nada no computador, através do GitHub e Cloudflare. Para teste local é necessário Node.js:
1. Copie `.env.example` para `.env.local` e preencha os valores do Supabase.
2. `npm install`
3. `npm run dev`

## Exportar PDF
Na área Convidados, clique em PDF na linha do convidado. O PDF inclui o nome, evento, data e QR Code.

## Notas e limitações
- A leitura da câmara exige HTTPS e permissão de câmara no navegador. O domínio Cloudflare Pages fornece HTTPS.
- As bibliotecas de fontes Google são opcionais; se estiverem bloqueadas, o sistema usa fontes alternativas.
- A versão inicial não envia convites automaticamente por email ou WhatsApp.
- Antes de um evento real, faça testes com utilizadores admin e operator, vários convites e duas leituras do mesmo QR.
- Para maior segurança operacional, crie contas individuais para cada operador e não partilhe contas.
