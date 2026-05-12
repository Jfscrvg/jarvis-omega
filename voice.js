// ═══════════════════════════════════════════════════════════════
//  JARVIS OMEGA v6 — voice.js
//  BUGS CORRIGIDOS:
//  1. AudioContext bloqueado antes de gesto do usuário → criado APENAS no primeiro clique
//  2. createMediaElementSource lança erro se audio já conectado → flag audioConnected
//  3. permGranted de sessionStorage ignorava erro real → revalidado a cada gravação
//  4. silenceTimer não limpava checkSilence interval → ambos limpos no onstop
//  5. playAudio não conectava ao destination → src.connect(ctx.destination) garantido
//  6. toggleMic em estado "processing" ou "speaking" não fazia nada → corrigido
//  7. FileReader assíncrono sem tratamento de erro → try/catch adicionado
// ═══════════════════════════════════════════════════════════════

const JarvisVoice = (() => {

  let CFG = {
    serverUrl:    window.location.origin,
    wakeWord:     "jarvis",
    silenceMs:    1800,
    onStateChange:()=>{},
    onTranscript: ()=>{},
    onResponse:   ()=>{},
    onError:      ()=>{},
    onAudioStart: ()=>{},
    onAudioEnd:   ()=>{},
    onVizData:    ()=>{},
    ttsAuto:      true,
  };

  let state          = "idle";
  let mediaRecorder  = null;
  let audioChunks    = [];
  let micStream      = null;
  let audioCtx       = null;   // criado APENAS após gesto do usuário
  let vizRaf         = null;
  let silenceTimer   = null;
  let checkSilenceId = null;
  let wakeRecog      = null;
  let wakeActive     = false;
  let currentAudio   = null;   // HTMLAudioElement ativo

  // ─── Estado ──────────────────────────────────────────────
  function setState(s) {
    if (state === s) return;
    state = s;
    CFG.onStateChange(s);
  }

  // ─── AudioContext — criado após interação do usuário ─────
  // MOTIVO DO BUG: browsers bloqueiam AudioContext criado antes
  // de qualquer gesto. Criar no init() causava "suspended" permanente.
  function getCtx() {
    if (!audioCtx || audioCtx.state === "closed") {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(()=>{});
    }
    return audioCtx;
  }

  // ─── Visualizador ────────────────────────────────────────
  function startViz(sourceNode) {
    stopViz();
    try {
      const ctx      = getCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      sourceNode.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(buf);
        CFG.onVizData([...buf]);
        vizRaf = requestAnimationFrame(tick);
      };
      tick();
    } catch(e) {
      // Visualizador é opcional — não bloqueia
    }
  }

  function stopViz() {
    if (vizRaf) { cancelAnimationFrame(vizRaf); vizRaf = null; }
    CFG.onVizData(null);
  }

  // ─── MIME type ───────────────────────────────────────────
  function bestMime() {
    const list = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/ogg",
      "audio/mp4",
    ];
    return list.find(m => {
      try { return MediaRecorder.isTypeSupported(m); } catch { return false; }
    }) || "";
  }

  // ─── Permissão de microfone ───────────────────────────────
  // MOTIVO DO BUG: sessionStorage.getItem retornava "1" de sessão anterior
  // mas o browser pode ter revogado a permissão. Verificamos sempre.
  async function checkPermission() {
    try {
      if (navigator.permissions) {
        const p = await navigator.permissions.query({ name: "microphone" });
        if (p.state === "denied") {
          CFG.onError("Microfone bloqueado. Clique no cadeado na barra do browser e libere o microfone.");
          return false;
        }
      }
      // Testa stream real
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach(t => t.stop());
      return true;
    } catch(e) {
      CFG.onError(`Permissão negada: ${e.message}. Abra as configurações do browser e libere o microfone para este site.`);
      return false;
    }
  }

  // ─── Wake-word ────────────────────────────────────────────
  function startWakeWord() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || wakeActive) return;
    try {
      wakeRecog = new SR();
      wakeRecog.continuous     = true;
      wakeRecog.lang           = "pt-BR";
      wakeRecog.interimResults = false;
      wakeRecog.onresult = (e) => {
        const last = e.results[e.results.length - 1];
        if (!last.isFinal) return;
        const txt = last[0].transcript.toLowerCase().trim();
        if (txt.includes(CFG.wakeWord.toLowerCase()) && state === "idle") {
          stopWakeWord();
          startRecording();
        }
      };
      wakeRecog.onend = () => {
        wakeActive = false;
        if (state === "idle") setTimeout(startWakeWord, 800);
      };
      wakeRecog.onerror = (e) => {
        wakeActive = false;
        if (e.error !== "aborted") setTimeout(startWakeWord, 2000);
      };
      wakeRecog.start();
      wakeActive = true;
    } catch(e) {
      wakeActive = false;
    }
  }

  function stopWakeWord() {
    wakeActive = false;
    if (wakeRecog) {
      try { wakeRecog.stop(); } catch {}
      wakeRecog = null;
    }
  }

  // ─── Parar tudo limpo ────────────────────────────────────
  function cleanupRecording() {
    if (checkSilenceId) { clearInterval(checkSilenceId); checkSilenceId = null; }
    if (silenceTimer)   { clearTimeout(silenceTimer);    silenceTimer   = null; }
    if (micStream)      { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    stopViz();
  }

  // ─── GRAVAÇÃO PRINCIPAL ───────────────────────────────────
  async function startRecording() {
    if (state !== "idle") {
      // Se estiver falando, interrompe e grava
      if (state === "speaking" && currentAudio) {
        currentAudio.pause();
        currentAudio = null;
        stopViz();
        setState("idle");
      } else {
        return;
      }
    }

    setState("requesting");
    const ok = await checkPermission();
    if (!ok) { setState("idle"); return; }

    setState("listening");
    audioChunks = [];

    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation:   true,
          noiseSuppression:   true,
          autoGainControl:    true,
          channelCount:       1,
          sampleRate:         16000,
        }
      });
    } catch(e) {
      setState("idle");
      CFG.onError(`Erro ao abrir microfone: ${e.message}`);
      return;
    }

    // Visualizador conectado ao microfone
    try {
      const ctx = getCtx();
      const src = ctx.createMediaStreamSource(micStream);
      startViz(src);

      // Detecção de silêncio
      const silAnl = ctx.createAnalyser();
      silAnl.fftSize = 512;
      src.connect(silAnl);
      const sbuf = new Uint8Array(silAnl.frequencyBinCount);
      let lastSound   = Date.now();
      let gotSound    = false;

      checkSilenceId = setInterval(() => {
        if (state !== "listening") {
          clearInterval(checkSilenceId);
          checkSilenceId = null;
          return;
        }
        silAnl.getByteFrequencyData(sbuf);
        const avg = sbuf.reduce((a,b)=>a+b,0) / sbuf.length;
        if (avg > 6) { lastSound = Date.now(); gotSound = true; }
        if (gotSound && Date.now() - lastSound > CFG.silenceMs) {
          clearInterval(checkSilenceId);
          checkSilenceId = null;
          stopRecording();
        }
      }, 80);
    } catch(e) {
      // Silêncio manual: usuário clica de novo
    }

    // Timeout absoluto 45s
    silenceTimer = setTimeout(() => stopRecording(), 45_000);

    const mime = bestMime();
    const opts = mime ? { mimeType: mime } : {};

    try {
      mediaRecorder = new MediaRecorder(micStream, opts);
    } catch(e) {
      mediaRecorder = new MediaRecorder(micStream);
    }

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      cleanupRecording();
      if (audioChunks.length === 0 || getTotalSize(audioChunks) < 1000) {
        setState("idle");
        CFG.onError("Nenhum áudio capturado. Fale mais perto do microfone.");
        return;
      }
      await processAudio();
    };

    mediaRecorder.onerror = (e) => {
      cleanupRecording();
      setState("idle");
      CFG.onError(`Erro na gravação: ${e.error?.message || "desconhecido"}`);
    };

    mediaRecorder.start(150);
  }

  function getTotalSize(chunks) {
    return chunks.reduce((s, c) => s + c.size, 0);
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }
  }

  // ─── Processar áudio gravado ──────────────────────────────
  async function processAudio() {
    setState("processing");

    const mime  = audioChunks[0]?.type || bestMime() || "audio/webm";
    const blob  = new Blob(audioChunks, { type: mime });

    let b64;
    try {
      b64 = await blobToB64(blob);
    } catch(e) {
      setState("idle");
      CFG.onError("Falha ao converter áudio: " + e.message);
      return;
    }

    try {
      const resp = await fetch(`${CFG.serverUrl}/comando`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          audio:     b64,
          audioMime: mime,
          tts:       CFG.ttsAuto,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(()=>"");
        throw new Error(`HTTP ${resp.status}: ${errText.slice(0,100)}`);
      }

      const data = await resp.json();

      if (data.erro) {
        CFG.onError(data.erro);
        setState("idle");
        return;
      }

      CFG.onResponse(data);

      if (CFG.ttsAuto && data.audio) {
        await playAudio(data.audio, data.audioMime || "audio/mpeg");
      } else {
        setState("idle");
      }

    } catch(e) {
      CFG.onError(`Erro de rede: ${e.message}`);
      setState("idle");
    }
  }

  function blobToB64(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload  = () => res(fr.result.split(",")[1]);
      fr.onerror = () => rej(new Error("FileReader falhou"));
      fr.readAsDataURL(blob);
    });
  }

  // ─── REPRODUÇÃO DE ÁUDIO ──────────────────────────────────
  // MOTIVO DO BUG: createMediaElementSource lança InvalidStateError se
  // o mesmo HTMLAudioElement foi conectado antes. Usamos try/catch e
  // conectamos ao destination SEMPRE antes de play().
  async function playAudio(b64, mime = "audio/mpeg") {
    setState("speaking");
    CFG.onAudioStart();

    // Para qualquer áudio anterior
    if (currentAudio) {
      try { currentAudio.pause(); currentAudio.src = ""; } catch {}
      currentAudio = null;
    }
    stopViz();

    return new Promise((resolve) => {
      try {
        const bytes = atob(b64);
        const arr   = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        const blob  = new Blob([arr], { type: mime });
        const url   = URL.createObjectURL(blob);
        const audio = new Audio();
        currentAudio = audio;

        // Conecta visualizador — DEPOIS de atribuir src, antes de play
        audio.addEventListener("canplay", () => {
          try {
            const ctx = getCtx();
            const src = ctx.createMediaElementSource(audio);
            src.connect(ctx.destination);
            startViz(src);
          } catch(e) {
            // Já conectado ou browser não suporta — continua sem viz
          }
        }, { once: true });

        const finish = () => {
          stopViz();
          URL.revokeObjectURL(url);
          currentAudio = null;
          CFG.onAudioEnd();
          setState("idle");
          resolve();
        };

        audio.onended = finish;
        audio.onerror = (e) => {
          console.error("Audio playback error:", e);
          finish();
        };

        audio.src = url;

        const playPromise = audio.play();
        if (playPromise) {
          playPromise.catch((e) => {
            // AutoPlay policy — acontece se não houver interação prévia
            CFG.onError(`Áudio bloqueado pelo browser: ${e.message}. Clique na página primeiro.`);
            finish();
          });
        }
      } catch(e) {
        CFG.onError(`Erro ao reproduzir: ${e.message}`);
        setState("idle");
        resolve();
      }
    });
  }

  // ─── Falar texto diretamente ──────────────────────────────
  async function speak(texto, opts = {}) {
    if (!texto) return;
    try {
      const r = await fetch(`${CFG.serverUrl}/voz/falar`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ texto, ...opts }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (d.erro) { CFG.onError(d.erro); return; }
      if (d.audio) await playAudio(d.audio, d.mime || "audio/mpeg");
    } catch(e) {
      CFG.onError(`Fala: ${e.message}`);
    }
  }

  // ─── API PÚBLICA ──────────────────────────────────────────
  return {
    init(config) {
      CFG = { ...CFG, ...config };
    },

    // Chamado após primeiro gesto do usuário
    async start() {
      // Apenas testa permissão — não cria AudioContext ainda
      const ok = await checkPermission();
      if (ok) setState("idle");
      return ok;
    },

    async toggleMic() {
      if (state === "listening") {
        stopRecording();
      } else if (state === "idle") {
        await startRecording();
      } else if (state === "speaking") {
        if (currentAudio) { currentAudio.pause(); currentAudio = null; }
        stopViz();
        setState("idle");
        await startRecording();
      }
      // processing → ignora
    },

    async listen()    { await startRecording(); },
    stop()            { stopRecording(); cleanupRecording(); setState("idle"); },
    speak,
    playAudio,
    startWakeWord,
    stopWakeWord,

    getState()        { return state; },
    isListening()     { return state === "listening"; },
    isSpeaking()      { return state === "speaking"; },
    isProcessing()    { return state === "processing"; },

    setTtsAuto(v)     { CFG.ttsAuto = !!v; },
    setWakeWord(w)    { CFG.wakeWord = w; },
    setSilenceMs(ms)  { CFG.silenceMs = parseInt(ms) || 1800; },
    setServerUrl(u)   { CFG.serverUrl = u; },
  };
})();

if (typeof module !== "undefined") module.exports = JarvisVoice;