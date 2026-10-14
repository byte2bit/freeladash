# FreelaDash

Dashboard pessoal para freelancers: clientes, projetos, registro de horas e relatórios de cobrança em português, com valores em BRL e datas brasileiras.

## Executar

Requer Node.js **22.18 ou superior** (recomendado: Node 24). O SQLite nativo do Node cria o arquivo automaticamente, sem serviço externo ou compilação de dependências nativas.

```powershell
cd D:\Development\dev\ai\dashboard
npm install
npm run seed
npm run dev
```

Abra http://localhost:3000. Conta fictícia criada pelo seed:

- Email: `demo@freeladash.com`
- Senha: `Freela123!`

O seed usa o mês atual no fuso de São Paulo e é idempotente: executá-lo novamente preserva os dados existentes. Novas contas começam vazias.

## Google e ambiente

O login com email/senha funciona no desenvolvimento sem configurar variáveis. Um segredo aleatório de desenvolvimento fica em `data/.auth-secret`, ignorado pelo Git.

Para habilitar Google, copie `.env.example` para `.env.local`, crie um cliente OAuth do tipo **Aplicativo da Web** no Google Cloud e preencha `AUTH_GOOGLE_ID` e `AUTH_GOOGLE_SECRET`. Configure:

- Origem JavaScript: `http://localhost:3000`
- URI de redirecionamento: `http://localhost:3000/api/auth/callback/google`

Reinicie o servidor. O botão Google aparece apenas quando as credenciais estão configuradas. O fluxo exige email verificado pelo Google; login por esse email reutiliza o usuário existente. [Referência do provider](https://authjs.dev/reference/core/providers/google).

Em produção, **defina `AUTH_SECRET`**, `AUTH_URL` com a origem pública e as URLs correspondentes no Google Cloud. Gere um segredo com `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Execute `npm run build` e `npm start` em um host Node com armazenamento persistente. O build não precisa de credenciais Google. Este projeto usa SQLite em arquivo e não é adequado a hosts com filesystem efêmero ou múltiplas instâncias independentes. Não use a conta de demonstração no ambiente de produção.

`DATABASE_PATH` opcional altera o local do banco; por padrão ele fica em `data/freeladash.sqlite`. Faça backup do banco com o servidor parado (ou use a API de backup SQLite). Não versione `data/` ou arquivos de ambiente.

## Fluxo de trabalho

1. Cadastre um cliente e sua tarifa por hora.
2. Crie um projeto vinculado ao cliente.
3. Abra **Timer de Horas**, selecione o projeto e descreva a tarefa. Use **START** para iniciar e **STOP** para salvar automaticamente. Para trabalhos sem cronômetro, use **Registro manual** e informe data, horas e minutos.
4. Gere uma cobrança para um cliente e intervalo de datas.
5. Abra o relatório, exporte CSV ou use **Imprimir / Salvar PDF**. Marque como paga quando receber.

O relatório é uma cobrança de serviços, não uma nota fiscal. Não existe envio automático de email ou processamento de pagamento.

O timer é persistido no banco e continua ao navegar, recarregar ou fechar o navegador. Há apenas um timer ativo por conta. A duração é calculada no servidor e arredondada para o próximo minuto (mínimo de 1 minuto); sessões que atravessam a meia-noite são separadas por dia no fuso de São Paulo. A tarifa usada é a do início da sessão. Repetir START/STOP após falhas de conexão não duplica o trabalho. A página mostra as horas de hoje com edição e exclusão; registros já cobrados continuam protegidos.

## Dados e proteção

- `users`, `clients`, `projects`, `time_entries`, `invoices` e `invoice_items` (cópia imutável das linhas do relatório).
- Valores monetários em centavos; duração em minutos inteiros, até 24 horas por registro. Subtotais arredondados por registro.
- Cada registro armazena sua própria tarifa. Alterar a tarifa de um cliente não altera o histórico.
- Cobranças são geradas em transação. Apenas registros ainda não cobrados entram; intervalos sobrepostos não duplicam horas.
- Horas cobradas não podem ser alteradas ou excluídas. Relatórios preservam nomes, descrições e tarifas mesmo após alterações cadastrais.
- Login obrigatório nas páginas do app, APIs e exportações. Todas as consultas e alterações verificam o usuário proprietário.
- Zod valida as APIs; SQL usa parâmetros; senhas usam bcrypt; sessões são cookies JWT gerenciados pelo Auth.js. APIs de escrita verificam a origem; tentativas de login e cadastro têm limitação persistida no SQLite.
- Clientes/projetos com vínculos não podem ser excluídos. Projetos concluídos mantêm histórico e podem ser reativados.

## Verificação

```powershell
npm run typecheck
npm test
npm run build
npm audit
# Com o servidor de desenvolvimento aberto e o seed já criado:
node scripts/smoke.mjs
```

Os testes usam um banco temporário separado e cobrem validação, acesso entre usuários, histórico de tarifas, cálculos, cobranças duplicadas e proteção dos relatórios. O smoke testa login e APIs reais, cria registros fictícios e remove somente os registros que ele próprio criou.

## Stack

Next.js 16 App Router, TypeScript, React 19, Tailwind CSS 4, primitivas acessíveis Radix UI, Lucide, Auth.js (Google e Credentials), Zod, bcrypt e SQLite nativo do Node. [Documentação Next.js](https://nextjs.org/docs/app/getting-started), [Credentials](https://authjs.dev/getting-started/authentication/credentials), [SQLite do Node](https://nodejs.org/api/sqlite.html).
