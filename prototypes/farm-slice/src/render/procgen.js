// Procedural, low-poly primitive builders. No image or model assets --
// everything here is basic three.js geometry + flat colors, per the brief.

function mat(THREE, color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...extra });
}

export function buildBlobShadow(THREE, radius = 0.5) {
  const geo = new THREE.CircleGeometry(radius, 20);
  const material = new THREE.MeshBasicMaterial({ color: '#0c2b12', transparent: true, opacity: 0.22, depthWrite: false });
  const mesh = new THREE.Mesh(geo, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.01;
  return mesh;
}

export function buildIsland(THREE) {
  const group = new THREE.Group();

  const grass = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.6, 1, 24), mat(THREE, '#7fce5a'));
  grass.position.y = -0.5;
  group.add(grass);

  const dirt = new THREE.Mesh(new THREE.CylinderGeometry(7.6, 7.2, 0.6, 24), mat(THREE, '#b98452'));
  dirt.position.y = -1.05;
  group.add(dirt);

  // A few cute decorative bushes/rocks scattered around the rim.
  const bushSpots = [
    [-5.6, -3.2, '#4caf50'], [5.8, -2.6, '#4caf50'], [-6, 2.6, '#66bb6a'],
    [6.1, 3.4, '#66bb6a'], [0, -6.4, '#8bc34a'], [-2.8, 5.6, '#4caf50'],
  ];
  bushSpots.forEach(([x, z, color]) => {
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), mat(THREE, color));
    bush.position.set(x, 0.35, z);
    bush.rotation.y = Math.random() * Math.PI;
    group.add(bush);
    group.add(shadowAt(THREE, x, z, 0.5));
  });

  const rockSpots = [[-4.6, 4.8], [5.2, -4.4]];
  rockSpots.forEach(([x, z]) => {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4, 0), mat(THREE, '#9e9e9e'));
    rock.position.set(x, 0.2, z);
    group.add(rock);
  });

  return group;
}

function shadowAt(THREE, x, z, radius) {
  const shadow = buildBlobShadow(THREE, radius);
  shadow.position.x = x;
  shadow.position.z = z;
  return shadow;
}

export function buildPlot(THREE) {
  const group = new THREE.Group();
  const soil = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.2, 1.5), mat(THREE, '#8d6242'));
  soil.position.y = 0.1;
  group.add(soil);

  // Little furrow lines for texture.
  for (let i = -1; i <= 1; i++) {
    const furrow = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 0.12), mat(THREE, '#6d4a30'));
    furrow.position.set(0, 0.21, i * 0.4);
    group.add(furrow);
  }

  group.add(shadowAt(THREE, 0, 0, 0.95));
  return group;
}

/** Builds (or rebuilds) the crop mesh for a plot at a given growth progress 0..1. */
export function buildCrop(THREE, cropDef, progress) {
  const group = new THREE.Group();
  group.name = 'crop';
  const stemHeight = 0.15 + progress * 0.35;
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.07, stemHeight, 6),
    mat(THREE, '#3f8f3a')
  );
  stem.position.y = 0.2 + stemHeight / 2;
  group.add(stem);

  const fruitScale = 0.15 + progress * 0.45;
  const fruit = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1, 0),
    mat(THREE, cropDef.color, progress >= 1 ? { emissive: cropDef.color, emissiveIntensity: 0.18 } : {})
  );
  fruit.scale.setScalar(fruitScale);
  fruit.position.y = 0.2 + stemHeight + fruitScale * 0.6;
  fruit.name = 'fruit';
  group.add(fruit);

  // A couple of little leaves for character.
  const leafGeo = new THREE.ConeGeometry(0.12, 0.28, 5);
  [-1, 1].forEach((side) => {
    const leaf = new THREE.Mesh(leafGeo, mat(THREE, '#4caf50'));
    leaf.position.set(side * 0.14, 0.28, 0);
    leaf.rotation.z = side * 0.9;
    group.add(leaf);
  });

  return group;
}

export function buildMarketStall(THREE) {
  const group = new THREE.Group();
  const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.6, 8);
  const postMat = mat(THREE, '#a1662f');
  [[-0.9, -0.6], [0.9, -0.6], [-0.9, 0.6], [0.9, 0.6]].forEach(([x, z]) => {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(x, 0.8, z);
    group.add(post);
  });

  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.8, 4), mat(THREE, '#e05252'));
  roof.position.y = 2;
  roof.rotation.y = Math.PI / 4;
  group.add(roof);

  const counter = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.7, 0.5), mat(THREE, '#c98a4b'));
  counter.position.set(0, 0.35, -0.6);
  group.add(counter);

  group.add(shadowAt(THREE, 0, 0, 1.6));
  return group;
}

export function buildMannequin(THREE) {
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.12, 12), mat(THREE, '#cfa15e'));
  base.position.y = 0.06;
  group.add(base);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 8), mat(THREE, '#cfa15e'));
  pole.position.y = 0.65;
  group.add(pole);

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.55, 4, 8), mat(THREE, '#e8d9c0'));
  body.position.y = 1.35;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), mat(THREE, '#e8d9c0'));
  head.position.y = 1.85;
  group.add(head);

  const slots = {};
  slots.helmet = new THREE.Group();
  slots.helmet.position.y = 1.85;
  group.add(slots.helmet);

  slots.chest = new THREE.Group();
  slots.chest.position.y = 1.35;
  group.add(slots.chest);

  slots.boots = new THREE.Group();
  slots.boots.position.y = 0.15;
  group.add(slots.boots);

  slots.shield = new THREE.Group();
  slots.shield.position.set(0.3, 1.3, 0);
  group.add(slots.shield);

  group.add(shadowAt(THREE, 0, 0, 0.5));
  return { group, slots };
}

/** A tiny piece of armor geometry, generic enough to fit any slot. */
export function buildArmorPiece(THREE, armorDef) {
  const group = new THREE.Group();
  const color = armorDef.color || '#6cc24a';
  const accent = armorDef.accent || '#2e7d32';
  switch (armorDef.slot) {
    case 'helmet': {
      // Sized a little larger than either head it might sit on (chibi hero
      // or mannequin) so it reads as a helmet worn over the head, not a
      // smaller shape buried inside it.
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.38, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), mat(THREE, color));
      dome.position.y = 0.08;
      group.add(dome);
      const trim = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.045, 6, 14), mat(THREE, accent));
      trim.position.y = 0;
      trim.rotation.x = Math.PI / 2;
      group.add(trim);
      break;
    }
    case 'chest': {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.6, 0.2), mat(THREE, color));
      group.add(plate);
      const belt = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.1, 0.24), mat(THREE, accent));
      belt.position.y = -0.2;
      group.add(belt);
      break;
    }
    case 'boots': {
      [-0.14, 0.14].forEach((x) => {
        const boot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.3), mat(THREE, color));
        boot.position.set(x, 0.1, 0.05);
        group.add(boot);
      });
      break;
    }
    case 'shield':
    default: {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 12), mat(THREE, color));
      disc.rotation.z = Math.PI / 2;
      group.add(disc);
      const boss = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), mat(THREE, accent));
      boss.position.x = 0.04;
      group.add(boss);
      break;
    }
  }
  return group;
}

/** A chibi hero built from simple primitives, with slot groups to hang armor on. */
export function buildHero(THREE) {
  const group = new THREE.Group();

  const legGeo = new THREE.CapsuleGeometry(0.09, 0.28, 4, 8);
  const legMat = mat(THREE, '#5d4037');
  [-0.12, 0.12].forEach((x) => {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(x, 0.24, 0);
    group.add(leg);
  });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.4, 4, 10), mat(THREE, '#4a90d9'));
  body.position.y = 0.68;
  group.add(body);

  const armGeo = new THREE.CapsuleGeometry(0.08, 0.32, 4, 8);
  const armMat = mat(THREE, '#f2c199');
  [-0.38, 0.38].forEach((x) => {
    const arm = new THREE.Mesh(armGeo, armMat);
    arm.position.set(x, 0.7, 0);
    arm.rotation.z = x < 0 ? 0.25 : -0.25;
    group.add(arm);
  });

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), mat(THREE, '#f2c199'));
  head.position.y = 1.2;
  group.add(head);

  // Big friendly chibi eyes.
  const eyeGeo = new THREE.SphereGeometry(0.045, 8, 8);
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#2b2b2b' });
  [-0.11, 0.11].forEach((x) => {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(x, 1.21, 0.29);
    group.add(eye);
  });

  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.33, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(THREE, '#3e2723'));
  hair.position.y = 1.28;
  group.add(hair);

  const slots = {};
  slots.helmet = new THREE.Group();
  slots.helmet.position.y = 1.2;
  group.add(slots.helmet);

  slots.chest = new THREE.Group();
  slots.chest.position.y = 0.68;
  group.add(slots.chest);

  slots.boots = new THREE.Group();
  slots.boots.position.y = 0.05;
  group.add(slots.boots);

  slots.shield = new THREE.Group();
  slots.shield.position.set(0.42, 0.68, 0.1);
  group.add(slots.shield);

  group.add(shadowAt(THREE, 0, 0, 0.5));
  group.userData.hair = hair;
  group.userData.slots = slots;
  return { group, slots };
}

const SHAPE_BUILDERS = {
  round: (THREE, colors) => {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), mat(THREE, colors.body));
    group.add(body);
    const earGeo = new THREE.ConeGeometry(0.1, 0.2, 8);
    [-0.22, 0.22].forEach((x) => {
      const ear = new THREE.Mesh(earGeo, mat(THREE, colors.accent));
      ear.position.set(x, 0.4, 0);
      group.add(ear);
    });
    return group;
  },
  tall: (THREE, colors) => {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.5, 4, 10), mat(THREE, colors.body));
    body.position.y = 0.3;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), mat(THREE, colors.accent));
    head.position.y = 0.72;
    group.add(head);
    return group;
  },
  long: (THREE, colors) => {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.7, 4, 10), mat(THREE, colors.body));
    body.rotation.z = Math.PI / 2;
    body.position.y = 0.22;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), mat(THREE, colors.accent));
    head.position.set(0.5, 0.22, 0);
    group.add(head);
    return group;
  },
  winged: (THREE, colors) => {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), mat(THREE, colors.body));
    body.position.y = 0.32;
    group.add(body);
    const wingGeo = new THREE.ConeGeometry(0.28, 0.5, 4);
    [-1, 1].forEach((side) => {
      const wing = new THREE.Mesh(wingGeo, mat(THREE, colors.accent));
      wing.position.set(side * 0.32, 0.4, -0.05);
      wing.rotation.z = side * 1.1;
      wing.rotation.x = 0.3;
      group.add(wing);
    });
    return group;
  },
};

/** Procedural creature body from CREATURES content: {shape, colors}. */
export function buildCreature(THREE, creatureDef) {
  const builder = SHAPE_BUILDERS[creatureDef.shape] || SHAPE_BUILDERS.round;
  const group = builder(THREE, creatureDef.colors);
  // Shared cute face: two big eyes, on top of whatever body shape we got.
  const box = new THREE.Box3().setFromObject(group);
  const topY = box.max.y;
  const eyeGeo = new THREE.SphereGeometry(0.055, 8, 8);
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#232323' });
  [-0.1, 0.1].forEach((x) => {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(x, topY - 0.12, 0.28);
    group.add(eye);
  });
  group.add(shadowAt(THREE, 0, 0, 0.4));
  return group;
}

export function buildEgg(THREE) {
  const group = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 16), mat(THREE, '#fff6e0', { emissive: '#000000', emissiveIntensity: 0 }));
  shell.scale.set(0.85, 1.15, 0.85);
  shell.position.y = 0.5;
  shell.name = 'shell';
  group.add(shell);
  group.add(shadowAt(THREE, 0, 0, 0.45));
  group.userData.shell = shell;
  group.userData.cracks = [];
  return group;
}

export function addCrackDecal(THREE, eggGroup, index) {
  const angle = (index / 4) * Math.PI * 2 + 0.4;
  const crack = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.32 + index * 0.03, 0.01),
    new THREE.MeshBasicMaterial({ color: '#5d4531' })
  );
  const radius = 0.36;
  crack.position.set(Math.sin(angle) * radius * 0.85, 0.55 + index * 0.03, Math.cos(angle) * radius * 0.85);
  crack.rotation.y = angle;
  crack.rotation.z = (Math.random() - 0.5) * 0.6;
  eggGroup.add(crack);
  eggGroup.userData.cracks.push(crack);
  return crack;
}
