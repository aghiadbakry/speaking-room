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
  const AUDIENCE_FILES = [
    "female-suit.glb",
    "male-casual.glb",
    "female-formal.glb",
    "male-suit.glb",
    "female-casual.glb",
    "male-worker.glb",
  ];
  const SPEAKER_FILES = {
    female: { navy: "female-suit.glb", white: "female-formal.glb", black: "female-casual.glb", short: "female-suit.glb", tied: "female-formal.glb", long: "female-casual.glb" },
    male: { navy: "male-suit.glb", white: "male-casual.glb", black: "male-suit.glb", short: "male-casual.glb", tied: "male-suit.glb", long: "male-casual.glb" },
  };

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
    const gender = avatar.gender === "male" ? "male" : "female";
    const table = SPEAKER_FILES[gender];
    if (avatar.hair === "long") return table.long;
    if (avatar.hair === "short") return table.short;
    return table[avatar.outfit] || table.navy;
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
      if (obj.isBone) bones[obj.name] = obj;
    });
    const mixer = new THREE.AnimationMixer(model);
    const idleClip = THREE.AnimationClip.findByName(gltf.animations, "Idle") || gltf.animations[0];
    const waveClip = THREE.AnimationClip.findByName(gltf.animations, "Wave");
    const idle = mixer.clipAction(idleClip);
    idle.play();
    const wave = waveClip ? mixer.clipAction(waveClip) : null;
    if (wave) {
      wave.setLoop(THREE.LoopOnce, 1);
      wave.clampWhenFinished = true;
    }
    mixers.push(mixer);
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
      waving: false,
      seated: !!options.seated,
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

  function placePeople(session) {
    const gen = generation;
    const count = COUNTS[session.level.level] || 4;
    const seats = count <= 4 ? [-2.35, -1.2, 1.2, 2.35] : [-3.35, -2.2, -1.15, 1.15, 2.2, 3.35];
    const z = -1.7;
    people = [];
    deskRow(z, count <= 4 ? 5.6 : 8);
    for (let seat = 0; seat < count; seat += 1) scene.add(chair(seats[seat], z));
    loadLibrary().then((lib) => {
      if (gen !== generation || !scene) return;
      const avatar = Object.assign({ skin: "medium", hair: "tied", outfit: "navy", gender: "female" }, session.avatar || {});
      scene.add(makeActor(lib[speakerFile(avatar)], {
        skin: SKIN[avatar.skin] || SKIN.medium,
        x: 0,
        y: 0.24,
        z: 0.72,
        rotY: Math.PI,
        seated: false,
      }));
      for (let seat = 0; seat < count; seat += 1) {
        const role = ROLES[seat];
        const actor = makeActor(lib[AUDIENCE_FILES[seat]], {
          skin: SKIN_CYCLE[seat % SKIN_CYCLE.length],
          x: seats[seat],
          y: -0.16,
          z: z,
          rotY: 0,
          seated: true,
          role: role.id,
          name: role.name,
          color: role.color,
        });
        scene.add(actor);
        people.push(actor);
      }
      if (renderer && scene && camera) renderer.render(scene, camera);
    }).catch((err) => {
      console.error(err);
    });
  }

  function plannedAudience(level) {
    const count = COUNTS[level] || 4;
    return ROLES.slice(0, count).map((role, index) => ({
      index: index,
      id: role.id,
      name: role.name,
      color: "#" + role.color.toString(16).padStart(6, "0"),
    }));
  }

  function applyPose(member, time) {
    const data = member.userData;
    const bones = data.bones || {};
    if (data.seated) {
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
    const head = bones.Head;
    const active = member === activeMember;
    if (head) {
      if (data.role === "uninterested" && !active) head.rotation.y = 0.7;
      else if (active) head.rotation.x = Math.sin(time * 3.2) * 0.1;
      else head.rotation.y = Math.sin(time * 0.6 + data.phase) * 0.12;
    }
    if (active && data.wave && !data.waving) {
      data.waving = true;
      data.idle.fadeOut(0.15);
      data.wave.reset().fadeIn(0.15).play();
    }
    if (!active && data.waving) {
      data.waving = false;
      data.wave.fadeOut(0.2);
      data.idle.reset().fadeIn(0.2).play();
    }
  }

  function deskRow(z, width) {
    const top = addMesh(scene, new THREE.BoxGeometry(width, 0.08, 0.7), wood(0x6b442c), 0, 0.74, z + 0.55);
    addMesh(scene, new THREE.BoxGeometry(width - 0.2, 0.08, 0.08), wood(0x4a301f), 0, 0.4, z + 0.82);
    [-(width / 2) + 0.3, (width / 2) - 0.3].forEach((x) => {
      addMesh(scene, new THREE.BoxGeometry(0.08, 0.7, 0.5), wood(0x4a301f), x, 0.36, z + 0.55);
    });
    return top;
  }

  function build(canvas, session) {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x100e0c);
    scene.fog = new THREE.Fog(0x100e0c, 11, 22);
    camera = new THREE.PerspectiveCamera(48, canvas.clientWidth / Math.max(canvas.clientHeight, 1), 0.1, 40);
    if (presentation === "lobby") {
      camera.fov = 52;
      camera.position.set(0.2, 1.72, 4.2);
      camera.lookAt(0, 1.15, -1.2);
      intro = 1;
    } else {
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
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.xr.enabled = true;

    scene.add(new THREE.HemisphereLight(0xfff4e5, 0x3a2a22, 0.48));
    const sun = new THREE.DirectionalLight(0xfff1dd, 1.25);
    sun.position.set(3.2, 6.4, 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 18;
    sun.shadow.camera.left = -7;
    sun.shadow.camera.right = 7;
    sun.shadow.camera.top = 7;
    sun.shadow.camera.bottom = -7;
    scene.add(sun);
    const stageLight = new THREE.SpotLight(0xffe2b8, 7, 14, 0.62, 0.4, 1);
    stageLight.position.set(0, 3.7, 2.2);
    stageLight.target.position.set(0, 1.05, -0.4);
    stageLight.castShadow = false;
    scene.add(stageLight);
    scene.add(stageLight.target);
    const house = new THREE.SpotLight(0xfff0d8, 2.6, 16, 0.95, 0.65, 1);
    house.position.set(0, 3.9, 3.1);
    house.target.position.set(0, 0.9, -1.8);
    scene.add(house);
    scene.add(house.target);
    const cool = new THREE.DirectionalLight(0x9ecfff, 0.28);
    cool.position.set(6, 3.2, 0.4);
    scene.add(cool);

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
    addMesh(scene, new THREE.BoxGeometry(1.2, 0.02, 4.4), velvet, 0, 0.015, -2.55);
    addMesh(scene, new THREE.BoxGeometry(3.4, 0.025, 1.55), velvet, 0, 0.235, 0.9);
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
    addMesh(scene, new THREE.BoxGeometry(1.15, 1.02, 0.52), wood(0x5a3a24), 0, 0.73, 0.15);
    addMesh(scene, new THREE.BoxGeometry(0.42, 0.025, 0.28), cloth(0x222222), 0, 1.25, 0.05);
    const screen = addMesh(
      scene,
      new THREE.PlaneGeometry(1.7, 1.05),
      new THREE.MeshStandardMaterial({ map: chartTexture(), roughness: 0.4, emissive: 0x223044, emissiveIntensity: 0.18 }),
      0, 2.35, -6.48
    );
    screen.castShadow = false;

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
    sprite.position.set(0, member.userData.bubbleY || 1.62, 0.28);
    sprite.center.set(0.5, 0.02);
    sprite.scale.set(2.15, 1.08, 1);
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
    people.forEach((member) => applyPose(member, time));
    if (comment) {
      comment.userData.grow = Math.min(1, comment.userData.grow + 0.07);
      const grow = comment.userData.grow;
      const pop = (1 - Math.pow(1 - grow, 3)) * (grow < 1 ? 1.06 : 1);
      const popped = 0.82 + 0.18 * pop;
      comment.scale.set(2.15 * popped, 1.08 * popped, 1);
      comment.position.y = (comment.parent && comment.parent.userData.bubbleY || 1.62) + Math.sin(time * 2.2) * 0.02;
    }
    const presenting = renderer.xr && renderer.xr.isPresenting;
    if (!presenting && presentation === "lobby") {
      const orbit = time * 0.16;
      camera.position.set(-1.65 + Math.sin(orbit) * 0.12, 1.72, 2.85 + Math.cos(orbit) * 0.1);
      camera.lookAt(0.1, 1.15, -0.35);
    } else if (!presenting) {
      intro = Math.min(1, intro + 0.012);
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
      return plannedAudience(session.level.level);
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
    react: function (role, line) {
      activeMember = null;
      clearComment();
      if (!role) return -1;
      const matches = people.filter((member) => member.userData.role === role);
      const turn = spoken[role] || 0;
      spoken[role] = turn + 1;
      activeMember = matches.length ? matches[turn % matches.length] : null;
      if (!activeMember) return -1;
      if (line) showComment(activeMember, line);
      if (renderer && scene && camera) renderer.render(scene, camera);
      return people.indexOf(activeMember);
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
        renderer.setAnimationLoop(null);
        renderer.dispose();
        renderer = null;
      }
      people = [];
      scene = null;
    },
  };
})();
