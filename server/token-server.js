// Servidor de tokens.
//
// O LiveKit exige que quem entra numa sala tenha um "token" assinado
// com a API secret do seu projeto. Essa secret NUNCA pode ir dentro
// do app (senão qualquer pessoa poderia extrair e criar tokens falsos).
// Por isso ela fica só aqui, num servidor pequeno que você roda no seu
// PC ou hospeda (Render, Railway e afins).
//
// O app (Electron) chama este servidor pedindo um token, informando
// o nome da sala e o nome do usuário, e recebe de volta um token
// válido para entrar naquela sala.

require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { AccessToken } = require('livekit-server-sdk');

const app = express();

// Na Render (e em qualquer hospedagem atrás de proxy) o IP real do
// cliente vem no X-Forwarded-For. Sem isto o limite de tentativas
// enxergaria todo mundo como um IP só.
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: '4kb' }));

const {
  LIVEKIT_URL,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
  ROOM_PASSWORD,
  PORT = 3001,
} = process.env;

if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error(
    '\nFaltam variáveis de ambiente (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET).\n' +
      'Localmente: copie server/.env.example para server/.env e preencha.\n' +
      'Na Render: cadastre as três em Environment.\n'
  );
  process.exit(1);
}

if (!ROOM_PASSWORD) {
  console.warn(
    '\n⚠  ROOM_PASSWORD não está definida: o endpoint /token está ABERTO.\n' +
      '   Qualquer pessoa que descobrir esta URL consegue entrar nas suas salas.\n' +
      '   Tudo bem para rodar em localhost; defina uma senha antes de expor na internet.\n'
  );
}

// ---------- Senha compartilhada ----------

// Comparação em tempo constante: comparar strings com === vaza, pelo
// tempo de resposta, quantos caracteres iniciais estavam certos.
// O hash iguala os tamanhos, que é exigência do timingSafeEqual.
function passwordMatches(given) {
  if (!ROOM_PASSWORD) return true;
  const hash = (value) => crypto.createHash('sha256').update(String(value ?? '')).digest();
  return crypto.timingSafeEqual(hash(given), hash(ROOM_PASSWORD));
}

// ---------- Limite de tentativas ----------

// Guarda simples em memória. Não sobrevive a um restart do processo, e
// numa hospedagem com várias instâncias cada uma teria a sua contagem —
// para um grupo de amigos isso é suficiente, e segura força bruta.
const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 30;
const attempts = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);

  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

// Limpeza periódica para a memória não crescer indefinidamente
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of attempts) {
    if (now > entry.resetAt) attempts.delete(ip);
  }
}, WINDOW_MS).unref();

// ---------- Rotas ----------

app.get('/health', (_req, res) => {
  res.json({ ok: true, authRequired: Boolean(ROOM_PASSWORD) });
});

// POST /token  { room, username, password }
app.post('/token', async (req, res) => {
  const { room, username, password } = req.body || {};

  if (rateLimited(req.ip)) {
    return res.status(429).json({ error: 'Muitas tentativas. Espere alguns minutos.' });
  }

  if (typeof room !== 'string' || typeof username !== 'string') {
    return res.status(400).json({ error: 'Informe "room" e "username".' });
  }

  const cleanRoom = room.trim();
  const cleanUser = username.trim();

  if (!cleanUser || cleanUser.length > 32) {
    return res.status(400).json({ error: 'Nome de usuário deve ter entre 1 e 32 caracteres.' });
  }

  if (!/^[\w -]{1,48}$/.test(cleanRoom)) {
    return res.status(400).json({ error: 'Nome de sala inválido (use letras, números, - ou _).' });
  }

  if (!passwordMatches(password)) {
    return res.status(401).json({ error: 'Senha incorreta.' });
  }

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: cleanUser,
    ttl: '4h',
  });

  at.addGrant({
    room: cleanRoom,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    // Permite trocar o nome de exibição sem sair e reentrar na sala.
    // A identidade continua fixa no token — só o rótulo muda.
    canUpdateOwnMetadata: true,
  });

  const token = await at.toJwt();

  res.json({ token, url: LIVEKIT_URL });
});

app.listen(PORT, () => {
  console.log(`Servidor de tokens rodando na porta ${PORT}`);
  console.log(ROOM_PASSWORD ? 'Senha: exigida' : 'Senha: NÃO exigida (endpoint aberto)');
});
