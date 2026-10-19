/* One Three.js hall for Normal mode and, when a headset is present, WebXR. */
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

  let renderer;
  let scene;
  let camera;
  let people = [];
  let running = false;
  let activeMember = null;
  let comment = null;
  let spoken = {};

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

  function hairFor(style, head) {
    const hair = new THREE.MeshStandardMaterial({ color: 0x241910, roughness: 0.8 });
    if (style === "long") {
      addMesh(head, new THREE.CapsuleGeometry(0.13, 0.34, 3, 8), hair, 0, -0.16, -0.08);
      return;
    }
    if (style === "tied") {
      addMesh(head, new THREE.SphereGeometry(0.07, 12, 10), hair, 0, 0.14, -0.1);
    }
    const cap = addMesh(head, new THREE.SphereGeometry(0.16, 14, 10), hair, 0, 0.12, -0.02);
    cap.scale.set(1.05, 0.42, 1.05);
  }

  function seatedPerson(role, skin, x, z) {
    const group = new THREE.Group();
    const outfit = cloth(role.color);
    const face = skinMat(skin);
    addMesh(group, new THREE.CapsuleGeometry(0.16, 0.28, 4, 8), outfit, 0, 0.78, 0);
    const head = addMesh(group, new THREE.SphereGeometry(0.15, 18, 14), face, 0, 1.16, 0.02);
    hairFor(role.id === "supportive" ? "tied" : "short", head);
    const shoulder = new THREE.Group();
    shoulder.position.set(-0.2, 0.98, 0.04);
    const arm = addMesh(shoulder, new THREE.CapsuleGeometry(0.04, 0.26, 3, 6), outfit, 0, -0.16, 0);
    group.add(shoulder);
    if (role.id === "uninterested") {
      const phone = addMesh(group, new THREE.BoxGeometry(0.08, 0.14, 0.015), cloth(0x111111), 0.16, 0.72, 0.16);
      phone.rotation.x = -0.6;
    }
    group.position.set(x, 0, z);
    group.userData = { role: role.id, name: role.name, color: role.color, head: head, arm: shoulder, phase: Math.random() * 6 };
    return { group: group, arm: arm };
  }

  function standingSpeaker(avatar) {
    const group = new THREE.Group();
    const outfit = cloth(OUTFIT[avatar.outfit] || OUTFIT.navy);
    const face = skinMat(SKIN[avatar.skin] || SKIN.medium);
    addMesh(group, new THREE.CapsuleGeometry(0.18, 0.86, 4, 10), outfit, 0, 0.64, 0);
    const head = addMesh(group, new THREE.SphereGeometry(0.16, 18, 14), face, 0, 1.28, 0);
    hairFor(avatar.hair || "tied", head);
    [-0.26, 0.26].forEach((x) => {
      addMesh(group, new THREE.CapsuleGeometry(0.045, 0.4, 3, 6), outfit, x, 0.78, 0);
    });
    group.position.set(0, 0.22, 0.72);
    group.rotation.y = Math.PI;
    return group;
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
    scene.background = new THREE.Color(0x1b2838);
    scene.fog = new THREE.Fog(0x1b2838, 9, 18);
    camera = new THREE.PerspectiveCamera(58, canvas.clientWidth / canvas.clientHeight, 0.1, 40);
    camera.position.set(0.45, 1.78, 2.55);
    camera.lookAt(0, 1.15, -2.2);

    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.xr.enabled = true;

    scene.add(new THREE.HemisphereLight(0xfff4e5, 0x3a2a22, 0.72));
    const sun = new THREE.DirectionalLight(0xfff1dd, 1.55);
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
    const stageLight = new THREE.SpotLight(0xffe2b8, 8, 12, 0.55, 0.45, 1);
    stageLight.position.set(0, 3.6, 1.4);
    stageLight.target.position.set(0, 1.2, -1.5);
    stageLight.castShadow = false;
    scene.add(stageLight);
    scene.add(stageLight.target);

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

    scene.add(standingSpeaker(session.avatar || { skin: "medium", outfit: "navy", hair: "tied" }));

    const count = COUNTS[session.level.level] || 4;
    const seats = count <= 4 ? [-2.35, -1.2, 1.2, 2.35] : [-3.35, -2.2, -1.15, 1.15, 2.2, 3.35];
    people = [];
    const z = -1.7;
    deskRow(z, count <= 4 ? 5.6 : 8);
    for (let seat = 0; seat < count; seat += 1) {
      const role = ROLES[seat];
      const x = seats[seat];
      scene.add(chair(x, z));
      const member = seatedPerson(role, SKIN_CYCLE[seat % SKIN_CYCLE.length], x, z);
      scene.add(member.group);
      people.push(member.group);
    }
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
    sprite.position.set(0, 1.36, 0.46);
    sprite.center.set(0.5, 0.02);
    sprite.scale.set(2.15, 1.08, 1);
    sprite.userData.grow = 1;
    member.add(sprite);
    comment = sprite;
  }

  function tick() {
    if (!running) return;
    const time = performance.now() / 1000;
    people.forEach((member) => {
      const data = member.userData;
      const active = member === activeMember;
      const role = data.role;
      const bob = Math.sin(time * 1.6 + data.phase) * 0.015;
      data.head.position.y = 1.16 + bob + (active ? 0.02 : 0);
      if (role === "uninterested" && !active) {
        data.head.rotation.y = 0.7;
      } else if (active && (role === "interested" || role === "supportive")) {
        data.head.rotation.x = Math.sin(time * 3.2) * 0.12;
        data.head.rotation.y = 0;
      } else {
        data.head.rotation.x = 0;
        data.head.rotation.y = Math.sin(time * 0.5 + data.phase) * 0.08;
      }
      const raised = active ? -2.55 : 0.2;
      data.arm.rotation.z += (raised - data.arm.rotation.z) * 0.14;
    });
    if (comment) {
      comment.userData.grow = Math.min(1, comment.userData.grow + 0.07);
      const grow = comment.userData.grow;
      const pop = (1 - Math.pow(1 - grow, 3)) * (grow < 1 ? 1.06 : 1);
      const popped = 0.82 + 0.18 * pop;
      comment.scale.set(2.15 * popped, 1.08 * popped, 1);
      comment.position.y = 1.36 + Math.sin(time * 2.2) * 0.02;
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
      build(canvas, session);
      spoken = {};
      running = true;
      resize();
      window.addEventListener("resize", resize);
      renderer.setAnimationLoop(tick);
      return audienceList();
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
      people.forEach((member) => {
        member.userData.arm.rotation.z = member === activeMember ? -2.55 : 0.2;
      });
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
