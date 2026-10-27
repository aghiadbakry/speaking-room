/* One Three.js hall for Normal mode and, when a headset is present, WebXR.
   People are Quaternius characters, CC0. */
import * as THREE from "three";
import { GLTFLoader } from "/static/vendor/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "/static/vendor/utils/SkeletonUtils.js";

(function () {
  const ROLES = [
    { id: "interested", name: "المهتم", color: 0x2f6f4e },
    { id: "uninterested", name: "غير المهتم", color: 0x6b7280 },
    { id: "curious", name: "الفضولي", color: 0x0e747c },
    { id: "skeptical", name: "المشكك", color: 0x8a5a12 },
    { id: "interrupter", name: "المقاطع", color: 0x8c3a3a },
    { id: "supportive", name: "الداعم", color: 0x1f4e79 },
  ];
  const SKIN = { light: 0xf3d2b5, medium: 0xc68642, deep: 0x6b3a22 };
  const SKIN_CYCLE = [0xf3d2b5, 0xe0b48a, 0xc68642, 0x8d5524, 0x6b3a22];
  const OUTFIT = { navy: 0x1f4e79, white: 0xe8eef5, black: 0x243040 };
  const COUNTS = { 1: 4, 2: 6, 3: 6 };
  const ASIDES = {
    interested: ["أنا معك، كمّل.", "هذه وصلتني."],
    uninterested: ["اختصرها لي.", "وين الخلاصة؟"],
    curious: ["عندي فضول.", "وضّح هذه أكثر."],
    skeptical: ["لسه أفكر.", "أقنعني بهدوء."],
    interrupter: ["لحظة، أسمعك.", "خذها من هنا."],
    supportive: ["خذ راحتك.", "تمام، كمّل."],
    crowd: ["نكمل نسمع.", "معكم من الخلف.", "واضح، كمّلوا."],
  };
  const ASIDE_MOOD = {
    interested: "clap",
    uninterested: "aside",
    curious: "lean",
    skeptical: "lean",
    interrupter: "wave",
    supportive: "nod",
  };
  const AUDIENCE_FILES = [
    "female-suit.glb",
    "male-casual.glb",
    "female-formal.glb",
    "male-suit.glb",
    "female-casual.glb",
    "male-worker.glb",
  ];

  let renderer;
  let scene;
  let camera;
  let people = [];
  let running = false;
  let activeMember = null;
  let comment = null;
  let spoken = {};
  let presentation = "session";
  const camFrom = new THREE.Vector3(3.2, 2.35, 4.6);
  const camTo = new THREE.Vector3(0.95, 1.62, 3.05);
  const lookFrom = new THREE.Vector3(0.2, 1.4, -0.6);
  const lookTo = new THREE.Vector3(-0.2, 1.15, -1.55);
  const lookNow = new THREE.Vector3();
  let intro = 1;
  let generation = 0;
  let mixers = [];
  const sitBend = new THREE.Quaternion();
  const sitAxis = new THREE.Vector3(1, 0, 0);
  const yawQuat = new THREE.Quaternion();
  const yawAxis = new THREE.Vector3(0, 1, 0);
  const pitchQuat = new THREE.Quaternion();
  const pitchAxis = new THREE.Vector3(1, 0, 0);
  let stagePieces = [];
  let stageLight = null;
  let houseLight = null;
  let hemiLight = null;
  let sunLight = null;
  let coolLight = null;
  let lamps = [];
  let speaker = null;
  let lightGoal = { stage: 7.2, house: 2.8, exposure: 1.08 };
  let finaleUntil = 0;
  let floorUntil = 0;
  let late = false;
  let cheered = false;
  let topicPinned = false;
  let pendingTopic = "";
  let board = null;
  let audioCtx = null;
  let talkingRole = "";
  let hushed = false;
  let entrance = 1;
  let pendingReact = null;
  let onCanvasClick = null;
  let libraryPromise = null;

  function cloth(color) {
    return new THREE.MeshStandardMaterial({ color: color, roughness: 0.78, metalness: 0.02 });
  }

  function skinMat(color) {
    return new THREE.MeshStandardMaterial({ color: color, roughness: 0.55, metalness: 0.0 });
  }

  function wood(color) {
    return new THREE.MeshStandardMaterial({ color: color, roughness: 0.62, metalness: 0.04 });
  }

  function panelTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 256;
    const pen = canvas.getContext("2d");
    pen.fillStyle = "#2a3b52";
    pen.fillRect(0, 0, 128, 256);
    pen.fillStyle = "#24344a";
    pen.fillRect(8, 16, 112, 100);
    pen.fillRect(8, 132, 112, 100);
    pen.strokeStyle = "#1a2838";
    pen.lineWidth = 4;
    pen.strokeRect(8, 16, 112, 100);
    pen.strokeRect(8, 132, 112, 100);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(6, 2);
    return texture;
  }

  function floorTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const pen = canvas.getContext("2d");
    for (let row = 0; row < 8; row += 1) {
      pen.fillStyle = row % 2 === 0 ? "#6a4630" : "#7b5340";
      pen.fillRect(0, row * 32, 256, 32);
      pen.strokeStyle = "rgba(40, 22, 12, 0.35)";
      pen.beginPath();
      pen.moveTo(0, row * 32 + 0.5);
      pen.lineTo(256, row * 32 + 0.5);
      pen.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 6);
    return texture;
  }

  function chartTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 320;
    const pen = canvas.getContext("2d");
    pen.fillStyle = "#f4f7fb";
    pen.fillRect(0, 0, 512, 320);
    pen.fillStyle = "#1f4e79";
    [80, 140, 110, 180].forEach((height, index) => {
      pen.fillRect(70 + index * 100, 260 - height, 48, height);
    });
    pen.strokeStyle = "#8aa0b8";
    pen.beginPath();
    pen.moveTo(40, 40);
    pen.lineTo(40, 270);
    pen.lineTo(470, 270);
    pen.stroke();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function topicTexture(text) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 320;
    const pen = canvas.getContext("2d");
    pen.fillStyle = "#f7f1e4";
    pen.fillRect(0, 0, 512, 320);
    pen.fillStyle = "#8a5a32";
    pen.fillRect(0, 0, 512, 10);
    pen.fillStyle = "#8d6844";
    pen.font = "700 28px 'IBM Plex Sans Arabic', 'Geeza Pro', Arial, sans-serif";
    pen.direction = "rtl";
    pen.textAlign = "right";
    pen.fillText("الموضوع", 470, 78);
    pen.fillStyle = "#1c2430";
    pen.font = "600 40px 'IBM Plex Sans Arabic', 'Geeza Pro', Arial, sans-serif";
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    wrap(pen, clean, 430).slice(0, 2).forEach((line, index) => {
      pen.fillText(line, 470, 160 + index * 58);
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function paintTopic(text) {
    if (!board || topicPinned) return;
    const clean = String(text || "").trim();
    if (!clean) return;
    topicPinned = true;
    const next = topicTexture(clean);
    const previous = board.material.map;
    board.material.map = next;
    board.material.emissive.setHex(0x4a341c);
    board.material.emissiveIntensity = 0.22;
    board.material.needsUpdate = true;
    if (previous) previous.dispose();
  }

  function commentTexture(name, text) {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 320;
    const pen = canvas.getContext("2d");
    pen.clearRect(0, 0, 640, 320);
    pen.fillStyle = "#ffffff";
    pen.strokeStyle = "#1f4e79";
    pen.lineWidth = 6;
    roundRect(pen, 24, 16, 592, 230, 28);
    pen.fill();
    pen.stroke();
    pen.beginPath();
    pen.moveTo(292, 240);
    pen.lineTo(348, 240);
    pen.lineTo(320, 300);
    pen.closePath();
    pen.fill();
    pen.stroke();
    pen.fillStyle = "#0e747c";
    pen.font = "700 28px 'Geeza Pro', Arial, sans-serif";
    pen.direction = "rtl";
    pen.textAlign = "right";
    pen.fillText(name, 548, 86);
    pen.fillStyle = "#1c2430";
    pen.font = "600 36px 'Geeza Pro', Arial, sans-serif";
    wrap(pen, text, 500).forEach((line, index) => {
      pen.fillText(line, 548, 142 + index * 46);
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function roundRect(pen, x, y, width, height, radius) {
    pen.beginPath();
    pen.moveTo(x + radius, y);
    pen.arcTo(x + width, y, x + width, y + height, radius);
    pen.arcTo(x + width, y + height, x, y + height, radius);
    pen.arcTo(x, y + height, x, y, radius);
    pen.arcTo(x, y, x + width, y, radius);
    pen.closePath();
  }

  function wrap(pen, text, maxWidth) {
    const words = String(text || "").split(" ");
    const lines = [];
    let line = "";
    words.forEach((word) => {
      const trial = line ? line + " " + word : word;
      if (pen.measureText(trial).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = trial;
      }
    });
    if (line) lines.push(line);
    return lines.slice(0, 3);
  }

  function addMesh(parent, geometry, material, x, y, z) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function chair(x, z) {
    const group = new THREE.Group();
    const seat = wood(0x4e3424);
    const metal = new THREE.MeshStandardMaterial({ color: 0x222830, roughness: 0.4, metalness: 0.35 });
    addMesh(group, new THREE.BoxGeometry(0.46, 0.06, 0.46), seat, 0, 0.48, 0);
    addMesh(group, new THREE.BoxGeometry(0.46, 0.42, 0.06), seat, 0, 0.74, -0.2);
    [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]].forEach((leg) => {
      addMesh(group, new THREE.BoxGeometry(0.04, 0.46, 0.04), metal, leg[0], 0.23, leg[1]);
    });
    group.position.set(x, 0, z);
    return group;
  }

  function speakerFile(avatar) {
    const male = avatar.gender === "male";
    if (male) {
      if (avatar.hair === "tied") return "male-suit.glb";
      return "male-casual.glb";
    }
    if (avatar.hair === "long") return "female-casual.glb";
    if (avatar.hair === "tied") return "female-formal.glb";
    return "female-suit.glb";
  }

  function dressActor(model, options) {
    const outfitColor = { navy: 0x1f4e79, white: 0xe4e9f0, black: 0x2c333d }[options.outfit];
    const hairColor = { short: 0x24180f, tied: 0x6b4423, long: 0xc6a36a }[options.hair];
    const cloth = {
      Black: 1, White: 1, Grey: 1, Orange: 1, LimeGreen: 1, Gold: 1, Red: 1,
      Suit: 1, Tie: 1, LightBrown: 1, LightBlue: 1, Red_Dark: 1,
    };
    const hairNames = { Hair: 1, Hair_Brown: 1, Hair_Blond: 1 };
    model.traverse((obj) => {
      if (!obj.isMesh) return;
      const list = Array.isArray(obj.material) ? obj.material : [obj.material];
      list.forEach((mat) => {
        if (!mat) return;
        if (mat.name === "Skin" && options.skin != null) mat.color.setHex(options.skin);
        if (outfitColor != null && cloth[mat.name]) mat.color.setHex(outfitColor);
        if (hairColor != null && hairNames[mat.name]) mat.color.setHex(hairColor);
      });
    });
  }

  function loadLibrary() {
    if (!libraryPromise) {
      const loader = new GLTFLoader();
      const files = Array.from(new Set(AUDIENCE_FILES.concat(["female-suit.glb", "female-formal.glb", "female-casual.glb", "male-suit.glb", "male-casual.glb", "male-worker.glb"])));
      libraryPromise = Promise.all(files.map((file) => new Promise((resolve, reject) => {
        loader.load("/static/models/" + file, (gltf) => resolve([file, gltf]), undefined, reject);
      }))).then((pairs) => {
        const map = {};
        pairs.forEach(([file, gltf]) => { map[file] = gltf; });
        return map;
      });
    }
    return libraryPromise;
  }

  function makeActor(gltf, options) {
    const model = cloneSkeleton(gltf.scene);
    model.traverse((obj) => {
      if (/pistol|gun|sword|weapon|knife/i.test(obj.name || "")) obj.visible = false;
      if (!obj.isMesh) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
      obj.frustumCulled = false;
      const source = Array.isArray(obj.material) ? obj.material : [obj.material];
      const copies = source.map((mat) => {
        const copy = mat.clone();
        if (copy.name === "Skin" && options.skin != null) copy.color.setHex(options.skin);
        return copy;
      });
      obj.material = copies.length === 1 ? copies[0] : copies;
    });
    if (options.outfit || options.hair) dressActor(model, options);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3();
    model.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry) return;
      if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
      const part = obj.geometry.boundingBox.clone();
      part.applyMatrix4(obj.matrixWorld);
      box.union(part);
    });
    const height = Math.max(0.001, box.max.y - box.min.y);
    const scale = 1.58 / height;
    model.scale.setScalar(scale);
    model.position.y = -box.min.y * scale;
    const group = new THREE.Group();
    group.add(model);
    group.position.set(options.x, options.y, options.z);
    group.rotation.y = options.rotY || 0;
    const bones = {};
    model.traverse((obj) => {
      if (!obj.isBone) return;
      bones[obj.name] = obj;
      bones[obj.name.replace(/\./g, "")] = obj;
    });
    const mixer = new THREE.AnimationMixer(model);
    const idleClip = THREE.AnimationClip.findByName(gltf.animations, "Idle") || gltf.animations[0];
    const waveClip = THREE.AnimationClip.findByName(gltf.animations, "Wave");
    const walkClip = THREE.AnimationClip.findByName(gltf.animations, "Walk");
    const idle = mixer.clipAction(idleClip);
    idle.play();
    const wave = waveClip ? mixer.clipAction(waveClip) : null;
    const walkAction = walkClip ? mixer.clipAction(walkClip) : null;
    if (wave) {
      wave.setLoop(THREE.LoopOnce, 1);
      wave.clampWhenFinished = true;
    }
    if (walkAction) walkAction.setLoop(THREE.LoopRepeat, Infinity);
    mixers.push(mixer);
    if (options.seated) {
      mixer.update(0);
      ["UpperLegL", "UpperLegR"].forEach((name) => {
        if (!bones[name]) return;
        sitBend.setFromAxisAngle(sitAxis, -0.85);
        bones[name].quaternion.multiply(sitBend);
      });
      ["LowerLegL", "LowerLegR"].forEach((name) => {
        if (!bones[name]) return;
        sitBend.setFromAxisAngle(sitAxis, 1.05);
        bones[name].quaternion.multiply(sitBend);
      });
    }
    const seatedPose = {};
    if (options.seated) {
      Object.keys(bones).forEach((name) => {
        seatedPose[name] = {
          q: bones[name].quaternion.clone(),
          p: bones[name].position.clone(),
        };
      });
    }
    group.updateWorldMatrix(true, true);
    let bubbleY = 1.55;
    if (bones.Head) {
      const point = new THREE.Vector3();
      bones.Head.getWorldPosition(point);
      group.worldToLocal(point);
      bubbleY = point.y + 0.22;
    }
    group.userData = {
      role: options.role || "",
      name: options.name || "",
      color: options.color || 0xffffff,
      phase: Math.random() * 6,
      bones: bones,
      idle: idle,
      wave: wave,
      walkAction: walkAction,
      waving: false,
      seated: !!options.seated,
      seatedPose: seatedPose,
      bubbleY: bubbleY,
    };
    mixer.addEventListener("finished", (event) => {
      if (event.action !== wave) return;
      group.userData.waving = false;
      wave.fadeOut(0.2);
      idle.reset().fadeIn(0.2).play();
    });
    return group;
  }

  function arrangement(session) {
    const level = (session && session.level && session.level.level) || (typeof session === "number" ? session : 2);
    const task = (session && session.level && session.level.task) || "";
    const age = (session && session.age_group) || "";
    const listeners = { z: -3.65, y: 0.42, xs: [-3.2, -1.6, 0, 1.6, 3.2], desk: 7.5, roles: false };
    const floorListeners = { z: -3.35, y: 0, xs: [-2.4, -1.2, 0, 1.2, 2.4], desk: 6.2, roles: false };
    if (task === "Job interview") {
      return {
        camera: "interview",
        shell: "office",
        walk: 0.45,
        speaker: { x: 0, y: 0, z: 0.82 },
        speaking: ["skeptical", "curious", "interrupter"],
        rows: [
          { z: -0.95, y: 0, xs: [-0.78, 0, 0.78], desk: 2.15, roles: true },
        ],
      };
    }
    if (task === "Graduation-project discussion") {
      return {
        camera: "discussion",
        shell: "committee",
        walk: 1.15,
        speaker: { x: 0, y: 0, z: 1.35 },
        speaking: ["interested", "uninterested", "curious", "skeptical", "interrupter", "supportive"],
        rows: [
          { z: -1.82, y: 0, xs: [-3.45, -2.1, -0.75, 0.75, 2.1, 3.45], desk: 8.1, roles: true, arc: 0.42 },
        ],
      };
    }
    if (task === "Present to the class") {
      return {
        camera: "presentation",
        shell: "hall",
        walk: 1.75,
        speaker: { x: 0, y: 0.24, z: 0.72 },
        speaking: ["supportive", "interested"],
        rows: [
          { z: -1.6, y: 0, xs: [-0.7, 0.7], desk: 2.4, roles: true },
          listeners,
        ],
      };
    }
    if (task === "Explain a school project") {
      return {
        camera: "discussion",
        shell: "committee",
        walk: 1.15,
        speaker: { x: 0, y: 0, z: 1.2 },
        speaking: ["supportive"],
        rows: [
          { z: -1.55, y: 0, xs: [0], desk: 1.8, roles: true },
          floorListeners,
        ],
      };
    }
    if (task === "A short class talk" || task === "A short presentation") {
      const voice = age === "under_18" || task === "A short class talk" ? "supportive" : "interested";
      return {
        camera: "presentation",
        shell: "hall",
        walk: 1.75,
        speaker: { x: 0, y: 0.24, z: 0.72 },
        speaking: [voice],
        rows: [
          { z: -1.55, y: 0, xs: [0], desk: 1.8, roles: true },
          listeners,
        ],
      };
    }
    if (level === 1) {
      return {
        camera: "presentation",
        shell: "hall",
        rows: [
          { z: -1.7, y: 0, xs: [-2.45, -0.82, 0.82, 2.45], desk: 6.1, roles: true },
          { z: -3.65, y: 0.42, xs: [-3.2, -1.6, 0, 1.6, 3.2], desk: 7.5, roles: false },
        ],
      };
    }
    if (level === 3) {
      return {
        camera: "interview",
        shell: "hall",
        rows: [
          { z: -1.48, y: 0, xs: [-1.7, -0.55, 0.55, 1.7], desk: 4.6, roles: true },
          { z: -2.85, y: 0, xs: [-0.85, 0.85], desk: 2.8, roles: true },
        ],
      };
    }
    return {
      camera: "discussion",
      shell: "hall",
      rows: [
        { z: -1.82, y: 0, xs: [-3.45, -2.1, -0.75, 0.75, 2.1, 3.45], desk: 8.1, roles: true, arc: 0.42 },
      ],
    };
  }

  function applyCamera(style) {
    const shot = {
      presentation: { from: [0.15, 2.2, 5.15], to: [0.1, 1.72, 3.45], lookFrom: [0, 1.4, -0.8], lookTo: [0, 1.28, -2.35] },
      discussion: { from: [2.6, 2.1, 4.35], to: [0.55, 1.58, 2.85], lookFrom: [0, 1.3, -0.6], lookTo: [0, 1.12, -1.55] },
      interview: { from: [1.55, 1.72, 1.95], to: [0.72, 1.38, 1.35], lookFrom: [-0.15, 1.15, -0.15], lookTo: [0, 1.02, -0.55] },
    }[style] || null;
    if (!shot) return;
    camFrom.set(shot.from[0], shot.from[1], shot.from[2]);
    camTo.set(shot.to[0], shot.to[1], shot.to[2]);
    lookFrom.set(shot.lookFrom[0], shot.lookFrom[1], shot.lookFrom[2]);
    lookTo.set(shot.lookTo[0], shot.lookTo[1], shot.lookTo[2]);
  }

  function paintLights(style) {
    const look = {
      presentation: { stage: 0xffc27a, stageI: 8.4, house: 0xffe0b0, houseI: 2.5, cool: 0.1, hemi: 0.58, exposure: 1.1, sun: 1.15, lamp: 0xffe2b0, lampI: 0.55 },
      discussion: { stage: 0xfff4e2, stageI: 6.2, house: 0xfff8ee, houseI: 3.8, cool: 0.18, hemi: 0.78, exposure: 1.16, sun: 1.45, lamp: 0xfff1d2, lampI: 0.72 },
      interview: { stage: 0xfff4e8, stageI: 2.4, house: 0xe4edf6, houseI: 2.6, cool: 0.22, hemi: 0.92, exposure: 1.08, sun: 0.55, lamp: 0xf7f1e4, lampI: 0.15 },
    }[style];
    if (!look) return;
    lightGoal = { stage: look.stageI, house: look.houseI, exposure: look.exposure };
    if (stageLight) stageLight.color.setHex(look.stage);
    if (houseLight) houseLight.color.setHex(look.house);
    if (sunLight) sunLight.intensity = look.sun;
    if (hemiLight) hemiLight.intensity = look.hemi;
    if (coolLight) coolLight.intensity = look.cool;
    lamps.forEach((bulb) => {
      bulb.color.setHex(look.lamp);
      bulb.intensity = look.lampI;
    });
  }

  function placePeople(session) {
    const gen = generation;
    const plan = arrangement(session);
    people = [];
    const seats = [];
    let cursor = 0;
    plan.rows.forEach((row) => {
      if (row.y > 0) {
        addMesh(
          scene,
          new THREE.BoxGeometry(row.desk + 0.7, row.y, 1.5),
          wood(0x5c3b28),
          0, row.y / 2, row.z + 0.08
        );
      }
      deskRow(row.z, row.desk, row.y);
      row.xs.forEach((x) => {
        const z = row.z - (row.arc ? (Math.abs(x) / 3.5) * row.arc : 0);
        const seat = chair(x, z);
        seat.position.y = row.y;
        scene.add(seat);
        let role = null;
        if (row.roles) {
          const id = plan.speaking ? plan.speaking[cursor] : ROLES[cursor].id;
          role = ROLES.find((item) => item.id === id) || null;
          cursor += 1;
        }
        seats.push({ x: x, z: z, y: row.y, role: role });
      });
    });
    loadLibrary().then((lib) => {
      if (gen !== generation || !scene) return;
      const avatar = Object.assign({ skin: "medium", hair: "tied", outfit: "navy", gender: "female" }, session.avatar || {});
      const home = plan.speaker || { x: 0, y: 0.24, z: 0.72 };
      scene.add(speaker = makeActor(lib[speakerFile(avatar)], {
        skin: SKIN[avatar.skin] || SKIN.medium,
        hair: avatar.hair || "tied",
        outfit: avatar.outfit || "navy",
        x: home.x,
        y: home.y,
        z: home.z,
        rotY: Math.PI,
        seated: false,
      }));
      if (presentation === "session") beginWalk(speaker, plan.walk);
      seats.forEach((seat, index) => {
        const role = seat.role;
        const actor = makeActor(lib[AUDIENCE_FILES[index % AUDIENCE_FILES.length]], {
          skin: SKIN_CYCLE[index % SKIN_CYCLE.length],
          x: seat.x,
          y: -0.16 + seat.y,
          z: seat.z,
          rotY: 0,
          seated: true,
          role: role ? role.id : "crowd",
          name: role ? role.name : "من الجمهور",
          color: role ? role.color : 0x8d6b4a,
        });
        scene.add(actor);
        people.push(actor);
      });
      const now = performance.now() / 1000;
      people.forEach((member, index) => {
        member.userData.reaction = {
          kind: index % 2 === 0 ? "nod" : "aside",
          until: now + 0.8 + index * 0.12,
        };
      });
      if (pendingReact) {
        const pending = pendingReact;
        pendingReact = null;
        window.SpeakingRoom.react(pending.role, pending.line, pending.mood);
        if (performance.now() / 1000 < floorUntil && activeMember) {
          beginReaction(activeMember, "yield", 2.2);
        }
      }
      if (renderer && scene && camera) renderer.render(scene, camera);
    }).catch((err) => {
      console.error(err);
    });
  }

  function plannedAudience(session) {
    const plan = arrangement(session);
    if (plan.speaking) {
      return plan.speaking.map((id, index) => {
        const role = ROLES.find((item) => item.id === id);
        return {
          index: index,
          id: role.id,
          name: role.name,
          color: "#" + role.color.toString(16).padStart(6, "0"),
        };
      });
    }
    const level = (session && session.level && session.level.level) || 2;
    const count = COUNTS[level] || 4;
    return ROLES.slice(0, count).map((role, index) => ({
      index: index,
      id: role.id,
      name: role.name,
      color: "#" + role.color.toString(16).padStart(6, "0"),
    }));
  }

  function isArm(name) {
    return /Arm|Hand|Shoulder|Clavicle|Thumb|Index|Middle|Ring|Pinky|Finger/i.test(name);
  }

  function applyPose(member, time) {
    const data = member.userData;
    const bones = data.bones || {};
    const pose = data.seatedPose || {};
    const active = member === activeMember;
    if (data.seated) {
      Object.keys(pose).forEach((name) => {
        if (isArm(name) || name === "Head" || !bones[name]) return;
        bones[name].quaternion.copy(pose[name].q);
        bones[name].position.copy(pose[name].p);
      });
      if (bones.Head && pose.Head) {
        let yaw = Math.sin(time * 0.6 + data.phase) * 0.08;
        if (data.role === "uninterested" && !active) yaw = 0.22;
        if (active) yaw = Math.sin(time * 3) * 0.05;
        yawQuat.setFromAxisAngle(yawAxis, yaw);
        bones.Head.quaternion.copy(pose.Head.q).multiply(yawQuat);
        bones.Head.position.copy(pose.Head.p);
      }
      playReaction(data, time);
      syncGesture(data);
      if (talkingRole && data.role === talkingRole && bones.Head) {
        const open = Math.abs(Math.sin(time * 14)) * 0.16;
        pitchQuat.setFromAxisAngle(pitchAxis, open);
        bones.Head.quaternion.multiply(pitchQuat);
      }
    }
  }

  function playReaction(data, time) {
    const react = data.reaction;
    if (!react) return;
    const left = react.until - time;
    if (left <= 0) {
      data.reaction = null;
      return;
    }
    const span = react.span || 1.6;
    const k = Math.sin(Math.min(1, (span - left) / span) * Math.PI);
    const bones = data.bones || {};
    const pose = data.seatedPose || {};
    if ((react.kind === "nod" || react.kind === "clap" || react.kind === "wave") && bones.Head && pose.Head) {
      pitchQuat.setFromAxisAngle(pitchAxis, 0.48 * k);
      bones.Head.quaternion.multiply(pitchQuat);
    }
    if (react.kind === "lean") {
      const torso = bones.Chest || bones.Spine;
      const torsoPose = pose.Chest || pose.Spine;
      if (torso && torsoPose) {
        pitchQuat.setFromAxisAngle(pitchAxis, 0.42 * k);
        torso.quaternion.copy(torsoPose.q).multiply(pitchQuat);
      }
      if (bones.Head && pose.Head) {
        pitchQuat.setFromAxisAngle(pitchAxis, 0.2 * k);
        bones.Head.quaternion.multiply(pitchQuat);
      }
    }
    if (react.kind === "aside" && bones.Head && pose.Head) {
      yawQuat.setFromAxisAngle(yawAxis, 0.72 * k);
      bones.Head.quaternion.multiply(yawQuat);
    }
    if (react.kind === "yield") {
      const torso = bones.Chest || bones.Spine;
      const torsoPose = pose.Chest || pose.Spine;
      if (torso && torsoPose) {
        pitchQuat.setFromAxisAngle(pitchAxis, -0.34 * k);
        torso.quaternion.copy(torsoPose.q).multiply(pitchQuat);
      }
    }
    if (react.kind === "quiet" && bones.Head && pose.Head) {
      const yaw = Math.max(-0.7, Math.min(0.7, -(data.gaze || 0) * 0.22));
      yawQuat.setFromAxisAngle(yawAxis, yaw);
      bones.Head.quaternion.multiply(yawQuat);
    }
  }

  function syncGesture(data) {
    const kind = data.reaction && data.reaction.kind;
    const waving = kind === "clap" || kind === "wave";
    if (waving && data.wave && !data.waving) {
      data.waving = true;
      if (data.idle) data.idle.fadeOut(0.12);
      data.wave.reset().fadeIn(0.12).play();
    }
    if (!waving && data.waving) {
      data.waving = false;
      if (data.wave) data.wave.fadeOut(0.2);
      if (data.idle) data.idle.reset().fadeIn(0.2).play();
    }
  }

  function ensureSound() {
    if (audioCtx) return audioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
    return audioCtx;
  }

  function noiseSource(ctx, seconds) {
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    return source;
  }

  function playRoomSound(kind, x) {
    if (hushed) return;
    const ctx = ensureSound();
    if (!ctx || presentation !== "session") return;
    if (ctx.state === "suspended") {
      ctx.resume().then(() => {
        if (ctx.state === "running") playRoomSound(kind, x);
      });
      return;
    }
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    let output = gain;
    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-0.75, Math.min(0.75, (x || 0) / 4));
      gain.connect(pan);
      output = pan;
    }
    output.connect(ctx.destination);
    if (kind === "clap") {
      [0, 0.09].forEach((at, index) => {
        const source = noiseSource(ctx, 0.12);
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = index === 0 ? 1800 : 1300;
        const tap = ctx.createGain();
        source.connect(filter);
        filter.connect(tap);
        tap.connect(gain);
        tap.gain.setValueAtTime(0.0001, now + at);
        tap.gain.exponentialRampToValueAtTime(index === 0 ? 0.2 : 0.14, now + at + 0.012);
        tap.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.12);
        source.start(now + at);
        source.stop(now + at + 0.13);
      });
      return;
    }
    if (kind === "chair") {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(190, now);
      osc.frequency.exponentialRampToValueAtTime(74, now + 0.18);
      const source = noiseSource(ctx, 0.16);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 480;
      source.connect(filter);
      filter.connect(gain);
      osc.connect(gain);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.07, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.22);
      source.start(now);
      source.stop(now + 0.18);
      return;
    }
    const source = noiseSource(ctx, 0.36);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 420;
    filter.Q.value = 0.7;
    source.connect(filter);
    filter.connect(gain);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.03, now + 0.08);
    gain.gain.linearRampToValueAtTime(0.0001, now + 0.34);
    source.start(now);
    source.stop(now + 0.36);
  }

  function soundFor(kind) {
    if (kind === "clap" || kind === "wave") return "clap";
    if (kind === "lean" || kind === "aside" || kind === "yield") return "chair";
    return "murmur";
  }

  function beginReaction(member, kind, seconds) {
    const span = seconds || 1.6;
    member.userData.reaction = {
      kind: kind,
      span: span,
      until: performance.now() / 1000 + span,
    };
  }

  function beginWalk(group, distance) {
    const home = group.position.clone();
    const extra = distance == null ? 1.75 : distance;
    group.position.set(home.x, home.y, home.z + extra);
    group.userData.walk = {
      from: group.position.clone(),
      to: home,
      start: performance.now() / 1000,
      span: 2.0,
    };
    if (group.userData.walkAction && group.userData.idle) {
      group.userData.idle.fadeOut(0.1);
      group.userData.walkAction.reset().fadeIn(0.1).play();
    }
  }

  function faceSpeaker(member) {
    if (!speaker || !member) return;
    const spot = new THREE.Vector3();
    member.getWorldPosition(spot);
    spot.y = speaker.position.y;
    speaker.userData.lookAt = spot;
    aimSpeaker(1);
  }

  function aimSpeaker(amount) {
    const data = speaker.userData;
    if (!data.lookAt) return;
    const from = new THREE.Vector3();
    speaker.getWorldPosition(from);
    const dx = data.lookAt.x - from.x;
    const dz = data.lookAt.z - from.z;
    if (dx * dx + dz * dz < 0.04) return;
    const facing = Math.PI;
    let offset = Math.atan2(dx, dz) - facing;
    while (offset > Math.PI) offset -= Math.PI * 2;
    while (offset < -Math.PI) offset += Math.PI * 2;
    const target = facing + Math.max(-1.15, Math.min(1.15, offset * 1.45));
    if (data.yaw == null) data.yaw = speaker.rotation.y;
    let turn = target - data.yaw;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    data.yaw += turn * amount;
    speaker.rotation.y = data.yaw;
  }

  function stepSpeaker(time, delta) {
    if (!speaker) return;
    const data = speaker.userData;
    if (data.walk) {
      const t = Math.min(1, (time - data.walk.start) / data.walk.span);
      speaker.position.lerpVectors(data.walk.from, data.walk.to, t);
      if (t >= 1) {
        data.walk = null;
        if (data.walkAction) data.walkAction.fadeOut(0.2);
        if (data.idle) data.idle.reset().fadeIn(0.2).play();
      }
    }
    aimSpeaker(Math.min(1, delta * 4));
  }

  function echoRoom(except, mood, line) {
    const asking = mood === "lean" || mood === "aside" || /[؟?]/.test(line || "");
    let crowd = false;
    people.forEach((member) => {
      if (member === except || !member.userData.seated) return;
      const role = member.userData.role;
      if (role === "crowd") {
        crowd = true;
        if (asking) {
          member.userData.gaze = except ? except.position.x - member.position.x : 0;
          beginReaction(member, "quiet", 1.7);
        } else {
          member.userData.gaze = 0;
          beginReaction(member, "clap", 1.6);
        }
        return;
      }
      let kind = "nod";
      if (role === "uninterested") kind = "aside";
      else if (role === "interrupter") kind = "wave";
      else if (role === "skeptical" || role === "curious") kind = mood === "clap" ? "nod" : "lean";
      else if (mood === "lean" || mood === "aside") kind = "nod";
      else kind = "clap";
      beginReaction(member, kind, 1.35);
    });
    if (crowd && !hushed) playRoomSound(asking ? "murmur" : "clap", 0);
  }

  function addressPerson(index) {
    const member = people[index];
    if (!member || !member.userData.seated) return null;
    if (member.userData.role === "crowd") {
      beginReaction(member, "nod", 1.1);
      if (renderer && scene && camera) renderer.render(scene, camera);
      return null;
    }
    const role = member.userData.role;
    const bank = ASIDES[role] || ASIDES.interested;
    const line = bank[(member.userData.asides || 0) % bank.length];
    member.userData.asides = (member.userData.asides || 0) + 1;
    member.userData.lastLine = line;
    activeMember = member;
    const mood = ASIDE_MOOD[role] || "nod";
    beginReaction(member, mood, 1.7);
    playRoomSound(soundFor(mood), member.position.x);
    faceSpeaker(member);
    echoRoom(member, mood, line);
    if (line) showComment(member, line);
    if (renderer && scene && camera) renderer.render(scene, camera);
    return { index: index, role: role, name: member.userData.name, line: line, mood: mood };
  }

  function replayPerson(index) {
    const member = people[index];
    if (!member || !member.userData.lastLine) return null;
    activeMember = member;
    const line = member.userData.lastLine;
    beginReaction(member, "nod", 1.5);
    faceSpeaker(member);
    showComment(member, line);
    if (renderer && scene && camera) renderer.render(scene, camera);
    return { index: index, role: member.userData.role, name: member.userData.name, line: line, mood: "nod" };
  }

  function pickPerson(event) {
    if (!renderer || !camera) return -1;
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return -1;
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(x, y), camera);
    const hits = ray.intersectObjects(people, true);
    if (!hits.length) return -1;
    let obj = hits[0].object;
    while (obj && people.indexOf(obj) < 0) obj = obj.parent;
    return obj ? people.indexOf(obj) : -1;
  }

  function deskRow(z, width, lift) {
    const y = lift || 0;
    const top = addMesh(scene, new THREE.BoxGeometry(width, 0.08, 0.7), wood(0x6b442c), 0, 0.74 + y, z + 0.55);
    addMesh(scene, new THREE.BoxGeometry(width - 0.2, 0.08, 0.08), wood(0x4a301f), 0, 0.4 + y, z + 0.82);
    [-(width / 2) + 0.3, (width / 2) - 0.3].forEach((x) => {
      addMesh(scene, new THREE.BoxGeometry(0.08, 0.7, 0.5), wood(0x4a301f), x, 0.36 + y, z + 0.55);
    });
    return top;
  }

  function applyShell(plan) {
    const bare = plan.shell === "office" || plan.shell === "committee";
    stagePieces.forEach((mesh) => {
      mesh.visible = !bare;
    });
    if (plan.shell !== "office") return;
    scene.background = new THREE.Color(0xd5dde6);
    scene.fog = new THREE.Fog(0xd5dde6, 3.2, 8);
    const wall = new THREE.MeshStandardMaterial({ color: 0xe7e1d6, roughness: 0.92 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x8d6848, roughness: 0.58 });
    const glass = new THREE.MeshStandardMaterial({
      color: 0xc5dcea,
      roughness: 0.12,
      emissive: 0x8fb4c8,
      emissiveIntensity: 0.45,
    });
    const carpet = new THREE.MeshStandardMaterial({ color: 0x4e6270, roughness: 0.96 });
    const ceilingMat = new THREE.MeshStandardMaterial({ color: 0xf3efe6, roughness: 1 });
    addMesh(scene, new THREE.BoxGeometry(4.3, 0.04, 4.15), carpet, 0, 0.03, 0.15);
    addMesh(scene, new THREE.BoxGeometry(4.5, 0.08, 4.35), ceilingMat, 0, 2.42, 0.15);
    addMesh(scene, new THREE.BoxGeometry(4.35, 2.4, 0.1), wall, 0, 1.2, -1.92);
    addMesh(scene, new THREE.BoxGeometry(0.1, 2.4, 4.2), wall, -2.15, 1.2, 0.15);
    addMesh(scene, new THREE.BoxGeometry(0.1, 2.4, 4.2), wall, 2.15, 1.2, 0.15);
    addMesh(scene, new THREE.BoxGeometry(4.35, 0.08, 0.06), trim, 0, 0.1, -1.86);
    addMesh(scene, new THREE.BoxGeometry(0.06, 0.08, 4.15), trim, -2.09, 0.1, 0.15);
    addMesh(scene, new THREE.BoxGeometry(0.06, 0.08, 4.15), trim, 2.09, 0.1, 0.15);
    addMesh(scene, new THREE.BoxGeometry(0.04, 0.95, 1.35), glass, 2.08, 1.45, -0.35);
    addMesh(scene, new THREE.BoxGeometry(0.7, 0.05, 0.7), ceilingMat, 0, 2.34, 0.15);
    const shade = new THREE.PointLight(0xfff6e8, 0.7, 4.5, 2);
    shade.position.set(0, 2.2, 0.15);
    scene.add(shade);
    if (board) {
      board.position.set(-2.02, 1.45, 0.15);
      board.rotation.y = Math.PI / 2;
      board.scale.set(0.62, 0.62, 1);
    }
  }

  function build(canvas, session) {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x100e0c);
    scene.fog = new THREE.Fog(0x100e0c, 11, 22);
    camera = new THREE.PerspectiveCamera(48, canvas.clientWidth / Math.max(canvas.clientHeight, 1), 0.1, 40);
    const plan = arrangement(session);
    if (plan.camera === "interview" && presentation !== "lobby") camera.fov = 58;
    stagePieces = [];
    if (presentation === "lobby") {
      camera.fov = 52;
      camera.position.set(0.2, 1.72, 4.2);
      camera.lookAt(0, 1.15, -1.2);
      intro = 1;
    } else {
      applyCamera(plan.camera);
      camera.position.copy(camFrom);
      camera.lookAt(lookFrom);
      intro = 0;
    }
    camera.updateProjectionMatrix();

    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = presentation === "lobby" ? 1.05 : 0.74;
    entrance = presentation === "lobby" ? 1 : 0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.xr.enabled = true;

    scene.add(hemiLight = new THREE.HemisphereLight(0xfff4e5, 0x3a2a22, 0.48));
    sunLight = new THREE.DirectionalLight(0xfff1dd, 1.25);
    sunLight.position.set(3.2, 6.4, 2.4);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(1024, 1024);
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 18;
    sunLight.shadow.camera.left = -7;
    sunLight.shadow.camera.right = 7;
    sunLight.shadow.camera.top = 7;
    sunLight.shadow.camera.bottom = -7;
    scene.add(sunLight);
    stageLight = new THREE.SpotLight(0xffe2b8, presentation === "lobby" ? 7 : 1.4, 14, 0.62, 0.4, 1);
    stageLight.position.set(0, 3.7, 2.2);
    stageLight.target.position.set(0, 1.05, -0.4);
    stageLight.castShadow = false;
    scene.add(stageLight);
    scene.add(stageLight.target);
    const house = new THREE.SpotLight(0xfff0d8, presentation === "lobby" ? 2.6 : 0.7, 16, 0.95, 0.65, 1);
    houseLight = house;
    house.position.set(0, 3.9, 3.1);
    house.target.position.set(0, 0.9, -1.8);
    scene.add(house);
    scene.add(house.target);
    coolLight = new THREE.DirectionalLight(0x9ecfff, 0.28);
    coolLight.position.set(6, 3.2, 0.4);
    scene.add(coolLight);

    const floor = addMesh(
      scene,
      new THREE.PlaneGeometry(14, 16),
      new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.84 }),
      0, 0, -2
    );
    floor.rotation.x = -Math.PI / 2;
    floor.castShadow = false;

    const wallMat = new THREE.MeshStandardMaterial({ map: panelTexture(), roughness: 0.9 });
    const back = addMesh(scene, new THREE.BoxGeometry(12, 4.2, 0.16), wallMat, 0, 2.1, -6.6);
    back.castShadow = false;
    const left = addMesh(scene, new THREE.BoxGeometry(0.16, 4.2, 12), wallMat, -6, 2.1, -1.2);
    left.castShadow = false;
    const right = addMesh(scene, new THREE.BoxGeometry(0.16, 4.2, 12), wallMat, 6, 2.1, -1.2);
    right.castShadow = false;
    const ceiling = addMesh(
      scene,
      new THREE.BoxGeometry(12, 0.12, 12),
      new THREE.MeshStandardMaterial({ color: 0x16202c, roughness: 1 }),
      0, 4.15, -1.2
    );
    ceiling.castShadow = false;
    [-2.2, 0, 2.2].forEach((x) => {
      const lamp = addMesh(
        scene,
        new THREE.BoxGeometry(1.1, 0.06, 0.28),
        new THREE.MeshStandardMaterial({ color: 0xfff6df, emissive: 0xffe7b0, emissiveIntensity: 0.8 }),
        x, 4.02, -1.5
      );
      lamp.castShadow = false;
      const bulb = new THREE.PointLight(0xffe2b0, 0.45, 7, 2);
      bulb.position.set(x, 3.65, -1.5);
      lamps.push(bulb);
      scene.add(bulb);
    });
    [-2.4, 2.4].forEach((z) => {
      const glass = addMesh(
        scene,
        new THREE.BoxGeometry(0.08, 1.3, 1.6),
        new THREE.MeshStandardMaterial({ color: 0x9ec9de, roughness: 0.15, metalness: 0.05, emissive: 0x24485c, emissiveIntensity: 0.25 }),
        5.78, 2.2, z
      );
      glass.castShadow = false;
    });

    const plaster = new THREE.MeshStandardMaterial({ color: 0xd7c6ae, roughness: 0.72 });
    const velvet = new THREE.MeshStandardMaterial({ color: 0x6e2430, roughness: 0.88 });
    [-4.7, 4.7].forEach((x) => {
      addMesh(scene, new THREE.CylinderGeometry(0.16, 0.2, 3.7, 14), plaster, x, 1.85, -1.35);
    });
    [-5.35, 5.35].forEach((x) => {
      const drape = addMesh(scene, new THREE.BoxGeometry(0.22, 3.35, 1.15), velvet, x, 2.15, 0.55);
      drape.rotation.y = x > 0 ? 0.12 : -0.12;
    });
    const aisle = addMesh(scene, new THREE.BoxGeometry(1.2, 0.02, 4.4), velvet, 0, 0.015, -2.55);
    const stageRug = addMesh(scene, new THREE.BoxGeometry(3.4, 0.025, 1.55), velvet, 0, 0.235, 0.9);
    const frame = new THREE.MeshStandardMaterial({ color: 0xcbb89a, roughness: 0.55, metalness: 0.08 });
    addMesh(scene, new THREE.BoxGeometry(0.08, 1.35, 0.08), frame, -0.98, 2.35, -6.4);
    addMesh(scene, new THREE.BoxGeometry(0.08, 1.35, 0.08), frame, 0.98, 2.35, -6.4);
    addMesh(scene, new THREE.BoxGeometry(2.04, 0.08, 0.08), frame, 0, 3.0, -6.4);
    addMesh(scene, new THREE.BoxGeometry(2.04, 0.08, 0.08), frame, 0, 1.7, -6.4);
    const shaft = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 3.4),
      new THREE.MeshBasicMaterial({ color: 0xffe7c2, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide })
    );
    shaft.position.set(3.4, 2.15, 0.8);
    shaft.rotation.y = -0.55;
    shaft.rotation.z = 0.22;
    scene.add(shaft);

    const stage = addMesh(scene, new THREE.BoxGeometry(8.2, 0.22, 2.4), wood(0x8a5a3c), 0, 0.11, 0.85);
    stage.castShadow = false;
    const podium = addMesh(scene, new THREE.BoxGeometry(1.15, 1.02, 0.52), wood(0x5a3a24), 0, 0.73, 0.15);
    const mic = addMesh(scene, new THREE.BoxGeometry(0.42, 0.025, 0.28), cloth(0x222222), 0, 1.25, 0.05);
    stagePieces = [stage, podium, mic, stageRug, aisle];
    const screen = addMesh(
      scene,
      new THREE.PlaneGeometry(1.7, 1.05),
      new THREE.MeshStandardMaterial({ map: chartTexture(), roughness: 0.4, emissive: 0x223044, emissiveIntensity: 0.18 }),
      0, 2.35, -6.48
    );
    screen.castShadow = false;
    board = screen;
    if (pendingTopic) paintTopic(pendingTopic);
    if (presentation === "session") paintLights(plan.camera);
    applyShell(plan);

    placePeople(session);
  }

  function resize() {
    if (!renderer || !camera) return;
    const canvas = renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function clearComment() {
    if (!comment) return;
    if (comment.parent) comment.parent.remove(comment);
    if (comment.material.map) comment.material.map.dispose();
    comment.material.dispose();
    comment = null;
  }

  function showComment(member, text) {
    clearComment();
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: commentTexture(member.userData.name, text),
      transparent: true,
      depthWrite: false,
    }));
    let bubbleY = member.userData.bubbleY || 1.7;
    const head = member.userData.bones && member.userData.bones.Head;
    if (head) {
      member.updateWorldMatrix(true, true);
      const point = new THREE.Vector3();
      head.getWorldPosition(point);
      member.worldToLocal(point);
      bubbleY = point.y + 0.46;
    }
    sprite.position.set(0, bubbleY, 0);
    sprite.center.set(0.5, 0.02);
    sprite.scale.set(1.55, 0.78, 1);
    sprite.userData.baseW = 1.55;
    sprite.userData.baseH = 0.78;
    sprite.userData.grow = 1;
    member.add(sprite);
    comment = sprite;
  }

  function tick() {
    if (!running) return;
    const now = performance.now();
    const delta = Math.min(0.05, (now - (tick.last || now)) / 1000);
    tick.last = now;
    const time = now / 1000;
    mixers.forEach((mixer) => mixer.update(delta));
    stepSpeaker(time, delta);
    people.forEach((member) => applyPose(member, time));
    if (presentation === "session" && entrance >= 1 && time >= finaleUntil && time - (tick.glance || 0) > 3.4) {
      tick.glance = time;
      const quiet = people.filter((member) => member.userData.seated && member !== activeMember && !member.userData.reaction);
      if (quiet.length) {
        const member = quiet[Math.floor(Math.random() * quiet.length)];
        beginReaction(member, member.userData.role === "uninterested" ? "aside" : "nod", 1.05);
      }
    }
    if (comment) {
      comment.userData.grow = Math.min(1, comment.userData.grow + 0.07);
      const grow = comment.userData.grow;
      const pop = (1 - Math.pow(1 - grow, 3)) * (grow < 1 ? 1.06 : 1);
      const popped = 0.82 + 0.18 * pop;
      const baseW = comment.userData.baseW || 1.55;
      const baseH = comment.userData.baseH || 0.78;
      comment.scale.set(baseW * popped, baseH * popped, 1);
      comment.position.y = (comment.parent && comment.parent.userData.bubbleY || 1.62) + Math.sin(time * 2.2) * 0.02;
    }
    const presenting = renderer.xr && renderer.xr.isPresenting;
    if (!presenting && presentation === "lobby") {
      const orbit = time * 0.16;
      camera.position.set(-1.65 + Math.sin(orbit) * 0.12, 1.72, 2.85 + Math.cos(orbit) * 0.1);
      camera.lookAt(0.1, 1.15, -0.35);
    } else if (!presenting) {
      intro = Math.min(1, intro + 0.007);
      if (entrance < 1) {
        entrance = Math.min(1, entrance + delta * 0.42);
        if (stageLight) stageLight.intensity = 1.1 + entrance * (lightGoal.stage - 1.1);
        if (houseLight) houseLight.intensity = 0.45 + entrance * (lightGoal.house - 0.45);
        renderer.toneMappingExposure = 0.7 + entrance * (lightGoal.exposure - 0.7);
      } else {
        if (stageLight) {
          const goal = lightGoal.stage * (time < floorUntil ? 1.32 : 1);
          stageLight.intensity += (goal - stageLight.intensity) * Math.min(1, delta * 2.4);
        }
        if (late && houseLight) {
          houseLight.intensity += (lightGoal.house * 0.58 - houseLight.intensity) * Math.min(1, delta * 0.7);
          const exposure = lightGoal.exposure * 0.86;
          renderer.toneMappingExposure += (exposure - renderer.toneMappingExposure) * Math.min(1, delta * 0.7);
        }
      }
      const ease = 1 - Math.pow(1 - intro, 3);
      camera.position.lerpVectors(camFrom, camTo, ease);
      lookNow.lerpVectors(lookFrom, lookTo, ease);
      camera.lookAt(lookNow);
    }
    renderer.render(scene, camera);
  }

  function audienceList() {
    return people.map((member, index) => ({
      index: index,
      id: member.userData.role,
      name: member.userData.name,
      color: "#" + member.userData.color.toString(16).padStart(6, "0"),
    }));
  }

  window.SpeakingRoom = {
    roles: ROLES,
    open: function (canvas, session) {
      this.close();
      presentation = "session";
      build(canvas, session);
      spoken = {};
      running = true;
      resize();
      window.addEventListener("resize", resize);
      renderer.setAnimationLoop(tick);
      requestAnimationFrame(resize);
      const sound = ensureSound();
      if (sound && sound.state === "suspended") sound.resume();
      onCanvasClick = (event) => {
        const index = pickPerson(event);
        if (index < 0) return;
        const member = people[index];
        const beat = member && member.userData.lastLine ? replayPerson(index) : addressPerson(index);
        if (beat) canvas.dispatchEvent(new CustomEvent("audience", { detail: beat }));
      };
      canvas.addEventListener("pointerdown", onCanvasClick);
      return plannedAudience(session);
    },
    address: function (index) {
      const beat = addressPerson(index);
      return beat;
    },
    notice: function () {
      people.forEach((member) => {
        if (!member.userData.seated) return;
        beginReaction(member, member.userData.role === "uninterested" ? "aside" : "nod", 1.25);
      });
    },
    lobby: function (canvas, avatar) {
      this.close();
      presentation = "lobby";
      build(canvas, {
        level: { level: 2 },
        avatar: avatar || { skin: "medium", hair: "tied", outfit: "navy" },
      });
      spoken = {};
      running = true;
      resize();
      window.addEventListener("resize", resize);
      renderer.setAnimationLoop(tick);
      requestAnimationFrame(resize);
    },
    inspect: function () {
      if (!comment) return null;
      const point = new THREE.Vector3();
      comment.getWorldPosition(point);
      return {
        grow: comment.userData.grow,
        scale: comment.scale.x,
        x: point.x,
        y: point.y,
        z: point.z,
      };
    },
    react: function (role, line, mood) {
      activeMember = null;
      clearComment();
      if (!role) return -1;
      const matches = people.filter((member) => member.userData.role === role);
      const turn = spoken[role] || 0;
      spoken[role] = turn + 1;
      activeMember = matches.length ? matches[turn % matches.length] : null;
      if (!activeMember) {
        pendingReact = { role: role, line: line, mood: mood };
        return -1;
      }
      pendingReact = null;
      if (line) activeMember.userData.lastLine = line;
      beginReaction(activeMember, mood || "nod", 1.8);
      playRoomSound(soundFor(mood || "nod"), activeMember.position.x);
      faceSpeaker(activeMember);
      echoRoom(activeMember, mood || "nod", line);
      if (line) showComment(activeMember, line);
      if (renderer && scene && camera) renderer.render(scene, camera);
      return people.indexOf(activeMember);
    },
    finale: function (won) {
      finaleUntil = performance.now() / 1000 + 3.2;
      people.forEach((member) => {
        if (!member.userData.seated) return;
        if (won) beginReaction(member, member.userData.role === "uninterested" ? "nod" : "clap", 2.8);
        else beginReaction(member, "quiet", 2.5);
      });
      if (speaker) speaker.userData.lookAt = new THREE.Vector3(0, 1.1, -2.2);
      playRoomSound(won ? "clap" : "murmur", 0);
    },
    replay: function (index) {
      return replayPerson(index);
    },
    talk: function (role, on) {
      if (on) {
        if (role === "crowd" && talkingRole && talkingRole !== "crowd") return;
        talkingRole = role || "";
        return;
      }
      if (!role || talkingRole === role) talkingRole = "";
    },
    mute: function (on) {
      hushed = !!on;
      if (hushed) talkingRole = "";
    },
    pinTopic: function (text) {
      const clean = String(text || "").trim();
      if (!clean || topicPinned) return;
      if (!board) {
        pendingTopic = clean;
        return;
      }
      paintTopic(clean);
    },
    floor: function (seconds) {
      if (!seconds) {
        floorUntil = 0;
        return;
      }
      floorUntil = performance.now() / 1000 + seconds;
      if (activeMember) beginReaction(activeMember, "yield", Math.min(2.4, seconds));
    },
    cheer: function () {
      if (cheered || presentation !== "session") return;
      const crowd = people.filter((member) => member.userData.seated && member.userData.role === "crowd");
      const row = crowd.length
        ? crowd
        : people.filter((member) => member.userData.role === "interested" || member.userData.role === "supportive");
      if (!row.length) return;
      cheered = true;
      row.forEach((member) => beginReaction(member, "clap", 1.7));
      playRoomSound("clap", row[0].position.x);
    },
    lastMinute: function () {
      if (late || presentation !== "session") return;
      late = true;
      const watcher = people.find((member) => member.userData.role === "interrupter")
        || people.find((member) => member.userData.role === "skeptical");
      if (watcher) {
        beginReaction(watcher, "aside", 1.8);
        playRoomSound("chair", watcher.position.x);
      }
    },
    async enterHeadset() {
      if (!navigator.xr || !renderer) return false;
      try {
        const supported = await navigator.xr.isSessionSupported("immersive-vr");
        if (!supported) return false;
        renderer.xr.setReferenceSpaceType("local");
        await renderer.xr.setSession(await navigator.xr.requestSession("immersive-vr"));
        return true;
      } catch (err) {
        return false;
      }
    },
    close: function () {
      running = false;
      generation += 1;
      mixers = [];
      clearComment();
      activeMember = null;
      spoken = {};
      window.removeEventListener("resize", resize);
      if (renderer) {
        if (onCanvasClick) renderer.domElement.removeEventListener("pointerdown", onCanvasClick);
        renderer.setAnimationLoop(null);
        renderer.dispose();
        renderer = null;
      }
      onCanvasClick = null;
      people = [];
      pendingReact = null;
      speaker = null;
      lamps = [];
      finaleUntil = 0;
      floorUntil = 0;
      late = false;
      cheered = false;
      topicPinned = false;
      pendingTopic = "";
      board = null;
      talkingRole = "";
      hushed = false;
      scene = null;
    },
  };
})();
