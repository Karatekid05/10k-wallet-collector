# Discord Wallet Collector Bot - 10K Edition

Bot de Discord com 3 comandos separados para diferentes tiers de alocação. Cada comando publica uma mensagem com botões para submeter wallets EVM. As wallets são guardadas em folhas diferentes do Google Sheets conforme o tier e role do utilizador.

## Requisitos
- Node.js 18+
- Um Bot de Discord (token e client ID)
- Uma Google Spreadsheet (e uma Service Account com acesso a essa sheet)

## Configuração do Google Sheets
1. Crie um projeto no Google Cloud e ative a API "Google Sheets API".
2. Crie uma Service Account e gere uma chave (JSON). Copie:
   - `client_email` -> GOOGLE_SERVICE_ACCOUNT_EMAIL
   - `private_key` -> GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY (escape de \n já suportado)
3. No Google Sheets, crie uma folha (pode ser vazia). Copie o ID da spreadsheet (URL entre `/d/` e `/edit`).
4. Partilhe a spreadsheet com o email da Service Account com permissão de Editor.

O código cria automaticamente 3 folhas (`2GTD`, `1GTD`, `FCFS`) com os cabeçalhos, se não existirem.

## Variáveis de Ambiente
Crie um ficheiro `.env` na raiz do projeto e preencha:

```
DISCORD_TOKEN=seu_token_do_bot
DISCORD_CLIENT_ID=seu_client_id_do_app
GUILD_ID=123456789012345678

GOOGLE_SHEETS_SPREADSHEET_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GOOGLE_SERVICE_ACCOUNT_EMAIL=svc-account@project.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

**Nota:** O `GUILD_ID` é necessário para buscar os nomes dos roles e verificar permissões. Utilize o ID do seu servidor Discord.

## Instalação
```
npm install
```

## Registar comandos (uma vez por alteração)
Se tiver `GUILD_ID` definido, os comandos aparecem instantaneamente; sem `GUILD_ID`, comandos globais podem demorar até 1 hora.
```
npm run register
```

## Executar o bot
```
npm run dev
```

## Como usar

O bot oferece 3 comandos diferentes para diferentes tiers de alocação:

### Comandos Disponíveis

1. **`/setup-2gtd`** - Para utilizadores com alocação de 2 GTD
   - Verifica se o utilizador tem o role ID: `1334873841780002937`
   - Guarda na folha **2GTD**

2. **`/setup-gtd`** - Para utilizadores com alocação de 1 GTD
   - Verifica se o utilizador tem algum dos seguintes role IDs:
     - `1334873106854187008`
     - `1360990505021870144`
     - `1405560532223922287`
     - `1362770935886774284`
     - `1407649035657019463`
     - `1284341434564083763`
   - Guarda na folha **1GTD**

3. **`/setup-fcfs`** - Para utilizadores FCFS (First Come First Served)
   - Verifica se o utilizador tem algum dos seguintes role IDs:
     - `1334873797085626398`
     - `1408402916452208702`
     - `1411717220605886616`
   - Guarda na folha **FCFS**

### Funcionamento

Ao executar um dos comandos, o bot envia uma mensagem com dois botões:

- **"Submit Wallet"**: Abre um modal para inserir a wallet EVM (formato 0x...). 
  - Verifica se o utilizador tem o role apropriado para esse tier
  - Ao submeter novamente, substitui a wallet anterior
  - Guarda: Discord Username, Discord ID, Nome do Role, EVM Wallet

- **"Check Status"**: Mostra (em mensagem ephemeral) a wallet submetida, role, username e ID do Discord

### Dados Guardados

Cada folha do Google Sheets contém as seguintes colunas:
- **Discord Username**: Nome de utilizador no Discord
- **Discord ID**: ID único do utilizador
- **Role**: Nome do role que o utilizador tem (obtido automaticamente)
- **EVM Wallet**: Endereço da wallet submetida

## Hierarquia de Tiers (IMPORTANTE) 🔒

O sistema implementa uma **hierarquia de prioridade** que impede utilizadores de submeterem wallets em tiers inferiores ao seu role mais alto:

### Regras de Hierarquia:

1. **Utilizadores com role 2GTD**:
   - ✅ Podem submeter em: `/setup-2gtd`
   - ❌ NÃO podem submeter em: `/setup-gtd` ou `/setup-fcfs`

2. **Utilizadores com roles GTD** (e sem role 2GTD):
   - ✅ Podem submeter em: `/setup-gtd`
   - ❌ NÃO podem submeter em: `/setup-fcfs`

3. **Utilizadores com roles FCFS** (e sem outros roles):
   - ✅ Podem submeter em: `/setup-fcfs`

### Exemplo Prático:

- Se tens o role "Veteran" (2GTD) **E** um dos 6 roles GTD → Só podes submeter em `/setup-2gtd`
- Se tens um dos 6 roles GTD **E** um dos 3 roles FCFS → Só podes submeter em `/setup-gtd`
- Se tens apenas um dos 3 roles FCFS → Podes submeter em `/setup-fcfs`

**Mensagem de erro**: Se tentares submeter num tier inferior ao teu role mais alto, receberás uma mensagem com um **link direto** para o canal correto onde deves submeter.

### Links dos Canais:
- **2GTD**: https://discord.com/channels/1282268775709802568/1437876379982237766
- **GTD**: https://discord.com/channels/1282268775709802568/1437876707502592143
- **FCFS**: https://discord.com/channels/1282268775709802568/1437876834476884100

## Notas
- O bot busca automaticamente o nome do role pelo ID e guarda-o na sheet
- A validação de wallet verifica o formato 0x seguido de 40 caracteres hexadecimais
- Se um utilizador submeter uma wallet em múltiplos tiers, apenas a última submissão é mantida (mas a hierarquia impede submissões incorretas)
- O utilizador precisa ter pelo menos um dos roles especificados para poder submeter uma wallet
- A verificação de hierarquia ocorre tanto ao clicar no botão quanto ao submeter o modal (dupla verificação)

