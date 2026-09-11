# Bambuzal

Um app de voz, chat de texto e compartilhamento de tela para Windows,
no estilo do Discord, feito para um grupo pequeno (amigos, equipe etc).

Funciona de ponta a ponta:
- Chat de voz em tempo real
- Compartilhamento de tela até 1440p60, com escolha de janela ou monitor
- Chat de texto com indicador de quem está digitando
- Participantes com anel de voz acionado pelo volume real
- Painel de conexão com latência, perda de pacotes e bitrate
- Configurações: microfone, saída de áudio, ganho e nome de exibição
- Sala protegida por senha compartilhada

O que ele **não** tem ainda (dá pra evoluir depois): vídeo de câmera,
várias salas ao mesmo tempo na mesma tela, histórico de mensagens
salvo e contas individuais de usuário.

## Como funciona por baixo dos panos

O app usa o [LiveKit](https://livekit.io), um serviço de código aberto
especializado em voz/vídeo em tempo real (o mesmo tipo de tecnologia
que apps como Discord, Zoom e Google Meet usam). Em vez de você
precisar construir servidor de sinalização, TURN/STUN, etc., o LiveKit
Cloud já resolve isso — o plano gratuito ("Build") não pede cartão de
crédito e inclui 5.000 minutos de WebRTC por mês e até 100 conexões
simultâneas, o que é bem mais que suficiente para um grupo de amigos.

Existem duas partes no projeto:

1. **`server/`** — um servidor bem pequeno (Node.js) que gera os
   "tokens" de acesso às salas. Ele guarda a chave secreta do seu
   projeto LiveKit e nunca fica dentro do app (por segurança).
2. **raiz do projeto** (`main.js`, `renderer/`) — o app de Windows em
   si, feito com Electron.

## Passo 1 — Instalar o Node.js

Baixe e instale o Node.js (versão 18 ou mais nova) em
https://nodejs.org — escolha a versão "LTS". Isso instala também o
`npm`, usado para baixar as dependências do projeto.

Depois de instalar, abra o "Prompt de Comando" ou "PowerShell" e
confira digitando:

```
node -v
npm -v
```

## Passo 2 — Criar uma conta gratuita no LiveKit Cloud

1. Acesse https://cloud.livekit.io e crie uma conta gratuita (não
   pede cartão de crédito).
2. Crie um projeto.
3. No painel do projeto, anote três informações:
   - **URL do projeto** (algo como `wss://seu-projeto.livekit.cloud`)
   - **API Key**
   - **API Secret**

## Passo 3 — Configurar e rodar o servidor de tokens

Este servidor pode rodar no seu próprio PC enquanto vocês jogam/usam
o app juntos. Ele só precisa estar rodando enquanto alguém for entrar
numa sala.

```
cd server
npm install
Copy-Item .env.example .env
```

Abra o arquivo `.env` num editor de texto e preencha com a URL, API
Key e API Secret que você anotou no Passo 2. Depois rode:

```
npm start
```

> **Se o PowerShell recusar o comando** com "a execução de scripts foi
> desabilitada neste sistema", use `npm.cmd` no lugar de `npm`. O
> bloqueio atinge só o wrapper PowerShell do npm, não o app.

Se aparecer `Servidor de tokens rodando em http://localhost:3001`,
está funcionando.

> Quer que os seus amigos consigam entrar mesmo sem estarem na sua
> rede/casa? Você pode hospedar esse mesmo servidor de graça em
> serviços como Render ou Railway, e todo mundo aponta para essa URL
> pública em vez de `http://localhost:3001`.

## Passo 4 — Rodar o app (modo desenvolvimento)

Em outro terminal, na pasta principal do projeto:

```
npm install
npm start
```

Isso abre a janela do app. Cada pessoa do grupo (rodando o app no
próprio PC) preenche:
- **Endereço do servidor de tokens**: o endereço do Passo 3 (o do
  computador de quem estiver com o servidor ligado)
- **Nome da sala**: o mesmo nome para todos entrarem juntos (ex:
  `geral`)
- **Seu nome**: como você quer aparecer para os outros

## Passo 5 — Gerar o instalador (.exe) para Windows

Quando estiver satisfeito com o app, gere um instalador de Windows
de verdade (arquivo `.exe`) rodando, no Windows:

```
npm run dist
```

O instalador aparece na pasta `dist/`. Esse comando **precisa ser
rodado em um Windows** (não funciona a partir do Linux/macOS), porque
o electron-builder empacota o app usando ferramentas do próprio
Windows.

> O ícone já está em `build/icon.png` (512x512 com transparência). Para
> trocar, substitua o arquivo mantendo pelo menos 256x256 — abaixo
> disso o electron-builder recusa.

## Passo 6 — Deixar o app acessível fora da sua rede

Um mal-entendido comum: **o áudio e o vídeo já passam pela internet**.
O LiveKit Cloud é um servidor SFU — a mídia sobe para a infraestrutura
deles e desce para os outros participantes, nunca é ponto a ponto.

O único pedaço preso no `localhost` é o **servidor de tokens**. Assim
que ele ganhar uma URL pública, qualquer pessoa em qualquer lugar entra.

### Senha

Antes de expor o servidor, defina `ROOM_PASSWORD`. Sem ela o endpoint
`/token` fica aberto: quem descobrir a URL gera um token e entra nas
suas salas. O servidor avisa no console quando sobe sem senha, e o
`GET /health` responde `authRequired` dizendo se a proteção está ativa.

### Deploy na Render

O arquivo `render.yaml` na raiz já descreve o serviço, então não é
preciso preencher formulário nenhum.

1. Suba este repositório para o GitHub.
2. Na Render, escolha **New > Blueprint** e aponte para o repositório.
3. Ela vai pedir os valores de `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
   `LIVEKIT_API_SECRET` e `ROOM_PASSWORD`. Eles ficam guardados na
   Render, nunca no repositório — é para isso que serve o `sync: false`
   do blueprint.
4. Terminado o deploy, confira acessando `https://SEU-SERVICO.onrender.com/health`.
   A resposta traz `authRequired` e a lista de recursos da versão em execução.

Depois disso, cada pessoa do grupo preenche no app:

- **Servidor de tokens**: a URL da Render
- **Sala**: o mesmo nome para todos
- **Senha**: a que você definiu em `ROOM_PASSWORD`

> No plano gratuito da Render o serviço hiberna depois de um tempo sem
> uso. Isso não derruba ninguém que já esteja numa sala (a mídia não
> passa por ele), mas a primeira pessoa a entrar depois da hibernação
> espera o serviço religar.

## Estrutura de arquivos

```
bambuzal/
├── main.js              # processo principal do Electron (janela, captura de tela)
├── renderer/
│   ├── index.html       # telas do app (login e sala)
│   ├── renderer.js      # lógica: voz, tela, chat, participantes
│   └── styles.css       # visual (tema escuro, parecido com Discord)
├── server/
│   ├── token-server.js  # gera os tokens de acesso às salas
│   └── .env.example     # onde colocar as chaves do LiveKit
├── package.json
└── README.md
```

## Próximos passos possíveis

- Adicionar câmera (vídeo de webcam), além da tela
- Suporte a várias salas/canais dentro do mesmo app
- Histórico de mensagens que sobrevive ao fechar o app
- Notificações quando alguém entra na sala
- Atualização automática do app instalado
