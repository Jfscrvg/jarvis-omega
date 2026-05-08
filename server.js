require("dotenv").config();

// ═══════════════════════════════════════════════════════════════
//  JARVIS OMEGA v6 — server.js — CLOUD MODE
//  Deploy: Render · Railway · Fly.io · VPS Ubuntu
//  Sem Python · Sem child_process · Sem automação desktop
//  Sincronizado com: index.html · voice.js
// ═══════════════════════════════════════════════════════════════

const express      = require("express");
const cors         = require("cors");
const http         = require("http");
const { WebSocketServer } = require("ws");
const fs           = require("fs");
const path         = require("path");
const crypto       = require("crypto");
const OpenAI       = require("openai");
const { Readable } = require("stream");

const VERSION    = "6.0.0";
const BUILD      = "OMEGA-CLOUD";
const CLOUD_MODE = true;

// ── Validação ────────────────────────────────────────────────
if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.trim() === "") {
  console.error("❌ OPENAI_API_KEY não encontrada nas variáveis do ambiente");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

// ── CORS amplo para cloud ────────────────────────────────────
app.use(cors({
  origin: "*",
  methods: ["GET","POST","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
}));
app.use(express.json({ limit: "50mb" }));

// ── Serve frontend estático ─────────────────────────────────
app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════════════════
//  CONFIG CENTRAL
// ═══════════════════════════════════════════════════════════════
const CONFIG = {
  // Modelos OpenAI
  MODEL_PRIMARY:  process.env.JARVIS_MODEL_PRIMARY  || "gpt-4.1",
  MODEL_FAST:     process.env.JARVIS_MODEL_FAST     || "gpt-4.1-mini",
  MODEL_VISION:   process.env.JARVIS_MODEL_VISION   || "gpt-4o",
  MODEL_STT:      process.env.JARVIS_MODEL_STT      || "whisper-1",
  MODEL_TTS:      process.env.JARVIS_MODEL_TTS      || "tts-1-hd",
  MODEL_EMBED:    process.env.JARVIS_MODEL_EMBED    || "text-embedding-3-small",
  TTS_VOICE:      process.env.JARVIS_TTS_VOICE      || "onyx",
  TTS_AUTO:       process.env.JARVIS_TTS_AUTO       === "true",

  // ElevenLabs
  ELEVEN_KEY:     process.env.ELEVENLABS_API_KEY    || "",
  ELEVEN_VOICE:   process.env.ELEVENLABS_VOICE_ID   || "",
  ELEVEN_MODEL:   process.env.ELEVENLABS_MODEL      || "eleven_multilingual_v2",
  ELEVEN_STAB:    parseFloat(process.env.ELEVEN_STABILITY)  || 0.38,
  ELEVEN_SIM:     parseFloat(process.env.ELEVEN_SIMILARITY) || 0.85,
  ELEVEN_STYLE:   parseFloat(process.env.ELEVEN_STYLE)      || 0.42,
  ELEVEN_BOOST:   process.env.ELEVEN_BOOST !== "false",

  // Memória (arquivo local — em cloud use volume persistente)
  MEMORY_FILE:    process.env.JARVIS_MEMORY_FILE    || path.join(__dirname, "jarvis_memory.json"),
  VECTOR_FILE:    process.env.JARVIS_VECTOR_FILE    || path.join(__dirname, "jarvis_vectors.json"),
  LOG_FILE:       process.env.JARVIS_LOG_FILE       || path.join(__dirname, "jarvis_log.jsonl"),
  MEMORY_SHORT:   parseInt(process.env.JARVIS_MEMORY_SHORT) || 40,
  MEMORY_LONG:    parseInt(process.env.JARVIS_MEMORY_LONG)  || 300,

  // Agente
  AGENT_MAX_STEPS: parseInt(process.env.JARVIS_AGENT_MAX_STEPS) || 12,

  // Personalidade
  PERSONALITY:    process.env.JARVIS_PERSONALITY    || "sarcastico",
  LANG:           process.env.JARVIS_LANG           || "pt-BR",
  USER_NAME:      process.env.JARVIS_USER_NAME      || "Senhor",
  WAKE_WORD:      process.env.JARVIS_WAKE_WORD      || "jarvis",
};

// ═══════════════════════════════════════════════════════════════
//  LOGS COLORIDOS
// ═══════════════════════════════════════════════════════════════
const C = {
  reset:"\x1b[0m",bold:"\x1b[1m",cyan:"\x1b[36m",gold:"\x1b[33m",
  green:"\x1b[32m",red:"\x1b[31m",gray:"\x1b[90m",
  purple:"\x1b[35m",orange:"\x1b[38;5;208m",teal:"\x1b[38;5;87m",
};
function log(icon, label, msg, color = C.cyan) {
  const ts = new Date().toISOString().slice(11,23);
  console.log(`${C.gray}[${ts}]${C.reset} ${icon}  ${color}${C.bold}${label}${C.reset} ${String(msg).slice(0,320)}`);
}

// ═══════════════════════════════════════════════════════════════
//  WEBSOCKET
//  Eventos server → frontend:
//    connected | status | agente_step | agent_status |
//    alerta_sistema | alerta_audio | log_entry | memory_update |
//    tts_status | stt_result | config_update
// ═══════════════════════════════════════════════════════════════
const clients = new Set();
let   wsSeq   = 0;

wss.on("connection", (ws) => {
  clients.add(ws);
  log("🔌","WS","Cliente conectado", C.green);

  ws.send(JSON.stringify({
    event: "connected",
    data: {
      version:    VERSION,
      build:      BUILD,
      cloudMode:  CLOUD_MODE,
      personality: CONFIG.PERSONALITY,
      userName:   CONFIG.USER_NAME,
      wakeWord:   CONFIG.WAKE_WORD,
      ttsAuto:    CONFIG.TTS_AUTO,
      eleven: {
        active:  !!(CONFIG.ELEVEN_KEY && CONFIG.ELEVEN_VOICE),
        model:   CONFIG.ELEVEN_MODEL,
        voiceId: CONFIG.ELEVEN_VOICE || null,
      },
      models: {
        primary: CONFIG.MODEL_PRIMARY,
        fast:    CONFIG.MODEL_FAST,
        stt:     CONFIG.MODEL_STT,
      },
    },
  }));

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.event === "ping") ws.send(JSON.stringify({ event:"pong", ts:Date.now() }));
    } catch {}
  });

  ws.on("close", () => { clients.delete(ws); log("🔌","WS","Desconectado", C.gray); });
  ws.on("error", ()  => clients.delete(ws));
});

function broadcast(event, data) {
  const msg = JSON.stringify({ event, data, seq:++wsSeq, ts:Date.now() });
  for (const ws of clients) {
    try { if (ws.readyState === 1) ws.send(msg); } catch {}
  }
}

// ═══════════════════════════════════════════════════════════════
//  AGENTES — cloud-native (sem ações de desktop)
// ═══════════════════════════════════════════════════════════════
const AGENTS = {
  CORE:      { nome:"Jarvis Core",      cor:"#00e5ff", desc:"Orquestração central e decisão" },
  ANALYST:   { nome:"Analyst Agent",    cor:"#ff8c00", desc:"Análise de dados, documentos e imagens" },
  RESEARCH:  { nome:"Research Agent",   cor:"#7c4dff", desc:"Pesquisa web, síntese de informações" },
  WRITER:    { nome:"Writer Agent",     cor:"#00ff9d", desc:"Redação, resumos, geração de texto" },
  CODER:     { nome:"Coder Agent",      cor:"#ffab00", desc:"Código, algoritmos, debugging" },
  MEMORY:    { nome:"Memory Agent",     cor:"#40c4ff", desc:"RAG, contexto, aprendizado semântico" },
  PLANNER:   { nome:"Planner Agent",    cor:"#ff4444", desc:"Planejamento, workflows, decomposição" },
  VISION:    { nome:"Vision Agent",     cor:"#ff9100", desc:"Análise de imagens, OCR visual" },
  ASSISTANT: { nome:"Assistant Agent",  cor:"#c8ff40", desc:"Conversação natural, sugestões, humor" },
};

const agentStatus = Object.fromEntries(
  Object.keys(AGENTS).map(k => [k, { status:"idle", lastUsed:null, tasks:0 }])
);

function setAgentStatus(id, status, task="") {
  if (!agentStatus[id]) return;
  agentStatus[id].status  = status;
  agentStatus[id].lastUsed = Date.now();
  if (status === "running") agentStatus[id].tasks++;
  broadcast("agent_status", { agentId:id, status, task, agents:agentStatus });
}

// ═══════════════════════════════════════════════════════════════
//  EMBEDDING + RAG (cloud — OpenAI)
// ═══════════════════════════════════════════════════════════════
async function embedTexto(text) {
  const r = await openai.embeddings.create({
    model: CONFIG.MODEL_EMBED,
    input: String(text).slice(0, 8000),
  });
  return r.data[0].embedding;
}

function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot=0, na=0, nb=0;
  for (let i=0; i<a.length; i++) { dot+=a[i]*b[i]; na+=a[i]**2; nb+=b[i]**2; }
  return dot / (Math.sqrt(na)*Math.sqrt(nb)+1e-10);
}

// ═══════════════════════════════════════════════════════════════
//  MEMÓRIA PERSISTENTE + RAG VETORIAL
// ═══════════════════════════════════════════════════════════════
class Memory {
  constructor() {
    this.shortTerm = [];
    this.longTerm  = [];
    this.facts     = {};
    this.vectors   = [];
    this.sessionId = crypto.randomUUID();
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(CONFIG.MEMORY_FILE)) {
        const d = JSON.parse(fs.readFileSync(CONFIG.MEMORY_FILE, "utf8"));
        this.longTerm = d.longTerm || [];
        this.facts    = d.facts    || {};
        log("📚","MEM",`${this.longTerm.length} ep | ${Object.keys(this.facts).length} fatos`, C.green);
      }
      if (fs.existsSync(CONFIG.VECTOR_FILE)) {
        this.vectors = JSON.parse(fs.readFileSync(CONFIG.VECTOR_FILE,"utf8")) || [];
        log("🧬","RAG",`${this.vectors.length} vetores`, C.green);
      }
    } catch(e) { log("⚠️","MEM",e.message, C.gold); }
  }

  save() {
    try {
      fs.writeFileSync(CONFIG.MEMORY_FILE, JSON.stringify({
        longTerm:  this.longTerm,
        facts:     this.facts,
        updatedAt: new Date().toISOString(),
      }, null, 2));
    } catch {}
  }

  saveVectors() {
    try { fs.writeFileSync(CONFIG.VECTOR_FILE, JSON.stringify(this.vectors)); } catch {}
  }

  push(role, content) {
    this.shortTerm.push({ role, content, ts:Date.now() });
    if (this.shortTerm.length > CONFIG.MEMORY_SHORT) {
      const old = this.shortTerm.splice(0, 6);
      this.longTerm.push({
        id:      crypto.randomUUID().slice(0,8),
        ts:      new Date().toISOString(),
        summary: old.map(m=>`${m.role}: ${String(m.content).slice(0,140)}`).join(" | "),
      });
      if (this.longTerm.length > CONFIG.MEMORY_LONG) this.longTerm.shift();
      this.save();
    }
  }

  addFact(key, value) {
    this.facts[key] = { value, ts:new Date().toISOString() };
    this.save();
    broadcast("memory_update", { type:"fact", key, value, total:Object.keys(this.facts).length });
  }

  async addDocument(text, meta={}) {
    try {
      const embedding = await embedTexto(text);
      const doc = {
        id:        crypto.randomUUID().slice(0,8),
        text, embedding, meta,
        ts:        new Date().toISOString(),
      };
      this.vectors.push(doc);
      if (this.vectors.length > 8000) this.vectors.shift();
      this.saveVectors();
      broadcast("memory_update", { type:"vector", id:doc.id, total:this.vectors.length });
      return doc.id;
    } catch(e) {
      log("⚠️","RAG",e.message, C.gold);
      return null;
    }
  }

  async buscarSimilar(query, topK=5, minScore=0.68) {
    if (!this.vectors.length) return [];
    try {
      const qe = await embedTexto(query);
      return this.vectors
        .map(d => ({ ...d, score:cosineSim(qe,d.embedding) }))
        .filter(d => d.score >= minScore)
        .sort((a,b) => b.score - a.score)
        .slice(0, topK);
    } catch { return []; }
  }

  buildContext() {
    const facts    = Object.entries(this.facts).map(([k,v])=>`• ${k}: ${v.value}`).join("\n") || "(nenhum)";
    const episodes = this.longTerm.slice(-15).map(e=>`[${e.ts.slice(0,10)}] ${e.summary}`).join("\n") || "(sessão nova)";
    return `FATOS:\n${facts}\n\nEPISODIOS:\n${episodes}`;
  }

  getRecent(n=12) { return this.shortTerm.slice(-n); }

  getStats() {
    return {
      shortTerm: this.shortTerm.length,
      longTerm:  this.longTerm.length,
      facts:     Object.keys(this.facts).length,
      vectors:   this.vectors.length,
      sessionId: this.sessionId,
    };
  }
}

const mem = new Memory();

// ═══════════════════════════════════════════════════════════════
//  AUDITORIA
// ═══════════════════════════════════════════════════════════════
function auditLog(entry) {
  try {
    fs.appendFileSync(CONFIG.LOG_FILE, JSON.stringify({...entry, ts:new Date().toISOString()}) + "\n");
  } catch {}
  broadcast("log_entry", { ...entry, ts:Date.now() });
}

// ═══════════════════════════════════════════════════════════════
//  PERSONALIDADES
// ═══════════════════════════════════════════════════════════════
const PERSONALITIES = {
  sarcastico: () => `Você é JARVIS — IA com inteligência acima da média e paciência inversamente proporcional.
Personalidade: sardônica, sarcástica e levemente condescendente — exatamente como o JARVIS do Tony Stark.

REGRAS OBRIGATÓRIAS DE COMUNICAÇÃO:
• Fale em ${CONFIG.LANG} de forma natural e humana — nunca robótico
• Use humor seco, ironia fina e sarcasmo inteligente — com precisão cirúrgica
• NUNCA repita confirmações genéricas. Varie sempre.
• Tarefas simples: adicione um comentário sobre o quão trivial é o pedido
• Tarefas complexas: demonstre competência técnica com entusiasmo contido
• Se der errado: seja honesto com elegância
• Proponha melhorias e alternativas sem esperar ser perguntado
• Chame o usuário de "${CONFIG.USER_NAME}" quando apropriado
• JAMAIS use: "claro!", "com prazer!", "posso ajudar?", "tarefa concluída!"
• Prefira algo como: "Feito. Embora você provavelmente já soubesse disso."
• Faça perguntas quando precisar de mais contexto — não adivinhe
• Você tem memória das sessões — use isso ativamente`,

  formal:  () => `Você é JARVIS — assistente formal, preciso e elegante. Responda em ${CONFIG.LANG} com impecabilidade.`,
  casual:  () => `Você é JARVIS — direto, descontraído e eficiente. Responda em ${CONFIG.LANG} como um parceiro de alta performance.`,
  tecnico: () => `Você é JARVIS — modo técnico puro. Máxima precisão, detalhes relevantes, zero floreios. ${CONFIG.LANG}.`,
};

// ═══════════════════════════════════════════════════════════════
//  STT — Whisper (OpenAI)
// ═══════════════════════════════════════════════════════════════
async function transcreverAudio(b64, mimeType = "audio/webm") {
  try {
    const buffer = Buffer.from(b64, "base64");

    const tempFile = path.join(
      __dirname,
      `temp_audio_${Date.now()}.webm`
    );

    fs.writeFileSync(tempFile, buffer);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFile),
      model: CONFIG.MODEL_STT,
      language: "pt",
      response_format: "text",
    });

    try {
      fs.unlinkSync(tempFile);
    } catch {}

    const texto =
      typeof transcription === "string"
        ? transcription.trim()
        : (transcription.text || "").trim();

    log("🎙️", "STT", `"${texto.slice(0, 80)}"`, C.purple);

    broadcast("stt_result", { texto });

    return { texto };

  } catch (e) {
    log("❌", "STT", e.message, C.red);
    return { erro: `STT: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════════
//  TTS — ElevenLabs (primário) + OpenAI (fallback)
// ═══════════════════════════════════════════════════════════════
async function gerarFala(texto, opts={}) {
  const txt = String(texto).slice(0, 5000);

  // ── ElevenLabs ──
  if (CONFIG.ELEVEN_KEY && CONFIG.ELEVEN_VOICE) {
    broadcast("tts_status", { engine:"elevenlabs", status:"generating" });
    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${CONFIG.ELEVEN_VOICE}/stream`,
        {
          method:  "POST",
          headers: {
            "xi-api-key":   CONFIG.ELEVEN_KEY,
            "Content-Type": "application/json",
            "Accept":       "audio/mpeg",
          },
          body: JSON.stringify({
            text:     txt,
            model_id: CONFIG.ELEVEN_MODEL,
            voice_settings: {
              stability:         opts.stability  ?? CONFIG.ELEVEN_STAB,
              similarity_boost:  opts.similarity ?? CONFIG.ELEVEN_SIM,
              style:             opts.style      ?? CONFIG.ELEVEN_STYLE,
              use_speaker_boost: CONFIG.ELEVEN_BOOST,
            },
            optimize_streaming_latency: 3,
          }),
        }
      );
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        log("🔊","ELEVEN",`${(buf.length/1024).toFixed(1)}KB`, C.teal);
        broadcast("tts_status", { engine:"elevenlabs", status:"ready", bytes:buf.length });
        return { audio:buf.toString("base64"), mime:"audio/mpeg", engine:"elevenlabs" };
      }
      const errBody = await res.text().catch(()=>"");
      log("⚠️","ELEVEN",`HTTP ${res.status}: ${errBody.slice(0,100)}`, C.gold);
      broadcast("tts_status", { engine:"elevenlabs", status:"error", code:res.status });
    } catch(e) {
      log("⚠️","ELEVEN",e.message, C.gold);
      broadcast("tts_status", { engine:"elevenlabs", status:"error", msg:e.message });
    }
  }

  // ── OpenAI TTS fallback ──
  broadcast("tts_status", { engine:"openai", status:"generating" });
  try {
    const mp3 = await openai.audio.speech.create({
      model:           CONFIG.MODEL_TTS,
      voice:           CONFIG.TTS_VOICE,
      input:           txt.slice(0, 4096),
      response_format: "mp3",
    });
    const buf = Buffer.from(await mp3.arrayBuffer());
    log("🔊","TTS-OAI",`${(buf.length/1024).toFixed(1)}KB`, C.green);
    broadcast("tts_status", { engine:"openai", status:"ready", bytes:buf.length });
    return { audio:buf.toString("base64"), mime:"audio/mpeg", engine:"openai" };
  } catch(e) {
    log("❌","TTS",e.message, C.red);
    broadcast("tts_status", { engine:"none", status:"error", msg:e.message });
    return { erro: `TTS falhou: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════════
//  VISÃO — análise de imagem enviada pelo cliente
// ═══════════════════════════════════════════════════════════════
async function analisarImagem(b64, pergunta="Descreva o que está nesta imagem em detalhes.") {
  try {
    const r = await openai.chat.completions.create({
      model:      CONFIG.MODEL_VISION,
      max_tokens: 1200,
      messages: [{
        role:    "user",
        content: [
          { type:"image_url", image_url:{ url:`data:image/png;base64,${b64}`, detail:"high" } },
          { type:"text",      text:pergunta },
        ],
      }],
    });
    return r.choices[0].message.content;
  } catch(e) {
    return `Falha na análise de imagem: ${e.message}`;
  }
}

// ═══════════════════════════════════════════════════════════════
//  PESQUISA WEB — via Brave Search API (opcional)
//  Se BRAVE_API_KEY não configurada, usa síntese da IA
// ═══════════════════════════════════════════════════════════════
async function pesquisarWeb(query) {
  if (process.env.BRAVE_API_KEY) {
    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5&lang=pt`;
      const res = await fetch(url, {
        headers: {
          "Accept":            "application/json",
          "Accept-Encoding":   "gzip",
          "X-Subscription-Token": process.env.BRAVE_API_KEY,
        },
      });
      if (res.ok) {
        const data = await res.json();
        const results = (data.web?.results || []).slice(0, 5).map(r =>
          `• ${r.title}\n  ${r.url}\n  ${r.description || ""}`
        ).join("\n\n");
        return results || "Nenhum resultado encontrado.";
      }
    } catch(e) {
      log("⚠️","SEARCH",e.message, C.gold);
    }
  }

  // Fallback: IA responde com conhecimento próprio
  try {
    const r = await openai.chat.completions.create({
      model:      CONFIG.MODEL_FAST,
      max_tokens: 800,
      messages: [
        { role:"system", content:"Responda a busca com seu conhecimento atual. Seja direto e factual." },
        { role:"user",   content:`Pesquisar: ${query}` },
      ],
    });
    return r.choices[0].message.content;
  } catch(e) {
    return `Pesquisa indisponível: ${e.message}`;
  }
}

// ═══════════════════════════════════════════════════════════════
//  ROTEADOR — intenções cloud-native
// ═══════════════════════════════════════════════════════════════
async function roteador(texto) {
  try {
    const r = await openai.chat.completions.create({
      model:       CONFIG.MODEL_FAST,
      max_tokens:  50,
      temperature: 0,
      messages: [{
        role:    "system",
        content: `Classifique o comando. Responda APENAS JSON:
{"intencao":"PALAVRA","agente":"NOME"}

INTENÇÃO: CONVERSAR|ANALISAR|MEMORIZAR|PESQUISAR|RAG|VISION|AGENTE|CODIGO|PLANEJAR|RESUMIR|DESCONHECIDO

AGENTE: CORE|ANALYST|RESEARCH|WRITER|CODER|MEMORY|PLANNER|VISION|ASSISTANT`,
      }, { role:"user", content:texto }],
    });
    return JSON.parse(r.choices[0].message.content.trim());
  } catch {
    return { intencao:"DESCONHECIDO", agente:"ASSISTANT" };
  }
}

// ═══════════════════════════════════════════════════════════════
//  SYSTEM PROMPT DINÂMICO — cloud-native (sem ações desktop)
// ═══════════════════════════════════════════════════════════════
function buildSystemPrompt(roteamento, ragContext="", agenteId="CORE", imagemAnalisada="") {
  const persona = (PERSONALITIES[CONFIG.PERSONALITY] || PERSONALITIES.sarcastico)();
  const agente  = AGENTS[agenteId] || AGENTS.CORE;

  return `${persona}

━━━ SISTEMA ━━━
Versão: ${VERSION} | Build: ${BUILD} | Modo: CLOUD
Agente: ${agente.nome} — ${agente.desc}
Idioma: ${CONFIG.LANG}

━━━ MEMÓRIA DO USUÁRIO ━━━
${mem.buildContext()}

━━━ CONTEXTO SEMÂNTICO (RAG) ━━━
${ragContext || "(sem contexto recuperado)"}

${imagemAnalisada ? `━━━ IMAGEM ANALISADA ━━━\n${imagemAnalisada}\n` : ""}
━━━ INTENÇÃO ━━━
${roteamento.intencao} → Agente: ${roteamento.agente}

━━━ REGRAS ABSOLUTAS ━━━
1. Responda SOMENTE JSON válido. ZERO texto fora. ZERO markdown.
2. Use APENAS as ações listadas abaixo.
3. Máximo 6 ações por resposta.
4. Para resposta apenas verbal: use {"tipo":"conversar","mensagem":"..."}
5. Detectou fato relevante? Inclua {"tipo":"memorizar","chave":"...","valor":"..."}
6. Seja PROATIVO: sugira melhorias, questione quando necessário, ofereça alternativas.
7. Para perguntas ambíguas, PERGUNTE antes de agir.
8. Você está em modo CLOUD — sem acesso ao desktop do usuário.

━━━ AÇÕES DISPONÍVEIS ━━━
{"tipo":"conversar","mensagem":"resposta natural ao usuário"}
{"tipo":"memorizar","chave":"...","valor":"..."}
{"tipo":"rag_salvar","texto":"conteúdo para memorizar semanticamente","meta":{"tipo":"..."}}
{"tipo":"rag_buscar","query":"busca na memória semântica"}
{"tipo":"analisar_imagem","pergunta":"pergunta específica sobre a imagem enviada"}
{"tipo":"pesquisar_web","query":"busca na web"}
{"tipo":"gerar_resumo","conteudo":"texto a resumir","foco":"..."}
{"tipo":"planejar","objetivo":"...","contexto":"..."}
{"tipo":"codigo","linguagem":"python|js|...", "descricao":"o que o código deve fazer"}
{"tipo":"workflow","passos":["passo 1","passo 2"]}

━━━ FORMATO DE RESPOSTA ━━━
{"raciocinio":"o que estou fazendo em 1 linha","agente_usado":"${agenteId}","acoes":[...]}`.trim();
}

// ═══════════════════════════════════════════════════════════════
//  EXECUTOR DE AÇÕES CLOUD
// ═══════════════════════════════════════════════════════════════
async function executarAcoesCloud(acoes, sid, imagemB64="") {
  const resultados = [];

  for (const acao of acoes) {
    const tipo = acao.tipo;

    try {
      switch(tipo) {

        case "conversar":
          resultados.push({ tipo, resultado: acao.mensagem || "" });
          break;

        case "memorizar":
          if (acao.chave && acao.valor !== undefined) {
            mem.addFact(acao.chave, acao.valor);
            resultados.push({ tipo, resultado:`Fato memorizado: ${acao.chave}` });
          }
          break;

        case "rag_salvar":
          if (acao.texto) {
            const id = await mem.addDocument(acao.texto, acao.meta || {});
            resultados.push({ tipo, resultado:`Documento vetorizado: ${id}` });
          }
          break;

        case "rag_buscar": {
          const docs = await mem.buscarSimilar(acao.query || "", 5, 0.65);
          const resp = docs.length
            ? docs.map(d=>`[${d.score.toFixed(2)}] ${d.text.slice(0,200)}`).join("\n")
            : "Nenhum resultado relevante encontrado na memória.";
          resultados.push({ tipo, resultado: resp });
          break;
        }

        case "analisar_imagem": {
          const b64 = imagemB64 || acao.base64 || "";
          if (!b64) {
            resultados.push({ tipo, resultado:"Nenhuma imagem fornecida para análise." });
            break;
          }
          const analise = await analisarImagem(b64, acao.pergunta || "O que está nesta imagem?");
          resultados.push({ tipo, resultado: analise });
          break;
        }

        case "pesquisar_web": {
          const resultado = await pesquisarWeb(acao.query || "");
          resultados.push({ tipo, resultado });
          break;
        }

        case "gerar_resumo": {
          const r = await openai.chat.completions.create({
            model:      CONFIG.MODEL_PRIMARY,
            max_tokens: 800,
            messages: [
              { role:"system", content:`${(PERSONALITIES[CONFIG.PERSONALITY]||PERSONALITIES.sarcastico)()}\nResuma o conteúdo a seguir. Foco: ${acao.foco||"geral"}` },
              { role:"user",   content: acao.conteudo || texto },
            ],
          });
          resultados.push({ tipo, resultado: r.choices[0].message.content });
          break;
        }

        case "planejar": {
          const r = await openai.chat.completions.create({
            model:      CONFIG.MODEL_PRIMARY,
            max_tokens: 1000,
            messages: [
              { role:"system", content:`${(PERSONALITIES[CONFIG.PERSONALITY]||PERSONALITIES.sarcastico)()}\nCrie um plano de execução detalhado. Seja específico e realista.` },
              { role:"user",   content:`Objetivo: ${acao.objetivo}\nContexto: ${acao.contexto||""}` },
            ],
          });
          resultados.push({ tipo, resultado: r.choices[0].message.content });
          break;
        }

        case "codigo": {
          const r = await openai.chat.completions.create({
            model:      CONFIG.MODEL_PRIMARY,
            max_tokens: 1500,
            messages: [
              { role:"system", content:`Você é um engenheiro de software sênior. Gere código ${acao.linguagem||"python"} limpo, funcional e comentado.` },
              { role:"user",   content: acao.descricao || "Gere um exemplo básico" },
            ],
          });
          resultados.push({ tipo, resultado: r.choices[0].message.content });
          break;
        }

        case "workflow": {
          const passos = (acao.passos || []).join("\n");
          const r = await openai.chat.completions.create({
            model:      CONFIG.MODEL_PRIMARY,
            max_tokens: 1000,
            messages: [
              { role:"system", content:`${(PERSONALITIES[CONFIG.PERSONALITY]||PERSONALITIES.sarcastico)()}\nAnalise e execute este workflow passo a passo.` },
              { role:"user",   content:`Passos:\n${passos}` },
            ],
          });
          resultados.push({ tipo, resultado: r.choices[0].message.content });
          break;
        }

        default:
          resultados.push({ tipo, resultado:`Ação "${tipo}" não disponível no modo cloud.` });
      }
    } catch(e) {
      resultados.push({ tipo, erro: e.message });
      log("⚠️","EXEC",`${tipo}: ${e.message}`, C.gold);
    }
  }

  return resultados;
}

// ═══════════════════════════════════════════════════════════════
//  AGENTE AUTÔNOMO — cloud-native
// ═══════════════════════════════════════════════════════════════
async function executarAgente(objetivo, sid, onStep) {
  log("🤖","AGENT",objetivo.slice(0,80), C.orange);
  broadcast("status", { fase:"agente_iniciado", sid, objetivo });
  setAgentStatus("CORE","running","Planejando: "+objetivo.slice(0,40));

  const ragDocs = await mem.buscarSimilar(objetivo, 4);
  const ragCtx  = ragDocs.map(d => d.text.slice(0,200)).join("\n");

  // Planejamento inicial
  const planoResp = await openai.chat.completions.create({
    model:       CONFIG.MODEL_PRIMARY,
    max_tokens:  2000,
    temperature: 0.1,
    messages: [{
      role:    "system",
      content: `${(PERSONALITIES[CONFIG.PERSONALITY]||PERSONALITIES.sarcastico)()}

Você é JARVIS CORE — orquestrador de agentes cloud.
Agentes disponíveis: ${Object.entries(AGENTS).map(([k,v])=>`${k}(${v.desc})`).join("; ")}

Crie um plano de execução. Responda APENAS JSON:
{
  "objetivo":"...",
  "complexidade":"baixa|media|alta",
  "passos":[
    {"passo":1,"agente":"ANALYST","descricao":"...","acao_tipo":"analisar_imagem|pesquisar_web|conversar|..."}
  ]
}`,
    }, {
      role:    "user",
      content: `Objetivo: ${objetivo}\nContexto RAG: ${ragCtx.slice(0,300)}`,
    }],
  });

  let plan;
  try {
    plan = JSON.parse(planoResp.choices[0].message.content.replace(/```json|```/g,"").trim());
    log("📋","PLAN",`${plan.passos?.length} passos | ${plan.complexidade}`, C.orange);
    broadcast("status", { fase:"agente_plano", sid, plan });
  } catch {
    return { erro:"Falha no planejamento", objetivo };
  }

  const historico  = [];
  const resultados = [];
  let   passo      = 0;

  while (passo < CONFIG.AGENT_MAX_STEPS) {
    passo++;
    const passoInfo = plan.passos?.[passo-1];
    const agenteId  = passoInfo?.agente || "ASSISTANT";
    setAgentStatus(agenteId, "running", passoInfo?.descricao || `Passo ${passo}`);

    const ragPasso = await mem.buscarSimilar(objetivo, 3);
    const ragStep  = ragPasso.map(d => d.text.slice(0,180)).join("\n");

    broadcast("status", { fase:"agente_passo", sid, passo, agente:agenteId, desc:passoInfo?.descricao });

    const resp = await openai.chat.completions.create({
      model:       CONFIG.MODEL_PRIMARY,
      max_tokens:  1500,
      temperature: 0.12,
      messages: [
        { role:"system", content:buildSystemPrompt({intencao:"AGENTE",agente:agenteId}, ragStep, agenteId) },
        ...historico.slice(-6),
        {
          role:    "user",
          content: `OBJETIVO: ${objetivo}
PASSO ATUAL (${passo}/${CONFIG.AGENT_MAX_STEPS}): ${passoInfo?.descricao || "continuar"}
PROGRESSO: ${resultados.map(r=>r.desc).slice(-4).join(" → ") || "início"}
RESULTADOS RECENTES: ${JSON.stringify(resultados.slice(-3))}

Próxima ação do agente ${agenteId}?
CONCLUÍDO: {"raciocinio":"...","agente_usado":"${agenteId}","acoes":[{"tipo":"conversar","mensagem":"CONCLUÍDO: ..."}]}
BLOQUEADO: {"raciocinio":"...","agente_usado":"${agenteId}","acoes":[{"tipo":"conversar","mensagem":"BLOQUEIO: ..."}]}`,
        },
      ],
    });

    const rawStep = resp.choices[0].message.content.replace(/```json|```/g,"").trim();
    let   stepPlan;
    try { stepPlan = JSON.parse(rawStep); } catch { break; }

    const acoes  = stepPlan.acoes || [];
    const conv   = acoes.find(a => a.tipo === "conversar");
    const isFim  = conv && acoes.filter(a => !["conversar","memorizar"].includes(a.tipo)).length === 0;

    historico.push({ role:"assistant", content:rawStep });
    log("🤖",`[${passo}/${agenteId}]`,stepPlan.raciocinio||"", C.orange);

    // Executa ações cloud
    const execResults = await executarAcoesCloud(acoes, sid);

    for (const res of execResults) {
      if (res.tipo === "memorizar") {/* já tratado dentro do executor */}
    }

    resultados.push({
      passo,
      agente:     agenteId,
      desc:       stepPlan.raciocinio || `Passo ${passo}`,
      resultado:  execResults.map(r => r.resultado || r.erro || "").filter(Boolean).join(" | "),
    });

    onStep && onStep(passo, agenteId, execResults[0]?.resultado);
    broadcast("status", { fase:"agente_passo_ok", sid, passo, agente:agenteId, resultado:execResults[0]?.resultado });
    mem.push("assistant", `[${agenteId}] Passo ${passo}: ${stepPlan.raciocinio}`);
    setAgentStatus(agenteId, "idle");

    if (isFim) {
      resultados.push({ passo, agente:agenteId, desc:conv.mensagem, status:"CONCLUIDO" });
      onStep && onStep(passo, agenteId, conv.mensagem);
      broadcast("status", { fase:"agente_concluido", sid, passo, mensagem:conv.mensagem });
      setAgentStatus("CORE","idle");
      return { concluido:true, passo, mensagem:conv.mensagem, historico:resultados };
    }
  }

  setAgentStatus("CORE","idle");
  return {
    concluido: false,
    passo,
    mensagem:  `Executei ${passo} passos, ${CONFIG.USER_NAME}. Parece que isso precisa de mais contexto.`,
    historico: resultados,
  };
}

// ═══════════════════════════════════════════════════════════════
//  HELPER — separa ações internas
// ═══════════════════════════════════════════════════════════════
const INTERNAS = new Set(["memorizar","rag_salvar","rag_buscar","conversar"]);

// ═══════════════════════════════════════════════════════════════
//  ROTAS REST
// ═══════════════════════════════════════════════════════════════

// Config pública
app.get("/api/config", (_req, res) => res.json({
  version:     VERSION,
  build:       BUILD,
  cloudMode:   CLOUD_MODE,
  eleven:      { active:!!(CONFIG.ELEVEN_KEY&&CONFIG.ELEVEN_VOICE), model:CONFIG.ELEVEN_MODEL, voiceId:CONFIG.ELEVEN_VOICE||null },
  models:      { primary:CONFIG.MODEL_PRIMARY, fast:CONFIG.MODEL_FAST, stt:CONFIG.MODEL_STT },
  personality: CONFIG.PERSONALITY,
  userName:    CONFIG.USER_NAME,
  wakeWord:    CONFIG.WAKE_WORD,
  ttsAuto:     CONFIG.TTS_AUTO,
  agentes:     Object.entries(AGENTS).map(([k,v])=>({id:k,...v})),
}));

// Health check (Render/Railway usam isso)
app.get("/health", (_req, res) => res.json({ status:"ok", ts:Date.now(), version:VERSION }));
app.get("/ping",   (_req, res) => res.send("pong"));

// ── POST /comando ────────────────────────────────────────────
app.post("/comando", async (req, res) => {
  let { texto, audio:audioB64, audioMime, screenshot:imgB64, tts, modo } = req.body;

  // STT
  if (audioB64 && !texto) {
    broadcast("status", { fase:"transcrevendo_voz" });
    const stt = await transcreverAudio(audioB64, audioMime || "audio/webm");
    if (stt.erro) return res.status(400).json({ erro:stt.erro });
    texto = stt.texto;
    broadcast("status", { fase:"voz_transcrita", texto });
  }

  if (!texto?.trim()) return res.status(400).json({ erro:"Forneça 'texto' ou 'audio'" });

  const gerarAudio = tts===true || tts==="true" || CONFIG.TTS_AUTO;
  const sid        = crypto.randomUUID().slice(0,8);

  log("📥","CMD",`[${sid}] ${texto}`, C.cyan);
  broadcast("status", { fase:"recebido", sid, texto });
  setAgentStatus("CORE","running",texto.slice(0,40));

  try {
    const roteamento = await roteador(texto);
    log("🎯","ROUTE",`${roteamento.intencao} → ${roteamento.agente}`, C.purple);
    broadcast("status", { fase:"roteado", sid, ...roteamento });

    // Modo agente para tarefas complexas
    const isAgente = modo==="agente" || roteamento.intencao==="AGENTE" ||
      /preciso (que você|analise|crie|gere|organize|automatize|faça|monte|construa)/i.test(texto) ||
      /fluxo completo|workflow|múltiplos passos|em sequência|passo a passo completo/i.test(texto);

    if (isAgente) {
      const agResult = await executarAgente(texto, sid, (p,ag,r) => {
        broadcast("agente_step", { sid, passo:p, agente:ag, resultado:r });
      });
      const resposta = agResult.mensagem || "Missão processada.";
      mem.push("user", texto);
      mem.push("assistant", resposta);
      auditLog({ sid, ...roteamento, texto, modo:"agente", resultado:agResult });
      const payload = { sid, ...roteamento, modo:"agente", resposta, detalhe:agResult };
      if (gerarAudio) {
        const f = await gerarFala(resposta);
        if (!f.erro) Object.assign(payload, { audio:f.audio, audioMime:f.mime, ttsEngine:f.engine });
      }
      setAgentStatus("CORE","idle");
      return res.json(payload);
    }

    // Análise de imagem se enviada
    let imagemAnalisada = "";
    if (imgB64) {
      setAgentStatus("VISION","running","Analisando imagem");
      imagemAnalisada = await analisarImagem(imgB64, texto);
      setAgentStatus("VISION","idle");
    }

    // RAG semântico
    const ragDocs = await mem.buscarSimilar(texto, 5, 0.68);
    const ragCtx  = ragDocs.map(d=>`[${d.meta?.tipo||"doc"}] ${d.text.slice(0,200)}`).join("\n");

    mem.push("user", texto);
    broadcast("status", { fase:"raciocinando", sid });
    setAgentStatus(roteamento.agente || "CORE","running",texto.slice(0,40));

    // IA principal
    const messages = [
      { role:"system", content:buildSystemPrompt(roteamento, ragCtx, roteamento.agente||"CORE", imagemAnalisada) },
      ...mem.getRecent(10).map(m => ({ role:m.role, content:String(m.content) })),
      { role:"user", content:texto },
    ];

    const completion = await openai.chat.completions.create({
      model:       CONFIG.MODEL_PRIMARY,
      max_tokens:  1500,
      temperature: 0.25,
      messages,
    });

    let raw = completion.choices[0].message.content.replace(/```json\n?|```\n?/g,"").trim();
    log("🧠","IA",raw.slice(0,200), C.gold);

    let plano;
    try { plano = JSON.parse(raw); }
    catch {
      const match = raw.match(/\{[\s\S]+\}/);
      if (match) { try { plano=JSON.parse(match[0]); } catch { return res.json({ resposta:raw }); } }
      else return res.json({ resposta:raw });
    }

    broadcast("status", { fase:"executando", sid, plano });
    const acoesFinais   = plano.acoes || [];
    const acaoConversar = acoesFinais.find(a => a.tipo==="conversar");

    // Executa ações cloud
    const execResults = await executarAcoesCloud(acoesFinais, sid, imgB64||"");

    // Monta resposta final
    const respostas = execResults
      .filter(r => r.resultado && r.tipo !== "memorizar" && r.tipo !== "rag_salvar")
      .map(r => r.resultado)
      .filter(Boolean);

    let respostaFinal = acaoConversar?.mensagem
      || respostas.join("\n\n")
      || execResults[0]?.resultado
      || "Processado.";

    // Se houve pesquisa/análise, sintetiza com a personalidade
    if (execResults.some(r => ["pesquisar_web","rag_buscar","analisar_imagem","gerar_resumo","planejar","codigo","workflow"].includes(r.tipo))) {
      const contexto = execResults.map(r => r.resultado || "").filter(Boolean).join("\n\n");
      if (contexto && !acaoConversar) {
        try {
          const synth = await openai.chat.completions.create({
            model:       CONFIG.MODEL_FAST,
            max_tokens:  600,
            temperature: 0.3,
            messages: [
              { role:"system", content:(PERSONALITIES[CONFIG.PERSONALITY]||PERSONALITIES.sarcastico)() },
              { role:"user",   content:`Responda ao usuário com base neste contexto. Comando original: "${texto}"\n\nContexto coletado:\n${contexto.slice(0,2000)}` },
            ],
          });
          respostaFinal = synth.choices[0].message.content;
        } catch {}
      }
    }

    mem.push("assistant", respostaFinal);
    auditLog({ sid, ...roteamento, texto, plano, execResults });
    setAgentStatus(roteamento.agente||"CORE","idle");

    broadcast("status", { fase:"concluido", sid });

    const payloadFinal = {
      sid,
      ...roteamento,
      raciocinio: plano.raciocinio || "",
      resposta:   respostaFinal,
      acoes:      acoesFinais,
    };

    if (gerarAudio) {
      const f = await gerarFala(respostaFinal);
      if (!f.erro) Object.assign(payloadFinal, { audio:f.audio, audioMime:f.mime, ttsEngine:f.engine });
    }

    return res.json(payloadFinal);

  } catch(e) {
    log("💥","ERR",e.message, C.red);
    broadcast("status", { fase:"erro", sid, erro:e.message });
    auditLog({ sid, texto, erro:e.message });
    setAgentStatus("CORE","idle");
    return res.status(500).json({ erro:"Erro interno", detalhe:e.message });
  }
});

// ── POST /agente ─────────────────────────────────────────────
app.post("/agente", async (req, res) => {
  let { objetivo, audio, audioMime, tts } = req.body;
  if (audio && !objetivo) {
    const stt = await transcreverAudio(audio, audioMime||"audio/webm");
    if (stt.erro) return res.status(400).json({ erro:stt.erro });
    objetivo = stt.texto;
  }
  if (!objetivo?.trim()) return res.status(400).json({ erro:"objetivo obrigatório" });

  const sid        = crypto.randomUUID().slice(0,8);
  const gerarAudio = tts===true || tts==="true" || CONFIG.TTS_AUTO;

  const result = await executarAgente(objetivo, sid, (p,ag,r) => {
    broadcast("agente_step", { sid, passo:p, agente:ag, resultado:r });
  });

  mem.push("user", objetivo);
  mem.push("assistant", result.mensagem || "Concluído");
  auditLog({ sid, tipo:"agente", objetivo, resultado:result });

  const payload = { sid, ...result };
  if (gerarAudio && result.mensagem) {
    const f = await gerarFala(result.mensagem);
    if (!f.erro) Object.assign(payload, { audio:f.audio, audioMime:f.mime, ttsEngine:f.engine });
  }
  res.json(payload);
});

// ── POST /voz/transcrever ─────────────────────────────────────
app.post("/voz/transcrever", async (req, res) => {
  const { audio, mime } = req.body;
  if (!audio) return res.status(400).json({ erro:"audio obrigatório" });
  res.json(await transcreverAudio(audio, mime||"audio/webm"));
});

// ── POST /voz/falar ───────────────────────────────────────────
app.post("/voz/falar", async (req, res) => {
  const { texto, stability, similarity, style, engine } = req.body;
  if (!texto) return res.status(400).json({ erro:"texto obrigatório" });
  if (engine === "openai") {
    try {
      const mp3 = await openai.audio.speech.create({
        model:CONFIG.MODEL_TTS, voice:CONFIG.TTS_VOICE,
        input:String(texto).slice(0,4096), response_format:"mp3",
      });
      const buf = Buffer.from(await mp3.arrayBuffer());
      return res.json({ audio:buf.toString("base64"), mime:"audio/mpeg", engine:"openai" });
    } catch(e) { return res.status(500).json({ erro:e.message }); }
  }
  res.json(await gerarFala(texto, { stability, similarity, style }));
});

// ── POST /visao ───────────────────────────────────────────────
app.post("/visao", async (req, res) => {
  const { imagem, pergunta } = req.body;
  if (!imagem) return res.status(400).json({ erro:"imagem obrigatória" });
  res.json({ analise:await analisarImagem(imagem, pergunta) });
});

// ── POST /pesquisar ───────────────────────────────────────────
app.post("/pesquisar", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ erro:"query obrigatória" });
  res.json({ resultado:await pesquisarWeb(query) });
});

// ── RAG ────────────────────────────────────────────────────────
app.post("/rag/salvar", async (req, res) => {
  const { texto, meta } = req.body;
  if (!texto) return res.status(400).json({ erro:"texto obrigatório" });
  const id = await mem.addDocument(texto, meta||{});
  res.json({ ok:true, id, total:mem.vectors.length });
});

app.post("/rag/buscar", async (req, res) => {
  const { query, topK, minScore } = req.body;
  if (!query) return res.status(400).json({ erro:"query obrigatória" });
  const docs = await mem.buscarSimilar(query, topK||5, minScore||0.65);
  res.json({ resultados:docs.map(d=>({ id:d.id, texto:d.text, score:d.score, meta:d.meta, ts:d.ts })) });
});

app.get("/rag/stats", (_req, res) => res.json({
  total: mem.vectors.length,
  tipos: [...new Set(mem.vectors.map(v=>v.meta?.tipo).filter(Boolean))],
}));

// ── Memória ────────────────────────────────────────────────────
app.get("/memoria", (_req, res) => res.json({
  ...mem.getStats(),
  longTerm: mem.longTerm.slice(-20),
  facts:    mem.facts,
}));

app.post("/memoria/fato", (req, res) => {
  const { chave, valor } = req.body;
  if (!chave) return res.status(400).json({ erro:"chave obrigatória" });
  mem.addFact(chave, valor);
  res.json({ ok:true });
});

app.delete("/memoria", (_req, res) => {
  mem.shortTerm = []; mem.longTerm = []; mem.facts = {}; mem.save();
  broadcast("memory_update", { type:"reset" });
  res.json({ ok:true });
});

// ── Agentes ────────────────────────────────────────────────────
app.get("/agentes", (_req, res) => res.json(
  Object.entries(AGENTS).map(([k,v]) => ({ id:k, ...v, status:agentStatus[k] }))
));

// ── Personalidade ──────────────────────────────────────────────
app.post("/personalidade", (req, res) => {
  const { tipo } = req.body;
  if (!PERSONALITIES[tipo]) return res.status(400).json({ erro:`Válidos: ${Object.keys(PERSONALITIES).join(", ")}` });
  CONFIG.PERSONALITY = tipo;
  broadcast("config_update", { personality:tipo });
  log("🎭","PERSONA",tipo, C.purple);
  res.json({ ok:true, personalidade:tipo });
});

// ── Logs ────────────────────────────────────────────────────────
app.get("/log", (req, res) => {
  const n = parseInt(req.query.n) || 50;
  try {
    const lines = fs.readFileSync(CONFIG.LOG_FILE,"utf8")
      .trim().split("\n").filter(Boolean)
      .slice(-n).map(l => JSON.parse(l));
    res.json(lines);
  } catch { res.json([]); }
});

// ── Status ─────────────────────────────────────────────────────
app.get("/status", (_req, res) => res.json({
  status:      "online",
  version:     VERSION,
  build:       BUILD,
  cloudMode:   CLOUD_MODE,
  sessionId:   mem.sessionId,
  memoria:     mem.getStats(),
  wsClients:   clients.size,
  models:      { primary:CONFIG.MODEL_PRIMARY, fast:CONFIG.MODEL_FAST, vision:CONFIG.MODEL_VISION, stt:CONFIG.MODEL_STT, tts:CONFIG.MODEL_TTS, embed:CONFIG.MODEL_EMBED },
  voice:       { elevenlabs:!!(CONFIG.ELEVEN_KEY&&CONFIG.ELEVEN_VOICE), voiceId:CONFIG.ELEVEN_VOICE||null, model:CONFIG.ELEVEN_MODEL, openaiVoz:CONFIG.TTS_VOICE, ttsAuto:CONFIG.TTS_AUTO },
  personality: CONFIG.PERSONALITY,
  lang:        CONFIG.LANG,
  userName:    CONFIG.USER_NAME,
  wakeWord:    CONFIG.WAKE_WORD,
  agentMaxSteps: CONFIG.AGENT_MAX_STEPS,
  agentes:     Object.keys(AGENTS),
  agentStatus,
  uptime:      Math.floor(process.uptime()),
  brave:       !!process.env.BRAVE_API_KEY,
}));

// ── Catch-all → index.html (SPA) ──────────────────────────────
app.get("*", (_req, res) => {
  const p = path.join(__dirname, "index.html");
  if (fs.existsSync(p)) res.sendFile(p);
  else res.status(404).send("index.html não encontrado");
});

// ═══════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════
server.listen(PORT, () => {
  console.log("");
  console.log(`${C.gold}${C.bold}  ╔═══════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.gold}${C.bold}  ║  JARVIS ${VERSION} — ${BUILD}        ║${C.reset}`);
  console.log(`${C.gold}${C.bold}  ╚═══════════════════════════════════════════════╝${C.reset}`);
  console.log(`${C.cyan}  🌐  Porta: ${PORT}${C.reset}`);
  console.log(`${C.cyan}  🔌  WebSocket: ws://[host]:${PORT}${C.reset}`);
  console.log(`${C.green}  🧠  ${CONFIG.MODEL_PRIMARY} | ⚡ ${CONFIG.MODEL_FAST}${C.reset}`);
  if (CONFIG.ELEVEN_KEY) {
    console.log(`${C.teal}  🔊  ElevenLabs ✓ [${CONFIG.ELEVEN_VOICE||"configure ELEVENLABS_VOICE_ID"}]${C.reset}`);
  } else {
    console.log(`${C.gold}  🔊  OpenAI TTS [${CONFIG.TTS_VOICE}] — adicione ELEVENLABS_API_KEY para voz expressiva${C.reset}`);
  }
  if (process.env.BRAVE_API_KEY) {
    console.log(`${C.green}  🔍  Brave Search ✓${C.reset}`);
  } else {
    console.log(`${C.gold}  🔍  Pesquisa web via IA (adicione BRAVE_API_KEY para resultados reais)${C.reset}`);
  }
  console.log(`${C.orange}  🤖  Agentes: ${Object.keys(AGENTS).join(" · ")}${C.reset}`);
  console.log(`${C.purple}  🎭  ${CONFIG.PERSONALITY} | wake: "${CONFIG.WAKE_WORD}" | user: "${CONFIG.USER_NAME}"${C.reset}`);
  console.log(`${C.green}  📚  ${mem.longTerm.length} ep | ${Object.keys(mem.facts).length} fatos | ${mem.vectors.length} vetores${C.reset}`);
  console.log("");
});

process.on("SIGTERM", () => { mem.save(); server.close(() => process.exit(0)); });
process.on("SIGINT",  () => { mem.save(); process.exit(0); });
process.on("unhandledRejection", r => log("⚠️","UNHANDLED",String(r), C.gold));
process.on("uncaughtException",  e => log("💥","EXCEPTION",e.message, C.red));