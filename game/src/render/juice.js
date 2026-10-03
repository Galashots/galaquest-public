// Tiny hand-rolled tween + particle system. No external dependency: the
// brief asks for a self-contained prototype, and our needs (pop/bounce
// scale tweens, a sparkle burst) are simple enough to not need a library.

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

export function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function easeOutQuad(t) {
  return 1 - (1 - t) * (1 - t);
}

export class TweenManager {
  constructor() {
    this.tweens = [];
  }

  /**
   * Animate object[prop] from `from` to `to` over `duration` seconds.
   * Progress is measured from an absolute start timestamp (performance.now()),
   * not accumulated per-frame delta -- so a long gap between rendered frames
   * (a backgrounded tab, a stalled rAF during an orientation change, iOS
   * throttling) resolves to "already finished" instead of leaving the
   * animation stuck partway forever. This matters here because some tweens
   * (e.g. the hatch pop-in) are the only thing that brings an object to its
   * final, interactive scale/opacity -- it must always be able to catch up.
   */
  add({ target, prop, from, to, duration, ease = easeOutQuad, onUpdate, onComplete }) {
    this.tweens.push({ target, prop, from, to, duration, startedAt: now(), ease, onUpdate, onComplete });
  }

  /** A little scale pop: grows past 1 then settles back, like a bounce. */
  pop(object3D, { peak = 1.25, duration = 0.35 } = {}) {
    const startScale = object3D.scale.x;
    this.add({
      target: object3D,
      prop: '__pop',
      from: 0,
      to: 1,
      duration,
      ease: easeOutBack,
      onUpdate: (v) => {
        const s = v < 0.5
          ? startScale + (peak - startScale) * (v / 0.5)
          : peak + (startScale - peak) * ((v - 0.5) / 0.5);
        object3D.scale.setScalar(s);
      },
      onComplete: () => object3D.scale.setScalar(startScale),
    });
  }

  update() {
    const t0 = now();
    this.tweens = this.tweens.filter((tw) => {
      const elapsed = (t0 - tw.startedAt) / 1000;
      const t = Math.min(1, elapsed / tw.duration);
      const eased = tw.ease(t);
      const value = tw.from + (tw.to - tw.from) * eased;
      if (tw.onUpdate) tw.onUpdate(value, t);
      else if (tw.target && tw.prop) tw.target[tw.prop] = value;
      if (t >= 1) {
        if (tw.onComplete) tw.onComplete();
        return false;
      }
      return true;
    });
  }
}

/**
 * A simple point-sprite-free particle burst using tiny meshes, good enough
 * for a handful of sparkles at a time. Particles are pooled per-burst and
 * removed from the scene once they fade out.
 */
export class SparkleBurst {
  constructor(scene, THREE) {
    this.scene = scene;
    this.THREE = THREE;
    this.particles = [];
    this.sharedGeometry = new THREE.OctahedronGeometry(0.06, 0);
  }

  spawn(position, color = '#ffe066', count = 14) {
    const { THREE } = this;
    for (let i = 0; i < count; i++) {
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(this.sharedGeometry, material);
      mesh.position.copy(position);
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 1.8;
      const up = 1.5 + Math.random() * 2;
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3(Math.cos(angle) * speed, up, Math.sin(angle) * speed),
        life: 0,
        maxLife: 0.5 + Math.random() * 0.4,
      });
    }
  }

  update(dt) {
    const gravity = 4;
    this.particles = this.particles.filter((p) => {
      p.life += dt;
      p.velocity.y -= gravity * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.mesh.rotation.x += dt * 6;
      p.mesh.rotation.y += dt * 4;
      const t = p.life / p.maxLife;
      p.mesh.material.opacity = Math.max(0, 1 - t);
      const scale = Math.max(0.001, 1 - t * 0.6);
      p.mesh.scale.setScalar(scale);
      if (t >= 1) {
        this.scene.remove(p.mesh);
        p.mesh.material.dispose();
        return false;
      }
      return true;
    });
  }
}
