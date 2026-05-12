/* ═══════════════════════════════════════════════════════════════
   JARVIS OMEGA v7 — app.js
   Frontend modular — integrado com server.js v7 + voice.js
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ── CONFIGURAÇÃO AUTO-DETECT ──────────────────────────────────
const API    = window.location.origin;
const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;

// ── ESTADO GLOBAL ─────────────────────────────────────────────
const STATE = {
  ttsAuto:    true,
  wakeOn:     false,
  srvCfg:     {},
  vizData:    null,
  bootTs:     Date.now(),
  ws:         null,
  wsRetries:  0,
  monData:    {},
  speaking:   false,
  desktopMode: false,
};

// ══════════════════════════════════════════════════════════════
//  MÓDULO: CANVAS DE FUNDO
// ══════════════════════════════════════════════════════════════
const BgModule = (() => {
  const cv = document.getElementById('bg-layer');
  const cx = cv.getContext('2d');
  let t = 0;

  function resize() { cv.width = window.innerWidth; cv.height = window.innerHeight; }
  window.addEventListener('resize', resize);
  resize();

  function draw() {
    cx.clearRect(0, 0, cv.width, cv.height);
    // Grid de fundo
    cx.strokeStyle = 'rgba(0,60,100,.15)'; cx.lineWidth = .4;
    for (let x = 0; x < cv.width; x += 55) {
      cx.beginPath(); cx.moveTo(x, 0); cx.lineTo(x, cv.height); cx.stroke();
    }
    for (let y = 0; y < cv.height; y += 55) {
      cx.beginPath(); cx.moveTo(0, y); cx.lineTo(cv.width, y); cx.stroke();
    }
    // Glow orb animado
    t += .003;
    const ox = cv.width / 2 + Math.sin(t) * 100, oy = cv.height / 2 + Math.cos(t * .6) * 70;
    const g = cx.createRadialGradient(ox, oy, 0, ox, oy, 320);
    g.addColorStop(0, 'rgba(0,60,120,.14)'); g.addColorStop(1, 'transparent');
    cx.fillStyle = g; cx.fillRect(0, 0, cv.width, cv.height);
    // Segundo glow vermelho suave
    const rx = cv.width * .25 + Math.sin(t * 1.3) * 60, ry = cv.height * .75 + Math.cos(t * .9) * 50;
    const rg = cx.createRadialGradient(rx, ry, 0, rx, ry, 180);
    rg.addColorStop(0, 'rgba(100,0,30,.08)'); rg.addColorStop(1, 'transparent');
    cx.fillStyle = rg; cx.fillRect(0, 0, cv.width, cv.height);
    requestAnimationFrame(draw);
  }
  draw();
})();

// ══════════════════════════════════════════════════════════════
//  MÓDULO: HOLOGRAMA DO MUNDO (Three.js)
//  Continentes reais via geometria + textura procedural
// ══════════════════════════════════════════════════════════════
const GlobeModule = (() => {
  const wrapper = document.getElementById('globe-canvas-wrapper');

  // Verifica se Three.js está disponível
  if (typeof THREE === 'undefined') {
    wrapper.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-family:\'Share Tech Mono\';font-size:.55rem;color:#005f73">THREE.JS NÃO CARREGADO</div>';
    return {};
  }

  const W = wrapper.clientWidth || 300, H = 188;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  wrapper.insertBefore(renderer.domElement, wrapper.querySelector('.globe-overlay'));

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
  camera.position.z = 2.4;

  // ── Textura procedural dos continentes ─────────────────────
  // Dados de continentes simplificados como polígonos lat/lon
  const CONTINENTS = [
    // América do Norte
    [[71,-140],[60,-140],[50,-125],[45,-124],[32,-117],[30,-110],[26,-105],[20,-105],[15,-88],[10,-83],[9,-79],[9,-78],[11,-75],[12,-73],[13,-62],[17,-62],[18,-66],[20,-72],[23,-83],[25,-80],[27,-80],[30,-85],[35,-77],[38,-76],[40,-74],[43,-70],[47,-65],[48,-68],[45,-63],[46,-61],[47,-54],[52,-55],[52,-66],[56,-64],[57,-62],[58,-68],[58,-68],[60,-65],[63,-68],[60,-78],[54,-80],[55,-85],[52,-88],[50,-86],[49,-86],[47,-85],[47,-84],[46,-85],[44,-82],[42,-83],[42,-80],[40,-80],[39,-77],[37,-76],[35,-76],[34,-78],[32,-81],[30,-81],[30,-86],[30,-89],[29,-90],[28,-90],[30,-93],[30,-96],[27,-97],[26,-100],[26,-100],[29,-104],[31,-106],[32,-115],[33,-116],[35,-120],[37,-121],[38,-123],[40,-124],[43,-124],[46,-125],[48,-125],[48,-124],[50,-126],[50,-128],[55,-130],[58,-137],[60,-140],[65,-167],[71,-162],[71,-140]],
    // América Central / Caribe (simplificado)
    [[21,-87],[22,-88],[21,-90],[19,-91],[18,-92],[18,-93],[19,-96],[20,-97],[22,-98],[23,-98],[24,-100],[25,-108],[20,-105],[16,-94],[15,-91],[16,-90],[16,-89],[17,-89],[16,-89],[16,-88],[17,-88],[18,-88],[21,-87]],
    // América do Sul
    [[-5,-80],[-3,-80],[-1,-78],[2,-76],[5,-77],[7,-74],[8,-72],[12,-71],[13,-68],[15,-68],[16,-65],[17,-62],[17,-60],[16,-60],[13,-61],[10,-62],[9,-60],[7,-60],[6,-62],[5,-60],[4,-60],[3,-57],[1,-52],[0,-50],[0,-50],[-2,-50],[-3,-44],[-4,-38],[-5,-35],[-10,-35],[-13,-38],[-16,-38],[-20,-40],[-23,-43],[-26,-48],[-28,-49],[-30,-51],[-32,-52],[-33,-53],[-35,-57],[-38,-58],[-40,-62],[-42,-63],[-45,-66],[-48,-65],[-50,-68],[-52,-68],[-54,-67],[-55,-67],[-54,-65],[-52,-58],[-50,-55],[-48,-66],[-46,-66],[-44,-65],[-42,-64],[-40,-62],[-36,-56],[-34,-56],[-32,-52],[-30,-50],[-28,-48],[-25,-48],[-23,-43],[-20,-40],[-18,-39],[-15,-38],[-12,-37],[-10,-37],[-8,-35],[-5,-35],[-4,-38],[-2,-40],[0,-48],[1,-50],[2,-52],[3,-55],[4,-58],[5,-58],[6,-60],[7,-60],[8,-60],[10,-61],[10,-63],[10,-65],[11,-70],[12,-71],[13,-72],[14,-70],[15,-68],[15,-65],[16,-63],[16,-60],[15,-60],[13,-61],[11,-62],[10,-61],[8,-60],[6,-60],[4,-58],[2,-53],[1,-51],[-1,-50],[-3,-41],[-5,-35],[-6,-36],[-8,-37],[-10,-37],[-12,-38],[-15,-38],[-17,-39],[-20,-40],[-22,-42],[-24,-43],[-26,-48],[-28,-48],[-30,-51],[-33,-53],[-36,-57],[-38,-60],[-40,-62],[-42,-64],[-44,-66],[-48,-66],[-50,-68],[-52,-68],[-55,-67],[-56,-68],[-55,-65],[-52,-58],[-50,-55],[-50,-66],[-46,-66],[-44,-65],[-40,-64],[-38,-60],[-35,-57],[-33,-55],[-31,-52],[-28,-49],[-26,-48],[-24,-43],[-20,-40],[-18,-39],[-15,-38],[-10,-37],[-7,-35],[-5,-35],[-4,-38],[-2,-44],[0,-50],[1,-52],[3,-56],[4,-58],[5,-60],[6,-61],[7,-58],[8,-60],[10,-62],[9,-63],[8,-63],[7,-61],[6,-60],[4,-58],[2,-54],[-1,-50],[-3,-41],[-5,-35],[-8,-35],[-12,-37],[-15,-38],[-18,-39],[-20,-40],[-23,-43],[-25,-46],[-28,-48],[-30,-50],[-33,-53],[-36,-56],[-38,-60],[-40,-62],[-42,-65],[-45,-66],[-48,-66],[-52,-68],[-55,-67],[-56,-65],[-54,-66],[-5,-80]],
    // Europa
    [[35,26],[37,27],[39,27],[40,26],[41,29],[43,29],[45,30],[47,31],[47,37],[44,39],[43,40],[42,41],[43,43],[44,42],[45,40],[46,40],[47,41],[48,42],[48,37],[50,40],[50,36],[53,34],[54,32],[54,30],[55,29],[56,27],[57,26],[58,27],[59,30],[60,30],[60,27],[59,25],[60,23],[60,20],[59,18],[59,15],[57,12],[56,10],[55,12],[54,13],[54,10],[53,8],[54,8],[55,8],[55,10],[54,12],[55,13],[55,12],[54,11],[53,8],[53,5],[52,4],[52,0],[51,0],[50,2],[50,5],[50,8],[48,10],[47,8],[47,10],[46,12],[46,14],[44,15],[43,16],[42,18],[42,20],[40,20],[39,20],[38,22],[37,22],[36,23],[35,24],[35,26]],
    // África
    [[37,10],[37,12],[37,14],[37,15],[37,15],[34,15],[32,14],[30,13],[28,10],[25,10],[22,10],[20,12],[20,15],[22,14],[24,14],[25,14],[26,14],[28,14],[30,14],[32,14],[34,14],[35,15],[36,16],[36,18],[36,20],[36,22],[35,24],[33,25],[31,25],[30,25],[28,24],[25,22],[22,20],[20,20],[18,17],[16,16],[15,14],[13,13],[12,12],[11,13],[10,12],[9,11],[8,10],[8,8],[7,5],[5,3],[4,2],[3,1],[2,0],[2,-1],[1,-2],[0,-2],[-1,-3],[-2,-3],[-2,-5],[-3,-8],[-5,-12],[-6,-12],[-8,-13],[-10,-14],[-12,-15],[-14,-17],[-16,-20],[-18,-22],[-20,-28],[-22,-30],[20,-38],[22,-35],[24,-33],[26,-32],[28,-30],[30,-29],[32,-28],[34,-27],[36,-26],[38,-26],[40,-24],[42,-22],[42,-20],[42,-16],[44,-12],[44,-8],[44,-3],[42,0],[40,2],[38,4],[36,6],[35,8],[35,10],[37,10]],
    // Europa Norte (Escandinávia)
    [[55,8],[56,8],[57,8],[59,5],[60,5],[60,8],[62,5],[63,5],[64,7],[64,10],[66,13],[67,14],[68,15],[70,20],[72,25],[71,28],[70,29],[68,28],[67,25],[65,22],[63,18],[62,17],[60,15],[60,12],[59,12],[59,10],[58,10],[57,10],[56,10],[55,8]],
    // Finlândia + países bálticos
    [[55,24],[56,22],[57,22],[58,23],[59,22],[60,22],[61,20],[62,22],[63,24],[64,26],[65,27],[67,28],[68,28],[68,30],[66,30],[65,30],[63,28],[61,26],[60,25],[58,25],[56,25],[55,24]],
    // Ásia (simplificado)
    [[55,30],[55,35],[55,40],[54,45],[55,50],[55,55],[55,60],[57,62],[58,65],[60,68],[60,73],[60,77],[60,82],[60,87],[57,90],[55,95],[50,95],[48,92],[48,87],[47,83],[45,80],[43,77],[41,73],[40,72],[38,70],[36,68],[35,65],[35,60],[35,55],[35,50],[35,45],[35,40],[35,36],[37,36],[38,37],[40,38],[40,40],[42,42],[43,43],[45,40],[47,40],[48,38],[50,37],[52,34],[55,33],[55,30]],
    // Ásia Leste
    [[50,135],[50,130],[48,130],[48,125],[46,122],[44,120],[42,120],[40,120],[38,122],[36,120],[35,118],[33,117],[30,120],[28,120],[25,118],[22,114],[20,110],[18,106],[15,103],[12,102],[10,100],[8,100],[5,100],[3,100],[1,103],[0,104],[-1,104],[-3,107],[-5,106],[-7,107],[-8,110],[-10,114],[-8,116],[-7,116],[-5,120],[-5,122],[-6,125],[-8,126],[-8,127],[-8,130],[0,130],[3,130],[5,130],[8,128],[10,125],[12,122],[15,120],[18,117],[20,115],[22,114],[25,115],[27,117],[28,120],[30,120],[33,117],[35,117],[38,120],[40,120],[43,120],[45,120],[48,127],[50,130],[52,140],[54,143],[54,140],[53,137],[51,134],[50,135]],
    // Ásia Sul (Índia)
    [[25,68],[24,70],[22,70],[20,70],[18,73],[16,74],[14,74],[12,76],[10,78],[8,78],[8,77],[10,80],[12,80],[14,80],[16,82],[18,84],[20,86],[22,88],[23,90],[24,88],[22,86],[20,84],[18,82],[16,80],[14,79],[12,78],[10,78],[8,76],[8,74],[10,72],[12,72],[14,72],[16,72],[18,72],[20,72],[22,72],[24,72],[25,68]],
    // Oriente Médio
    [[30,35],[32,34],[33,36],[33,38],[32,40],[30,42],[28,45],[27,49],[26,56],[25,60],[27,62],[30,60],[33,58],[35,55],[38,55],[40,55],[42,54],[44,51],[45,50],[46,47],[44,45],[43,43],[42,42],[40,42],[38,40],[36,38],[35,37],[33,37],[31,35],[30,35]],
    // Japão (simplificado)
    [[31,131],[32,130],[33,130],[34,130],[35,132],[36,134],[37,136],[38,138],[39,140],[40,141],[42,141],[43,141],[44,143],[43,141],[42,140],[41,140],[40,140],[38,138],[36,137],[35,135],[34,133],[33,131],[31,131]],
    // Austrália
    [[-14,127],[-14,136],[-14,140],[-16,140],[-18,140],[-20,140],[-22,140],[-24,140],[-26,130],[-28,115],[-30,115],[-32,115],[-34,117],[-36,117],[-38,146],[-36,148],[-34,151],[-32,152],[-28,154],[-24,153],[-22,150],[-20,148],[-18,146],[-16,144],[-14,143],[-12,137],[-12,131],[-14,127]],
    // Nova Zelândia (simplificado)
    [[-34,172],[-36,174],[-38,176],[-40,175],[-42,173],[-44,170],[-46,168],[-44,168],[-42,172],[-40,174],[-38,175],[-36,175],[-34,172]],
    // Gronelândia
    [[60,-43],[62,-50],[64,-52],[66,-55],[68,-56],[70,-55],[72,-56],[74,-58],[76,-62],[78,-66],[80,-65],[82,-60],[83,-55],[82,-50],[80,-48],[78,-46],[76,-45],[74,-44],[72,-44],[70,-44],[68,-45],[66,-45],[64,-44],[62,-44],[60,-43]],
    // Islândia
    [[63,-20],[64,-18],[64,-14],[65,-14],[66,-14],[67,-16],[66,-20],[65,-22],[63,-20]],
  ];

  // Cria textura do globo
  const texSize = 1024;
  const texCanvas = document.createElement('canvas');
  texCanvas.width = texSize; texCanvas.height = texSize / 2;
  const tc = texCanvas.getContext('2d');

  // Fundo oceânico
  const oceanGrad = tc.createRadialGradient(texSize/2, texSize/4, 0, texSize/2, texSize/4, texSize/2);
  oceanGrad.addColorStop(0, '#001830');
  oceanGrad.addColorStop(1, '#000810');
  tc.fillStyle = oceanGrad;
  tc.fillRect(0, 0, texSize, texSize/2);

  // Converte lat/lon para coordenadas de textura
  function latLonToXY(lat, lon) {
    const x = ((lon + 180) / 360) * texSize;
    const y = ((90 - lat) / 180) * (texSize / 2);
    return [x, y];
  }

  // Desenha continentes
  CONTINENTS.forEach((poly, ci) => {
    tc.beginPath();
    poly.forEach(([lat, lon], i) => {
      const [x, y] = latLonToXY(lat, lon);
      if (i === 0) tc.moveTo(x, y);
      else tc.lineTo(x, y);
    });
    tc.closePath();
    const fillGrad = tc.createLinearGradient(0, 0, texSize, 0);
    fillGrad.addColorStop(0,   'rgba(0,140,180,.55)');
    fillGrad.addColorStop(.5,  'rgba(0,180,220,.65)');
    fillGrad.addColorStop(1,   'rgba(0,120,160,.55)');
    tc.fillStyle   = fillGrad;
    tc.strokeStyle = 'rgba(0,229,255,.8)';
    tc.lineWidth   = 1.5;
    tc.fill();
    tc.stroke();
  });

  // Grid lat/lon na textura
  tc.strokeStyle = 'rgba(0,100,140,.25)'; tc.lineWidth = .5;
  for (let lon = -180; lon <= 180; lon += 30) {
    const [x] = latLonToXY(0, lon);
    tc.beginPath(); tc.moveTo(x, 0); tc.lineTo(x, texSize/2); tc.stroke();
  }
  for (let lat = -90; lat <= 90; lat += 30) {
    const [, y] = latLonToXY(lat, 0);
    tc.beginPath(); tc.moveTo(0, y); tc.lineTo(texSize, y); tc.stroke();
  }

  // Cidades / pontos de interesse
  const CITIES = [
    { name:'São Paulo', lat:-23.5, lon:-46.6 },
    { name:'New York',  lat:40.7,  lon:-74.0 },
    { name:'Londres',   lat:51.5,  lon:-.1   },
    { name:'Tóquio',    lat:35.7,  lon:139.7 },
    { name:'Sydney',    lat:-33.9, lon:151.2  },
    { name:'Dubai',     lat:25.2,  lon:55.3   },
    { name:'Moscou',    lat:55.7,  lon:37.6   },
    { name:'Pequim',    lat:39.9,  lon:116.4  },
  ];
  CITIES.forEach(({ lat, lon }) => {
    const [x, y] = latLonToXY(lat, lon);
    tc.beginPath(); tc.arc(x, y, 2.5, 0, Math.PI*2);
    tc.fillStyle = 'rgba(255,200,0,.9)'; tc.fill();
    tc.beginPath(); tc.arc(x, y, 5, 0, Math.PI*2);
    tc.strokeStyle = 'rgba(255,200,0,.4)'; tc.lineWidth = 1; tc.stroke();
  });

  const globeTexture = new THREE.CanvasTexture(texCanvas);

  // Esfera principal
  const sphereGeo  = new THREE.SphereGeometry(.85, 64, 64);
  const sphereMat  = new THREE.MeshPhongMaterial({
    map:         globeTexture,
    transparent: true, opacity: .92,
    emissive:    new THREE.Color(0x001830),
    emissiveIntensity: .3,
  });
  const globe = new THREE.Mesh(sphereGeo, sphereMat);
  scene.add(globe);

  // Atmosfera (glow)
  const atmGeo = new THREE.SphereGeometry(.88, 32, 32);
  const atmMat = new THREE.MeshPhongMaterial({
    color: 0x00aaff, transparent: true, opacity: .08,
    side: THREE.FrontSide,
  });
  scene.add(new THREE.Mesh(atmGeo, atmMat));

  // Glow externo
  const glowGeo = new THREE.SphereGeometry(.92, 32, 32);
  const glowMat = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vNormal;
      void main() { vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      void main() {
        float intensity = pow(0.6 - dot(vNormal, vec3(0.,0.,1.)), 2.5);
        gl_FragColor = vec4(0., .7, 1., intensity * .6);
      }
    `,
    blending:    THREE.AdditiveBlending,
    side:        THREE.FrontSide,
    transparent: true,
  });
  scene.add(new THREE.Mesh(glowGeo, glowMat));

  // Partículas orbitando
  const particleCount = 200;
  const pPositions    = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    const r     = .92 + Math.random() * .25;
    pPositions[i*3]   = r * Math.sin(phi) * Math.cos(theta);
    pPositions[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
    pPositions[i*3+2] = r * Math.cos(phi);
  }
  const pGeo  = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
  const pMat  = new THREE.PointsMaterial({ color:0x00e5ff, size:.015, transparent:true, opacity:.6 });
  const particles = new THREE.Points(pGeo, pMat);
  scene.add(particles);

  // Iluminação
  scene.add(new THREE.AmbientLight(0x002244, .8));
  const sunLight = new THREE.DirectionalLight(0x00aaff, 1.2);
  sunLight.position.set(3, 2, 2);
  scene.add(sunLight);
  const rimLight = new THREE.DirectionalLight(0x004488, .4);
  rimLight.position.set(-2, -1, -2);
  scene.add(rimLight);

  // Animação
  let scanAngle = 0;
  function animate() {
    requestAnimationFrame(animate);
    globe.rotation.y     += .003;
    particles.rotation.y -= .001;
    particles.rotation.x += .0005;
    sunLight.position.x = Math.sin(Date.now() * .0002) * 3;
    renderer.render(scene, camera);
  }
  animate();

  return { renderer, scene, camera, globe };
})();

// ══════════════════════════════════════════════════════════════
//  MÓDULO: HOLOGRAMA JFS
// ══════════════════════════════════════════════════════════════
const JfsModule = (() => {
  const cv = document.getElementById('jfs-canvas');
  if (!cv) return {};
  const cx = cv.getContext('2d');
  cv.width  = cv.offsetWidth || 300;
  cv.height = 70;
  let t = 0;

  function draw() {
    cx.clearRect(0, 0, cv.width, cv.height);
    t += .018;

    // Glitch base
    const glitch = Math.sin(t * 7) > .92;

    // Sombra holográfica
    cx.shadowColor = '#00e5ff';
    cx.shadowBlur  = 18 + Math.sin(t) * 8;

    // Texto principal
    cx.font      = `900 ${Math.round(cv.height * .68)}px Orbitron`;
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';

    // Camadas de cor (efeito holo)
    const layers = [
      { color:'rgba(0,229,255,.15)', ox:2, oy:2 },
      { color:'rgba(255,0,100,.1)',  ox:-1, oy:0 },
      { color:'rgba(0,229,255,.9)',  ox:0, oy:0 },
    ];

    layers.forEach(({ color, ox, oy }) => {
      cx.fillStyle   = color;
      cx.shadowColor = '#00e5ff';
      cx.shadowBlur  = 20;
      cx.fillText('JFS', cv.width / 2 + ox, cv.height / 2 + oy);
    });

    // Glitch offset ocasional
    if (glitch) {
      const gOff = (Math.random() - .5) * 4;
      cx.fillStyle = 'rgba(0,229,255,.3)';
      cx.fillText('JFS', cv.width / 2 + gOff, cv.height / 2);
      // Linha de glitch
      const ly = Math.random() * cv.height;
      cx.fillStyle = 'rgba(0,229,255,.4)';
      cx.fillRect(cv.width * .1, ly, cv.width * .8, 1);
    }

    // Linha inferior pulsante
    cx.shadowBlur  = 0;
    const alpha    = (.4 + .3 * Math.sin(t * 2));
    cx.strokeStyle = `rgba(0,229,255,${alpha})`;
    cx.lineWidth   = 1;
    cx.beginPath();
    cx.moveTo(cv.width * .15, cv.height - 4);
    cx.lineTo(cv.width * .85, cv.height - 4);
    cx.stroke();

    requestAnimationFrame(draw);
  }
  draw();
  return {};
})();

// ══════════════════════════════════════════════════════════════
//  MÓDULO: RADAR
// ══════════════════════════════════════════════════════════════
const RadarModule = (() => {
  const cv  = document.getElementById('radar-canvas');
  if (!cv) return {};
  const cx  = cv.getContext('2d');
  cv.width  = cv.parentElement.clientWidth || 300;
  cv.height = 162;
  const CX  = cv.width / 2, CY = cv.height - 8, R = Math.min(CX, CY) - 5;
  let sweep = Math.PI;

  const blips = Array.from({ length: 7 }, () => ({
    a:   Math.PI * Math.random(),
    d:   .3 + Math.random() * .65,
    age: Math.random() * 80,
  }));

  function draw() {
    cx.clearRect(0, 0, cv.width, cv.height);
    // Anéis
    cx.strokeStyle = 'rgba(0,180,255,.12)'; cx.lineWidth = .8;
    [.3, .55, .8, 1].forEach(r => {
      cx.beginPath(); cx.arc(CX, CY, R * r, Math.PI, 0); cx.stroke();
    });
    // Linhas radiais
    cx.strokeStyle = 'rgba(0,180,255,.1)'; cx.lineWidth = .6;
    for (let i = 0; i < 6; i++) {
      const a = Math.PI + (i / 6) * Math.PI;
      cx.beginPath(); cx.moveTo(CX, CY);
      cx.lineTo(CX + Math.cos(a) * R, CY + Math.sin(a) * R); cx.stroke();
    }
    // Sweep
    cx.save();
    cx.beginPath(); cx.moveTo(CX, CY);
    cx.arc(CX, CY, R, sweep - .45, sweep);
    cx.closePath();
    const sg = cx.createRadialGradient(CX, CY, 0, CX, CY, R);
    sg.addColorStop(0, 'rgba(0,229,255,.04)');
    sg.addColorStop(1, 'rgba(0,229,255,.18)');
    cx.fillStyle = sg; cx.fill(); cx.restore();
    // Linha sweep
    cx.strokeStyle = 'rgba(0,229,255,.7)'; cx.lineWidth = 1.5;
    cx.beginPath(); cx.moveTo(CX, CY);
    cx.lineTo(CX + Math.cos(sweep) * R, CY + Math.sin(sweep) * R); cx.stroke();
    // Blips
    blips.forEach(b => {
      b.age++;
      const diff = Math.abs(((sweep - b.a + Math.PI * 4) % (Math.PI * 2)) - Math.PI);
      if (diff < .1) b.age = 0;
      const alpha = Math.max(0, 1 - b.age / 70);
      if (alpha > 0) {
        const bx = CX + Math.cos(b.a) * R * b.d;
        const by = CY + Math.sin(b.a) * R * b.d;
        cx.beginPath(); cx.arc(bx, by, 3, 0, Math.PI * 2);
        cx.fillStyle = `rgba(0,255,157,${alpha})`; cx.fill();
        cx.beginPath(); cx.arc(bx, by, 6, 0, Math.PI * 2);
        cx.strokeStyle = `rgba(0,255,157,${alpha * .35})`; cx.lineWidth = 1; cx.stroke();
      }
    });
    sweep = Math.PI + ((sweep - Math.PI + .025) % Math.PI);
    requestAnimationFrame(draw);
  }
  draw();
  return {};
})();

// ══════════════════════════════════════════════════════════════
//  MÓDULO: WAVEFORM
// ══════════════════════════════════════════════════════════════
const WaveModule = (() => {
  const el  = document.getElementById('waveform');
  const N   = 32;
  const bars = [];
  for (let i = 0; i < N; i++) {
    const b = document.createElement('div');
    b.className = 'wv'; b.style.height = '2px';
    el.appendChild(b); bars.push(b);
  }
  let rafId;
  function animate() {
    const t = Date.now() / 1000;
    if (STATE.vizData && STATE.vizData.length > 0) {
      bars.forEach((b, i) => {
        const idx = Math.floor(i * (STATE.vizData.length / N));
        const h   = 2 + (STATE.vizData[idx] / 255) * 38;
        b.style.height = h + 'px';
      });
    } else {
      bars.forEach((b, i) => {
        const h = 2 + Math.abs(Math.sin(t * 1.3 + i * .35)) * 7;
        b.style.height = h + 'px';
      });
    }
    rafId = requestAnimationFrame(animate);
  }
  animate();
  return {};
})();

// ══════════════════════════════════════════════════════════════
//  MÓDULO: ESTADO HUD
// ══════════════════════════════════════════════════════════════
const HudState = {
  labels: {
    idle:       'PRONTO PARA OUVIR',
    requesting: 'AGUARDANDO PERMISSÃO',
    listening:  'OUVINDO...',
    processing: 'PROCESSANDO...',
    speaking:   'RESPONDENDO',
  },
  set(s) {
    document.body.classList.remove('listening','processing','speaking','executing');
    if (!['idle','requesting'].includes(s)) document.body.classList.add(s);
    const el = document.getElementById('state-label');
    if (el) el.textContent = this.labels[s] || s.toUpperCase();
    // Ícones do botão
    const mic  = document.getElementById('ico-mic');
    const stop = document.getElementById('ico-stop');
    const load = document.getElementById('ico-load');
    if (mic)  mic.style.display  = s === 'listening' ? 'none' : 'block';
    if (stop) stop.style.display = s === 'listening' ? 'block' : 'none';
    if (load) load.style.display = s === 'processing' ? 'block' : 'none';
  },
};

// ══════════════════════════════════════════════════════════════
//  MÓDULO: LOG
// ══════════════════════════════════════════════════════════════
const Log = {
  el: null,
  init() { this.el = document.getElementById('log-list'); },
  add(tag, msg, cls = 'intent') {
    if (!this.el) return;
    const e  = document.createElement('div'); e.className = 'le';
    const ts = new Date().toLocaleTimeString('pt-BR', { hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit' });
    e.innerHTML = `<span class="le-ts">${ts}</span><span class="le-tag ${cls}" title="${esc(tag)}">${esc(tag).slice(0,10)}</span><span class="le-msg" title="${esc(msg)}">${esc(msg).slice(0,85)}</span>`;
    this.el.appendChild(e);
    this.el.scrollTop = this.el.scrollHeight;
    while (this.el.children.length > 150) this.el.removeChild(this.el.firstChild);
  },
  clear() { if (this.el) this.el.innerHTML = ''; },
};

// ══════════════════════════════════════════════════════════════
//  MÓDULO: MONITOR
// ══════════════════════════════════════════════════════════════
const Monitor = {
  update(d) {
    if (!d) return;
    const cpu = d.cpu || 0, ram = d.ram || 0, dsk = d.disco || 0;
    const setMetric = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = v.toFixed(0) + '%';
      el.className = 'mb-val' + (v > 85 ? ' crit' : v > 65 ? ' warn' : '');
      const box = el.closest('.metric-box');
      if (box) box.className = 'metric-box' + (v > 85 ? ' crit' : v > 65 ? ' warn' : '');
    };
    setMetric('cpu-v', cpu); setMetric('ram-v', ram); setMetric('dsk-v', dsk);

    // Temperatura
    const tempEl = document.getElementById('temp-val');
    if (tempEl && d.temperatura) {
      tempEl.textContent = d.temperatura + '°C';
      tempEl.className = 'mb-val' + (d.temperatura > 85 ? ' crit' : d.temperatura > 70 ? ' warn' : '');
    }

    // Barras de loading
    const lb = document.getElementById('load-bars');
    if (lb) {
      const items = [
        { lbl: 'CPU LOAD', v: cpu },
        { lbl: 'RAM LOAD', v: ram },
        { lbl: 'DSK LOAD', v: dsk },
      ];
      lb.innerHTML = items.map(it => `
        <div class="lb-row">
          <div class="lb-head"><span>${it.lbl}</span><span>${it.v.toFixed(0)}%</span></div>
          <div class="lb-track"><div class="lb-fill${it.v > 85 ? ' crit' : it.v > 65 ? ' warn' : ''}" style="width:${it.v}%"></div></div>
        </div>`).join('');
    }

    // Processos
    if (d.processos && d.processos.length) {
      const pl = document.getElementById('proc-list'); if (!pl) return;
      pl.innerHTML = '';
      d.processos.forEach(p => {
        const r = document.createElement('div'); r.className = 'proc-row';
        r.innerHTML = `<span class="pr-name" title="${esc(p.nome)}">${esc(p.nome)}</span>
          <span class="pr-cpu">${p.cpu}%</span>
          <span class="pr-ram">${p.ram}%</span>
          <button class="pr-kill" onclick="killProcess(${p.pid})" title="Encerrar">✕</button>`;
        pl.appendChild(r);
      });
    }

    // Bateria se disponível
    if (d.bateria) {
      Log.add('BAT', `${d.bateria.nivel}% ${d.bateria.carregando ? '⚡' : ''}`, 'sys');
    }
  },

  async refresh() {
    const d = await api('GET', '/monitor');
    if (d) this.update(d);
  },
};

// ══════════════════════════════════════════════════════════════
//  MÓDULO: AGENTES
// ══════════════════════════════════════════════════════════════
const Agents = {
  async refresh() {
    const data = await api('GET', '/agentes');
    if (!data) return;
    const grid = document.getElementById('agents-grid');
    if (!grid) return;
    grid.innerHTML = '';
    data.forEach(a => {
      const card = document.createElement('div');
      card.className = 'ag-card' + (a.status?.status === 'running' ? ' running' : '');
      card.id = `ag-${a.id}`;
      card.title = a.desc;
      card.innerHTML = `<div class="ag-name">${esc(a.nome.replace(' Agent', ''))}</div>
        <div class="ag-st">${a.status?.status || 'idle'}${a.status?.tasks ? ` · ${a.status.tasks}` : ''}</div>`;
      grid.appendChild(card);
    });
  },
  update(id, status) {
    const c = document.getElementById(`ag-${id}`);
    if (!c) return;
    c.className = 'ag-card' + (status === 'running' ? ' running' : status === 'error' ? ' error' : '');
    const st = c.querySelector('.ag-st');
    if (st) st.textContent = status;
  },
};

// ══════════════════════════════════════════════════════════════
//  MÓDULO: WEBSOCKET
// ══════════════════════════════════════════════════════════════
const WS = {
  init() { this.connect(); },
  connect() {
    try {
      STATE.ws = new WebSocket(WS_URL);
      STATE.ws.onopen    = () => { STATE.wsRetries = 0; this.onOpen(); };
      STATE.ws.onmessage = e => { try { const { event, data } = JSON.parse(e.data); this.handle(event, data); } catch {} };
      STATE.ws.onclose   = () => { Log.add('WS','Reconectando...','warn'); const d=Math.min(1000*(++STATE.wsRetries),15000); setTimeout(()=>this.connect(),d); };
      STATE.ws.onerror   = () => STATE.ws.close();
    } catch { setTimeout(() => this.connect(), 5000); }
  },
  onOpen() {
    document.getElementById('bb-ws').textContent = 'OK';
    Log.add('WS', 'Conectado', 'ok');
  },
  handle(event, data) {
    switch (event) {
      case 'connected':
        STATE.srvCfg = data || {};
        STATE.desktopMode = data?.desktopMode || false;
        document.getElementById('fi-model').textContent = (data?.models?.primary || '--').split('-').slice(0, 2).join('-');
        // Engine badge
        const eb  = document.getElementById('engine-badge');
        const et  = document.getElementById('engine-text');
        if (data?.eleven?.active) {
          if (eb) eb.className = 'eleven';
          if (et) et.textContent = 'ELEVENLABS ATIVO';
          document.getElementById('b-eleven')?.classList.add('on');
          document.getElementById('fi-eng').textContent = 'ElevenLabs';
        } else {
          if (eb) eb.className = 'openai';
          if (et) et.textContent = 'OPENAI TTS ATIVO';
          document.getElementById('fi-eng').textContent = 'OpenAI TTS';
        }
        if (data?.wakeWord) JarvisVoice.setWakeWord(data.wakeWord);
        // Plataforma badge
        if (data?.desktopMode) {
          const db = document.getElementById('b-desktop');
          if (db) db.classList.add('on');
          Log.add('DESKTOP', data.plataforma || 'local', 'ok');
        }
        Log.add('BOOT', `${data?.version} ${data?.build}`, 'ok');
        break;

      case 'status':
        if (['raciocinando','executando'].includes(data.fase)) HudState.set('processing');
        else if (data.fase === 'concluido') { /* voice module controla idle */ }
        else if (data.fase === 'erro')       { HudState.set('idle'); showAlert('Erro: ' + (data.erro || '')); }
        else if (data.fase === 'voz_transcrita') Log.add('STT', data.texto || '', 'intent');
        if (data.intencao) Log.add(data.intencao, data.fase || '', 'intent');
        break;

      case 'agent_status':
        if (data.agentId) Agents.update(data.agentId, data.status); break;

      case 'agente_step':
        Log.add(`[${data.agente || '?'}]`, data.resultado || data.desc || '', 'agent'); break;

      case 'monitor_update':
        Monitor.update(data); break;

      case 'tts_status':
        if (data.status === 'ready') {
          document.getElementById('fi-eng').textContent = data.engine === 'elevenlabs' ? 'ElevenLabs' : 'OpenAI TTS';
        }
        break;

      case 'stt_result':
        Log.add('STT', data.texto || '', 'intent'); break;

      case 'alerta_sistema':
        showAlert(data.mensagem || '');
        Log.add('ALERTA', data.mensagem || '', 'error'); break;

      case 'alerta_audio':
        if (STATE.ttsAuto && data.audio) JarvisVoice.playAudio(data.audio, data.mime || 'audio/mpeg'); break;

      case 'screenshot_capturado':
        Log.add('SCR', data.arquivo || 'capturado', 'ok'); break;

      case 'modo_foco':
        Log.add('FOCO', 'Modo foco ativado', 'sys'); break;

      case 'memory_update':
        refreshMemStats(); break;

      case 'log_entry':
        Log.add(data.intencao || data.type || 'SRV', data.texto || data.msg || '', data.erro ? 'error' : 'ok'); break;
    }
  },
};

// ══════════════════════════════════════════════════════════════
//  MÓDULO: API FETCH
// ══════════════════════════════════════════════════════════════
async function api(method, path, body = null) {
  try {
    const opt = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opt.body = JSON.stringify(body);
    const r = await fetch(API + path, opt);
    if (!r.ok) { Log.add('NET', 'HTTP ' + r.status + ' ' + path, 'error'); return null; }
    return await r.json();
  } catch (e) {
    Log.add('NET', e.message, 'error');
    return null;
  }
}

// ══════════════════════════════════════════════════════════════
//  FUNÇÕES DE UI
// ══════════════════════════════════════════════════════════════
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let alertTimer = null;
function showAlert(msg, dur = 7000) {
  const el = document.getElementById('alert-banner');
  el.textContent = msg; el.classList.add('show');
  if (alertTimer) clearTimeout(alertTimer);
  alertTimer = setTimeout(() => el.classList.remove('show'), dur);
}

async function refreshMemStats() {
  const d = await api('GET', '/memoria'); if (!d) return;
  const ep = document.getElementById('mem-ep'),    fa = document.getElementById('mem-fa'),
        ve = document.getElementById('mem-ve'),    ha = document.getElementById('mem-ha');
  if (ep) ep.textContent = d.longTerm?.length || d.longTerm || 0;
  if (fa) fa.textContent = d.facts ? Object.keys(d.facts).length : d.facts || 0;
  if (ve) ve.textContent = d.vectors || 0;
  if (ha) ha.textContent = d.habits ? Object.keys(d.habits).length : 0;
}

function toggleTts() {
  STATE.ttsAuto = !STATE.ttsAuto;
  JarvisVoice.setTtsAuto(STATE.ttsAuto);
  const b = document.getElementById('b-tts');
  if (b) { b.textContent = STATE.ttsAuto ? '🔊 TTS' : '🔇 TTS'; b.classList.toggle('on', STATE.ttsAuto); }
  Log.add('TTS', STATE.ttsAuto ? 'ON' : 'OFF', 'ok');
}

function toggleWake() {
  STATE.wakeOn = !STATE.wakeOn;
  document.getElementById('b-wake')?.classList.toggle('on', STATE.wakeOn);
  if (STATE.wakeOn) { JarvisVoice.startWakeWord(); Log.add('WAKE', 'Ativado: ' + (STATE.srvCfg.wakeWord || 'jarvis'), 'ok'); }
  else              { JarvisVoice.stopWakeWord();   Log.add('WAKE', 'Desativado', 'warn'); }
}

async function limparMemoria() {
  if (!confirm('Limpar toda a memória do JARVIS?')) return;
  await api('DELETE', '/memoria');
  Log.add('MEM', 'Memória limpa', 'warn');
  await refreshMemStats();
}

// Config modal
function openCfg() {
  document.getElementById('cfg-user').value  = STATE.srvCfg.userName  || 'Senhor';
  document.getElementById('cfg-wake').value  = STATE.srvCfg.wakeWord  || 'jarvis';
  document.getElementById('cfg-sil').value   = '1800';
  document.getElementById('cfg-pers').value  = STATE.srvCfg.personality || 'sarcastico';
  document.getElementById('cfg-modal').classList.add('open');
}
function closeCfg() { document.getElementById('cfg-modal').classList.remove('open'); }
async function saveCfg() {
  const p  = document.getElementById('cfg-pers').value;
  const ms = parseInt(document.getElementById('cfg-sil').value) || 1800;
  const wk = document.getElementById('cfg-wake').value.trim().toLowerCase() || 'jarvis';
  JarvisVoice.setSilenceMs(ms);
  JarvisVoice.setWakeWord(wk);
  await api('POST', '/personalidade', { tipo: p });
  Log.add('CFG', 'Personalidade: ' + p, 'ok');
  closeCfg();
}

// Ações de desktop
async function killProcess(pid) {
  if (!confirm(`Encerrar PID ${pid}?`)) return;
  Log.add('KILL', 'PID ' + pid, 'warn');
  await api('POST', '/desktop/shell', { cmd: `taskkill /F /PID ${pid}` });
  await Monitor.refresh();
}

async function tirarScreenshot() {
  Log.add('SCR', 'Capturando...', 'intent');
  if (STATE.desktopMode) {
    const d = await api('POST', '/desktop/screenshot');
    if (d?.resultado) Log.add('SCR', d.resultado, 'ok');
    if (d?.erro) showAlert(d.erro);
  } else {
    await enviarComando('tire um screenshot e descreva o que está na tela');
  }
}

async function lerTela() {
  Log.add('OCR', 'Lendo tela...', 'intent');
  await enviarComando('leia e descreva o conteúdo da tela atual');
}

async function modoFoco() {
  Log.add('FOCO', 'Ativando...', 'intent');
  if (STATE.desktopMode) {
    const d = await api('POST', '/desktop/foco');
    if (d?.resultado) Log.add('FOCO', d.resultado, 'ok');
  } else {
    await enviarComando('ativar modo foco');
  }
}

async function organizarDownloads() {
  Log.add('ORG', 'Organizando downloads...', 'intent');
  const d = await api('POST', '/desktop/organizar');
  if (d?.resultado) { Log.add('ORG', d.resultado, 'ok'); showAlert(d.resultado); }
  if (d?.erro) showAlert(d.erro);
}

// Disparo de agente
async function dispararAgente() {
  const inp = document.getElementById('agent-input');
  const obj = inp.value.trim();
  if (!obj) { showAlert('Digite o objetivo para o agente'); return; }
  inp.value = '';
  Log.add('AGENT', obj.slice(0, 50), 'agent');
  HudState.set('processing');
  const d = await api('POST', '/agente', { objetivo: obj, tts: STATE.ttsAuto });
  if (!d) { HudState.set('idle'); return; }
  Log.add('AGENT', d.mensagem?.slice(0, 60) || 'Concluído', 'ok');
  if (STATE.ttsAuto && d.audio) await JarvisVoice.playAudio(d.audio, d.audioMime || 'audio/mpeg');
  else HudState.set('idle');
}

// ══════════════════════════════════════════════════════════════
//  ENVIO DE COMANDO (texto)
// ══════════════════════════════════════════════════════════════
async function enviarComando(texto) {
  if (!texto?.trim()) return;
  Log.add('CMD', texto.slice(0, 60), 'intent');
  HudState.set('processing');
  const d = await api('POST', '/comando', { texto, tts: STATE.ttsAuto });
  if (!d) { HudState.set('idle'); return; }
  if (d.erro) { showAlert(d.erro); HudState.set('idle'); return; }
  Log.add(d.intencao || 'RESP', d.raciocinio || 'ok', 'ok');
  if (d.agente || d.agente_usado) Agents.update(d.agente || d.agente_usado, 'idle');
  if (STATE.ttsAuto && d.audio) await JarvisVoice.playAudio(d.audio, d.audioMime || 'audio/mpeg');
  else HudState.set('idle');
}

async function sendText() {
  const inp = document.getElementById('txt-input');
  const v   = inp.value.trim(); if (!v) return; inp.value = '';
  await enviarComando(v);
}

// ══════════════════════════════════════════════════════════════
//  RELÓGIO
// ══════════════════════════════════════════════════════════════
setInterval(() => {
  const ck = document.getElementById('clock');
  if (ck) ck.textContent = new Date().toLocaleTimeString('pt-BR', { hour12: false });
  const up = document.getElementById('fi-up');
  if (up) {
    const s = Math.floor((Date.now() - STATE.bootTs) / 1000);
    up.textContent = s < 60 ? s + 's' : s < 3600 ? Math.floor(s/60) + 'm' : Math.floor(s/3600) + 'h';
  }
}, 1000);

// ══════════════════════════════════════════════════════════════
//  ATALHOS DE TECLADO
// ══════════════════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  const focused = document.activeElement;
  const inInput = focused && ['INPUT','TEXTAREA','SELECT'].includes(focused.tagName);
  if (inInput) return;
  if (document.getElementById('cfg-modal').classList.contains('open')) {
    if (e.key === 'Escape') closeCfg();
    return;
  }
  if (e.code  === 'Space')          { e.preventDefault(); handleMicClick(); }
  if (e.key   === 'Escape')         { JarvisVoice.stop(); HudState.set('idle'); }
  if (e.ctrlKey && e.key === 'l')   { e.preventDefault(); Log.clear(); }
  if (e.ctrlKey && e.key === ',')   { e.preventDefault(); openCfg(); }
  if (e.ctrlKey && e.key === 'k')   { e.preventDefault(); document.getElementById('txt-input')?.focus(); }
});

// ══════════════════════════════════════════════════════════════
//  MIC — requer gesto do usuário para AudioContext
// ══════════════════════════════════════════════════════════════
async function handleMicClick() {
  await JarvisVoice.toggleMic();
}

// ══════════════════════════════════════════════════════════════
//  INPUT TEXTO
// ══════════════════════════════════════════════════════════════
document.getElementById('txt-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); sendText(); }
});

// ══════════════════════════════════════════════════════════════
//  VOICE MODULE — integração
// ══════════════════════════════════════════════════════════════
JarvisVoice.init({
  serverUrl:  API,
  wakeWord:   'jarvis',
  silenceMs:  1800,
  ttsAuto:    true,

  onStateChange(s) { HudState.set(s); if (s === 'idle') STATE.vizData = null; },

  onTranscript(txt) {
    if (txt) Log.add('STT', txt.slice(0, 60), 'intent');
  },

  onResponse(data) {
    const r = data.resposta || '...';
    Log.add(data.intencao || 'RESP', data.raciocinio || r.slice(0, 50), 'ok');
    if (data.agente || data.agente_usado) Agents.update(data.agente || data.agente_usado, 'idle');
    if (data.ttsEngine) {
      document.getElementById('fi-eng').textContent = data.ttsEngine === 'elevenlabs' ? 'ElevenLabs' : 'OpenAI TTS';
    }
    refreshMemStats();
  },

  onError(msg) { Log.add('ERR', msg, 'error'); showAlert(msg); HudState.set('idle'); },
  onAudioStart() { HudState.set('speaking'); STATE.speaking = true; },
  onAudioEnd()   {
    HudState.set('idle'); STATE.speaking = false;
    if (STATE.wakeOn) setTimeout(() => JarvisVoice.startWakeWord(), 400);
  },
  onVizData(data) { STATE.vizData = data; },
});

// ══════════════════════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════════════════════
async function boot() {
  Log.init();
  Log.add('BOOT', 'JARVIS OMEGA v7 iniciando...', 'ok');

  // WebSocket
  WS.init();

  // Permissão de microfone
  await JarvisVoice.start();

  // Dados iniciais
  await Monitor.refresh();
  await Agents.refresh();
  await refreshMemStats();

  // Saudação
  const hr  = new Date().getHours();
  const sd  = hr < 12 ? 'Bom dia' : hr < 18 ? 'Boa tarde' : 'Boa noite';
  const msg = `${sd}. Sistemas operacionais online. Pode falar, ${STATE.srvCfg.userName || 'Senhor'}.`;
  Log.add('BOOT', msg, 'ok');

  // Fala de boas-vindas (após 600ms para AudioContext)
  setTimeout(async () => {
    try {
      const d = await api('POST', '/voz/falar', { texto: msg });
      if (d?.audio) await JarvisVoice.playAudio(d.audio, d.mime || 'audio/mpeg');
    } catch {}
  }, 600);

  // Polling de fallback
  setInterval(async () => {
    await Monitor.refresh();
    await Agents.refresh();
  }, 14000);
}

boot();