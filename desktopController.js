// ═══════════════════════════════════════════════════════════════
//  JARVIS OMEGA v7 — desktopController.js
//  Controle real do computador via robotjs + nut.js + systeminformation
//  APENAS para execução LOCAL (não funciona em cloud)
//  Detecta ambiente automaticamente e gracefully degrada em cloud
// ═══════════════════════════════════════════════════════════════

const { exec, execSync, spawn } = require("child_process");
const os   = require("os");
const path = require("path");
const fs   = require("fs");

const IS_WINDOWS = process.platform === "win32";
const IS_MAC     = process.platform === "darwin";
const IS_LINUX   = process.platform === "linux";
const IS_CLOUD   = !!(process.env.RENDER || process.env.RAILWAY_ENVIRONMENT ||
                      process.env.FLY_APP_NAME || process.env.HEROKU_APP_NAME ||
                      process.env.VERCEL || !process.env.DISPLAY && IS_LINUX);

// ── Imports opcionais — falham silenciosamente em cloud ──────
let robot = null;
let si     = null;
let screenshot = null;

try { robot = require("@nut-tree-fork/nut-js"); } catch {}
try { si    = require("systeminformation");       } catch {}
try { screenshot = require("screenshot-desktop"); } catch {}

// ── Exports do módulo ────────────────────────────────────────
module.exports = {
  IS_CLOUD,
  IS_WINDOWS,
  IS_MAC,
  IS_LINUX,

  // ─────────────────────────────────────────────────────────
  //  INFORMAÇÕES DO SISTEMA
  // ─────────────────────────────────────────────────────────
  async getSysInfo() {
    if (!si) return { erro:"systeminformation não instalado", cloud:IS_CLOUD };
    try {
      const [cpu, mem, disk, temp, battery, net] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.cpuTemperature().catch(() => ({ main: null })),
        si.battery().catch(() => ({ hasBattery:false })),
        si.networkStats().catch(() => [{ rx_sec:0, tx_sec:0 }]),
      ]);

      const diskUsed = disk[0] ? Math.round((disk[0].used / disk[0].size) * 100) : 0;

      return {
        cpu:         Math.round(cpu.currentLoad),
        ram:         Math.round((mem.used / mem.total) * 100),
        disco:       diskUsed,
        ramTotal:    Math.round(mem.total / 1024 / 1024 / 1024),
        ramUsada:    Math.round(mem.used  / 1024 / 1024 / 1024),
        temperatura: temp.main ? Math.round(temp.main) : null,
        bateria:     battery.hasBattery ? { nivel: battery.percent, carregando: battery.isCharging } : null,
        rede:        { down: Math.round((net[0]?.rx_sec || 0) / 1024), up: Math.round((net[0]?.tx_sec || 0) / 1024) },
        plataforma:  process.platform,
        hostname:    os.hostname(),
        uptime:      Math.floor(os.uptime()),
      };
    } catch(e) {
      return { erro: e.message };
    }
  },

  async getProcessos(top = 10) {
    if (!si) return [];
    try {
      const procs = await si.processes();
      return procs.list
        .sort((a,b) => b.cpu - a.cpu)
        .slice(0, top)
        .map(p => ({ pid:p.pid, nome:p.name, cpu:Math.round(p.cpu*10)/10, ram:Math.round(p.mem*10)/10 }));
    } catch { return []; }
  },

  // ─────────────────────────────────────────────────────────
  //  SCREENSHOT
  // ─────────────────────────────────────────────────────────
  async tirarScreenshot() {
    if (IS_CLOUD) return { erro:"Screenshot indisponível em cloud" };

    const dt  = new Date();
    const dir = path.join(os.homedir(), "Screenshots", "JARVIS",
      `${dt.getFullYear()}`, `${String(dt.getMonth()+1).padStart(2,"0")}`,
      `${String(dt.getDate()).padStart(2,"0")}`);

    fs.mkdirSync(dir, { recursive:true });
    const file = path.join(dir, `jarvis_${Date.now()}.png`);

    try {
      if (screenshot) {
        const img = await screenshot({ filename: file });
        const b64 = fs.readFileSync(file).toString("base64");
        return { arquivo:file, base64:b64 };
      }

      // Fallback por plataforma
      if (IS_WINDOWS) {
        execSync(`powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens" 2>nul`);
        // PowerShell screenshot
        execSync(`powershell -command "
          $bitmap = New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width, [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height);
          $graphics = [System.Drawing.Graphics]::FromImage($bitmap);
          $graphics.CopyFromScreen(0, 0, 0, 0, $bitmap.Size);
          $bitmap.Save('${file.replace(/\\/g,"/")}');
        "`);
      } else if (IS_MAC) {
        execSync(`screencapture -x "${file}"`);
      } else {
        execSync(`import -window root "${file}"`);
      }

      const b64 = fs.readFileSync(file).toString("base64");
      return { arquivo:file, base64:b64 };
    } catch(e) {
      return { erro:`Screenshot falhou: ${e.message}` };
    }
  },

  // ─────────────────────────────────────────────────────────
  //  ABRIR URL / APP
  // ─────────────────────────────────────────────────────────
  async abrirUrl(url) {
    if (IS_CLOUD) return { erro:"Abrir URL indisponível em cloud" };
    if (!url.startsWith("http")) url = "https://" + url;
    try {
      const cmd = IS_WINDOWS ? `start "" "${url}"` : IS_MAC ? `open "${url}"` : `xdg-open "${url}"`;
      execSync(cmd);
      return { resultado:`URL aberta: ${url}` };
    } catch(e) { return { erro:e.message }; }
  },

  async abrirApp(nome) {
    if (IS_CLOUD) return { erro:"Abrir app indisponível em cloud" };
    const apps = {
      "chrome":      IS_WINDOWS ? "start chrome" : IS_MAC ? "open -a 'Google Chrome'" : "google-chrome",
      "vscode":      IS_WINDOWS ? "code" : IS_MAC ? "open -a 'Visual Studio Code'" : "code",
      "discord":     IS_WINDOWS ? "start discord" : IS_MAC ? "open -a Discord" : "discord",
      "spotify":     IS_WINDOWS ? "start spotify" : IS_MAC ? "open -a Spotify" : "spotify",
      "terminal":    IS_WINDOWS ? "start cmd" : IS_MAC ? "open -a Terminal" : "x-terminal-emulator",
      "explorador":  IS_WINDOWS ? "explorer" : IS_MAC ? "open ." : "nautilus",
      "notepad":     IS_WINDOWS ? "notepad" : IS_MAC ? "open -a TextEdit" : "gedit",
      "calculadora": IS_WINDOWS ? "calc" : IS_MAC ? "open -a Calculator" : "gnome-calculator",
    };

    const nomeNorm = nome.toLowerCase().replace(/\s+/g,"");
    const cmd = apps[nomeNorm] || (IS_WINDOWS ? `start "${nome}"` : IS_MAC ? `open -a "${nome}"` : nome);

    try {
      exec(cmd);
      return { resultado:`${nome} aberto` };
    } catch(e) { return { erro:e.message }; }
  },

  // ─────────────────────────────────────────────────────────
  //  CONTROLE DE VOLUME
  // ─────────────────────────────────────────────────────────
  async setVolume(nivel) {
    if (IS_CLOUD) return { erro:"Controle de volume indisponível em cloud" };
    try {
      nivel = Math.max(0, Math.min(100, nivel));
      if (IS_WINDOWS) {
        const script = `
          $obj = New-Object -ComObject WScript.Shell;
          $vol = [Math]::Round(${nivel} / 100 * 65535);
          $wsh = New-Object -ComObject WScript.Shell;
          Add-Type -TypeDefinition '
            using System.Runtime.InteropServices;
            [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
            interface IAudioEndpointVolume { int f(); int f2(); int f3(); int f4(); int SetMasterVolumeLevelScalar(float, System.Guid); }
          ';
        `;
        // Fallback simples via nircmd se disponível
        execSync(`nircmd setsysvolume ${Math.round(nivel * 655.35)}`, { stdio:"ignore" });
      } else if (IS_MAC) {
        execSync(`osascript -e "set volume output volume ${nivel}"`);
      } else {
        execSync(`amixer sset Master ${nivel}%`);
      }
      return { resultado:`Volume definido para ${nivel}%` };
    } catch(e) { return { erro:e.message }; }
  },

  async toggleMute() {
    if (IS_CLOUD) return { erro:"Mute indisponível em cloud" };
    try {
      if (IS_WINDOWS) execSync("nircmd mutesysvolume 2", { stdio:"ignore" });
      else if (IS_MAC) execSync(`osascript -e "set volume output muted not (output muted of (get volume settings))"`);
      else execSync("amixer sset Master toggle");
      return { resultado:"Mute alternado" };
    } catch(e) { return { erro:e.message }; }
  },

  // ─────────────────────────────────────────────────────────
  //  TECLAS DE MÍDIA
  // ─────────────────────────────────────────────────────────
  async midiaTecla(acao) {
    if (IS_CLOUD) return { erro:"Controle de mídia indisponível em cloud" };
    const acoes = {
      "play":     IS_WINDOWS ? "nircmd sendkeypress 179" : IS_MAC ? `osascript -e 'tell app "Spotify" to playpause'` : "playerctl play-pause",
      "proximo":  IS_WINDOWS ? "nircmd sendkeypress 176" : IS_MAC ? `osascript -e 'tell app "Spotify" to next track'` : "playerctl next",
      "anterior": IS_WINDOWS ? "nircmd sendkeypress 177" : IS_MAC ? `osascript -e 'tell app "Spotify" to previous track'` : "playerctl previous",
      "parar":    IS_WINDOWS ? "nircmd sendkeypress 178" : "playerctl stop",
    };
    try {
      exec(acoes[acao] || "");
      return { resultado:`Mídia: ${acao}` };
    } catch(e) { return { erro:e.message }; }
  },

  // ─────────────────────────────────────────────────────────
  //  GERENCIAMENTO DE JANELAS
  // ─────────────────────────────────────────────────────────
  async listarJanelas() {
    if (IS_CLOUD) return [];
    try {
      if (IS_WINDOWS) {
        const out = execSync(`powershell -command "Get-Process | Where-Object {$_.MainWindowTitle} | Select-Object Id,Name,MainWindowTitle | ConvertTo-Json"`, { encoding:"utf8" });
        return JSON.parse(out);
      }
      return [];
    } catch { return []; }
  },

  async fecharApp(nome) {
    if (IS_CLOUD) return { erro:"Fechar app indisponível em cloud" };
    try {
      if (IS_WINDOWS) execSync(`taskkill /F /IM "${nome}.exe" /T`, { stdio:"ignore" });
      else if (IS_MAC) execSync(`pkill -f "${nome}"`);
      else execSync(`pkill -f "${nome}"`);
      return { resultado:`${nome} encerrado` };
    } catch(e) { return { erro:e.message }; }
  },

  async matarPID(pid) {
    if (IS_CLOUD) return { erro:"Kill PID indisponível em cloud" };
    try {
      if (IS_WINDOWS) execSync(`taskkill /F /PID ${pid}`, { stdio:"ignore" });
      else process.kill(pid, "SIGKILL");
      return { resultado:`PID ${pid} encerrado` };
    } catch(e) { return { erro:e.message }; }
  },

  // ─────────────────────────────────────────────────────────
  //  MODO FOCO
  // ─────────────────────────────────────────────────────────
  async ativarModoFoco() {
    if (IS_CLOUD) return { resultado:"Modo foco ativado (simulado em cloud)" };
    const distrações = ["discord","chrome","firefox","edge","opera","instagram","twitter","facebook"];
    const resultados = [];
    for (const app of distrações) {
      try {
        if (IS_WINDOWS) execSync(`taskkill /F /IM "${app}.exe" /T 2>nul`, { stdio:"ignore" });
        else execSync(`pkill -f "${app}" 2>/dev/null || true`);
        resultados.push(app);
      } catch {}
    }
    return { resultado:`Modo foco ativado. Encerrei: ${resultados.join(", ") || "nada encontrado"}` };
  },

  // ─────────────────────────────────────────────────────────
  //  ORGANIZAÇÃO DE ARQUIVOS
  // ─────────────────────────────────────────────────────────
  async organizarDownloads() {
    if (IS_CLOUD) return { erro:"Organização de arquivos indisponível em cloud" };
    const downloads = path.join(os.homedir(), "Downloads");
    const dest      = path.join(downloads, "Organizados_JARVIS");

    const categorias = {
      "Imagens":     [".jpg",".jpeg",".png",".gif",".webp",".svg",".bmp",".ico",".tiff"],
      "Videos":      [".mp4",".mkv",".avi",".mov",".wmv",".flv",".webm"],
      "Musicas":     [".mp3",".wav",".flac",".aac",".ogg",".m4a"],
      "PDFs":        [".pdf"],
      "Documentos":  [".doc",".docx",".odt",".txt",".rtf",".pages"],
      "Planilhas":   [".xls",".xlsx",".csv",".ods",".numbers"],
      "Apresentacoes":[".ppt",".pptx",".odp",".key"],
      "Codigo":      [".js",".ts",".py",".java",".cpp",".c",".html",".css",".json",".xml"],
      "Compactados": [".zip",".rar",".7z",".tar",".gz",".bz2"],
      "Executaveis": [".exe",".msi",".dmg",".deb",".rpm",".appimage"],
    };

    let movidos = 0;
    const log   = [];

    try {
      if (!fs.existsSync(downloads)) return { erro:"Pasta Downloads não encontrada" };

      const arquivos = fs.readdirSync(downloads).filter(f => {
        const full = path.join(downloads, f);
        return fs.statSync(full).isFile();
      });

      for (const arquivo of arquivos) {
        const ext  = path.extname(arquivo).toLowerCase();
        let   cat  = "Outros";

        for (const [categoria, exts] of Object.entries(categorias)) {
          if (exts.includes(ext)) { cat = categoria; break; }
        }

        const destDir = path.join(dest, cat);
        fs.mkdirSync(destDir, { recursive:true });

        const src  = path.join(downloads, arquivo);
        const tgt  = path.join(destDir, arquivo);

        if (!fs.existsSync(tgt)) {
          fs.renameSync(src, tgt);
          movidos++;
          log.push(`${arquivo} → ${cat}`);
        }
      }

      return {
        resultado: `${movidos} arquivo(s) organizados em ${dest}`,
        movidos,
        detalhes: log.slice(0,20),
      };
    } catch(e) {
      return { erro:e.message };
    }
  },

  // ─────────────────────────────────────────────────────────
  //  LEITURA DE ARQUIVOS LOCAIS
  // ─────────────────────────────────────────────────────────
  async lerArquivo(filePath) {
    if (IS_CLOUD) return { erro:"Leitura de arquivos locais indisponível em cloud" };
    try {
      const ext  = path.extname(filePath).toLowerCase();
      const full = filePath.startsWith("~") ? path.join(os.homedir(), filePath.slice(1)) : filePath;

      if (!fs.existsSync(full)) return { erro:`Arquivo não encontrado: ${full}` };

      if ([".txt",".md",".json",".csv",".js",".ts",".py",".html",".css"].includes(ext)) {
        const content = fs.readFileSync(full, "utf8");
        return { resultado:content.slice(0, 8000), tipo:"texto", arquivo:full };
      }

      if (ext === ".pdf") {
        // PDF via pdftotext (se disponível)
        try {
          const txt = execSync(`pdftotext "${full}" -`, { encoding:"utf8", maxBuffer:1024*1024*10 });
          return { resultado:txt.slice(0,8000), tipo:"pdf", arquivo:full };
        } catch {
          return { erro:"pdftotext não disponível. Instale poppler-utils.", tipo:"pdf" };
        }
      }

      // Base64 para imagens
      if ([".jpg",".jpeg",".png",".gif",".webp"].includes(ext)) {
        const b64 = fs.readFileSync(full).toString("base64");
        return { resultado:"Imagem carregada", base64:b64, tipo:"imagem", arquivo:full };
      }

      return { resultado:`Arquivo binário: ${full}`, tipo:"binario" };
    } catch(e) {
      return { erro:e.message };
    }
  },

  // ─────────────────────────────────────────────────────────
  //  BACKUP
  // ─────────────────────────────────────────────────────────
  async backupPasta(src, dest) {
    if (IS_CLOUD) return { erro:"Backup local indisponível em cloud" };
    try {
      const srcFull  = src.startsWith("~") ? path.join(os.homedir(), src.slice(1)) : src;
      const destFull = dest.startsWith("~") ? path.join(os.homedir(), dest.slice(1)) : dest;
      const ts       = new Date().toISOString().replace(/[:.]/g,"-").slice(0,19);
      const destTs   = path.join(destFull, `backup_${ts}`);

      fs.mkdirSync(destTs, { recursive:true });

      const cmd = IS_WINDOWS
        ? `xcopy "${srcFull}" "${destTs}" /E /I /Y`
        : `cp -r "${srcFull}/." "${destTs}"`;

      execSync(cmd);
      return { resultado:`Backup criado em ${destTs}` };
    } catch(e) {
      return { erro:e.message };
    }
  },

  // ─────────────────────────────────────────────────────────
  //  NOTIFICAÇÃO NATIVA
  // ─────────────────────────────────────────────────────────
  async notificar(titulo, mensagem) {
    if (IS_CLOUD) return;
    try {
      if (IS_WINDOWS) {
        const ps = `
          Add-Type -AssemblyName System.Windows.Forms
          $notify = New-Object System.Windows.Forms.NotifyIcon
          $notify.Icon = [System.Drawing.SystemIcons]::Information
          $notify.Visible = $true
          $notify.ShowBalloonTip(5000, '${titulo}', '${mensagem}', [System.Windows.Forms.ToolTipIcon]::Info)
          Start-Sleep -s 6
          $notify.Dispose()
        `;
        exec(`powershell -command "${ps.replace(/\n/g," ")}"`);
      } else if (IS_MAC) {
        execSync(`osascript -e 'display notification "${mensagem}" with title "${titulo}"'`);
      } else {
        exec(`notify-send "${titulo}" "${mensagem}"`);
      }
    } catch {}
  },

  // ─────────────────────────────────────────────────────────
  //  SHELL SEGURO — apenas comandos da safelist
  // ─────────────────────────────────────────────────────────
  async shellSeguro(cmd) {
    if (IS_CLOUD) return { erro:"Shell local indisponível em cloud" };

    const BLOQUEIO = /(rm\s+-rf|format\s|mkfs|shutdown|del\s+\/|rd\s+\/s|sudo\s+rm|DROP\s+TABLE|eval\(|exec\()/i;
    const PERMITE  = /^(echo|dir|ls|pwd|whoami|hostname|date|ipconfig|ifconfig|ping|tasklist|ps|cat\s|type\s|find\s|grep\s|mkdir\s|nircmd\s|powershell\s|node\s|npm\s|git\s)/i;

    if (BLOQUEIO.test(cmd)) return { erro:`Comando bloqueado: ${cmd}` };
    if (!PERMITE.test(cmd))  return { erro:`Comando não permitido: ${cmd}` };

    try {
      const out = execSync(cmd, { encoding:"utf8", timeout:15000, maxBuffer:1024*1024 });
      return { resultado:out.slice(0,3000) };
    } catch(e) {
      return { erro:e.message.slice(0,500) };
    }
  },

  // ─────────────────────────────────────────────────────────
  //  MONITORAMENTO SENTINELA
  // ─────────────────────────────────────────────────────────
  async verificarSaude() {
    const info = await module.exports.getSysInfo();
    const alertas = [];

    if (info.cpu > 90)         alertas.push(`CPU crítica: ${info.cpu}%`);
    if (info.ram > 92)         alertas.push(`RAM crítica: ${info.ram}%`);
    if (info.disco > 95)       alertas.push(`Disco cheio: ${info.disco}%`);
    if (info.temperatura > 95) alertas.push(`Temperatura crítica: ${info.temperatura}°C`);

    return {
      saudavel: alertas.length === 0,
      alertas,
      info,
    };
  },
};