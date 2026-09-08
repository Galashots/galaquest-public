using System;
using System.Collections.Generic;
using UnityEngine;

namespace GalaQuest
{
    [DefaultExecutionOrder(110)]
    public sealed class GalaQuestCombatPresentation : MonoBehaviour
    {
        [SerializeField] private GalaQuestCombatContent content;
        private GalaQuestConnectionSession session;
        private GalaQuestTraversalController traversal;
        private GalaQuestAttackControl attackControl;
        private GalaQuestCombatMotion selfMotion;
        private GameObject selfWeapon;
        private GalaQuestServerHeroCombat self;
        private GalaQuestCombatAudio sound;
        private float receivedAt;
        private float selfHurtUntil;
        private float predictedSwingAt = float.NegativeInfinity;
        private float lastSwingSoundAt = float.NegativeInfinity;
        private int lastTick = -1;
        private Camera view;
        private GUIStyle textStyle;
        private readonly Dictionary<string, EnemyView> enemies = new Dictionary<string, EnemyView>();
        private readonly Dictionary<string, HeroView> companions = new Dictionary<string, HeroView>();
        private readonly HashSet<string> seen = new HashSet<string>();
        private readonly List<string> removed = new List<string>();
        public int EnemyViewCount => enemies.Count;
        public int RemoteHeroCount => companions.Count;
        public int LocalHealth => self?.hp ?? 0;
        public int LocalMaxHealth => self?.maxHp ?? 0;

        private sealed class EnemyView
        {
            public GameObject Body;
            public GalaQuestCombatMotion Motion;
            public GalaQuestServerEnemy State;
            public GameObject Telegraph;
            public Mesh Sector;
            public MeshRenderer TelegraphRenderer;
            public MaterialPropertyBlock Properties = new MaterialPropertyBlock();
            public float ReceivedAt;
            public float FlashUntil;
            public Renderer[] Renderers;
        }

        private sealed class HeroView
        {
            public GameObject Body;
            public GalaQuestCombatMotion Motion;
            public GalaQuestServerPlayer Player;
            public GalaQuestServerHeroCombat State;
            public float HurtUntil;
        }

        public void Configure(GalaQuestCombatContent assets) => content = assets;

        public void BindSession(GalaQuestConnectionSession value)
        {
            if (session != null)
            {
                session.ServerFrameReceived -= ApplyFrame;
                session.Disconnected -= ClearViews;
            }
            if (attackControl != null) attackControl.AttackRequested -= PredictAttack;
            if (selfWeapon != null) Destroy(selfWeapon);
            ClearViews();
            session = value;
            if (session == null) return;
            if (content == null) throw new InvalidOperationException("Combat content must be configured before joining.");
            traversal = GetComponent<GalaQuestTraversalController>();
            attackControl = GetComponent<GalaQuestAttackControl>();
            var hero = traversal.Hero;
            var animator = hero.GetComponent<Animator>();
            if (animator == null) animator = hero.gameObject.AddComponent<Animator>();
            animator.runtimeAnimatorController = content.HeroController;
            selfMotion = hero.GetComponent<GalaQuestCombatMotion>();
            if (selfMotion == null) selfMotion = hero.gameObject.AddComponent<GalaQuestCombatMotion>();
            selfMotion.Configure(animator, true);
            if (content.StarterWeapon != null) selfWeapon = GalaQuest.Gear.GearMounter.Mount(hero, content.StarterWeapon);
            sound = GetComponent<GalaQuestCombatAudio>();
            if (sound == null) sound = gameObject.AddComponent<GalaQuestCombatAudio>();
            sound.Configure(content);
            if (attackControl != null) attackControl.AttackRequested += PredictAttack;
            session.ServerFrameReceived += ApplyFrame;
            session.Disconnected += ClearViews;
        }

        private void PredictAttack()
        {
            if (self == null || self.hp <= 0 || self.swingSeconds >= 0 || self.cooldown > 0) return;
            if (Time.unscaledTime - predictedSwingAt < .25f) return;
            predictedSwingAt = Time.unscaledTime;
            selfMotion.Present("slash", 0, 1.5f);
            sound.PlaySwing();
            lastSwingSoundAt = Time.unscaledTime;
        }

        public void ApplyFrame(GalaQuestServerFrame frame)
        {
            if (session == null || string.IsNullOrEmpty(session.PlayerId) || frame.encounter == null) return;
            if (frame.type == "welcome" || frame.type == "destination-changed") ClearViews();
            else if (frame.tick <= lastTick) return;
            lastTick = frame.tick;
            receivedAt = Time.unscaledTime;
            frame.encounter.heroes.TryGetValue(session.PlayerId, out self);
            if (self != null && self.swingSeconds >= 0) predictedSwingAt = float.NegativeInfinity;
            seen.Clear();
            foreach (var state in frame.encounter.enemies)
            {
                if (state == null || string.IsNullOrEmpty(state.enemyId)) continue;
                seen.Add(state.enemyId);
                if (!enemies.TryGetValue(state.enemyId, out var actor))
                {
                    var prefab = content.FindEnemy(state.kind);
                    if (prefab == null) throw new InvalidOperationException("Missing visible body for enemy kind " + state.kind);
                    var body = Instantiate(prefab, Position(state.x, state.z), GalaQuestServerCoordinates.ToUnityHeading(state.heading));
                    body.name = "Enemy " + state.enemyId;
                    var motion = body.AddComponent<GalaQuestCombatMotion>();
                    motion.Configure(body.GetComponentInChildren<Animator>(), false);
                    actor = new EnemyView { Body = body, Motion = motion, Renderers = body.GetComponentsInChildren<Renderer>() };
                    enemies.Add(state.enemyId, actor);
                    CreateTelegraph(actor, state.attack);
                }
                if (state.mode == "bite" && actor.State?.mode != "bite") sound.PlayWindup();
                actor.State = state;
                actor.ReceivedAt = receivedAt;
                actor.Body.SetActive(state.mode != "dead");
            }
            RemoveAbsent(enemies, seen, actor => { Destroy(actor.Body); Destroy(actor.Sector); });
            seen.Clear();
            foreach (var player in frame.players)
            {
                if (player == null || player.id == session.PlayerId) continue;
                seen.Add(player.id);
                if (!companions.TryGetValue(player.id, out var actor))
                {
                    var body = Instantiate(content.HeroPrefab, Position(player.x, player.z), GalaQuestServerCoordinates.ToUnityHeading(player.heading));
                    body.name = "Other hero " + player.id;
                    var animator = body.GetComponent<Animator>();
                    if (animator == null) animator = body.AddComponent<Animator>();
                    animator.runtimeAnimatorController = content.HeroController;
                    var motion = body.AddComponent<GalaQuestCombatMotion>();
                    motion.Configure(animator, true);
                    if (content.StarterWeapon != null) GalaQuest.Gear.GearMounter.Mount(body.transform, content.StarterWeapon);
                    actor = new HeroView { Body = body, Motion = motion };
                    companions.Add(player.id, actor);
                }
                actor.Player = player;
                frame.encounter.heroes.TryGetValue(player.id, out actor.State);
            }
            RemoveAbsent(companions, seen, actor => Destroy(actor.Body));
            foreach (var item in frame.events)
            {
                if (item == null) continue;
                if (item.type == "hero-hurt")
                {
                    if (item.heroId == session.PlayerId) { selfHurtUntil = receivedAt + .5f; sound.PlayHurt(); }
                    else if (companions.TryGetValue(item.heroId, out var friend)) friend.HurtUntil = receivedAt + .5f;
                }
                if ((item.type == "wolf-hit" || item.type == "wolf-defeated") && item.enemyId != null && enemies.TryGetValue(item.enemyId, out var hit))
                {
                    hit.FlashUntil = receivedAt + .12f;
                    if (item.type == "wolf-defeated") sound.PlayVictory(); else sound.PlayImpact();
                }
                if (item.type == "swing" && item.heroId == session.PlayerId && receivedAt - lastSwingSoundAt > .25f)
                { sound.PlaySwing(); lastSwingSoundAt = receivedAt; }
            }
        }

        private Vector3 Position(float x, float z) => GalaQuestGroundSurface.Project(new Vector3(x, traversal.Hero.position.y, z), .01f);

        private void RemoveAbsent<T>(Dictionary<string, T> collection, HashSet<string> live, Action<T> release)
        {
            removed.Clear();
            foreach (var pair in collection) if (!live.Contains(pair.Key)) removed.Add(pair.Key);
            foreach (var key in removed) { release(collection[key]); collection.Remove(key); }
        }

        private void Update()
        {
            if (session == null || string.IsNullOrEmpty(session.PlayerId)) return;
            traversal.Hero.position = GalaQuestGroundSurface.Project(traversal.Hero.position, .01f);
            var age = Mathf.Clamp(Time.unscaledTime - receivedAt, 0, .15f);
            PresentHero(selfMotion, self, traversal.PredictedMotionSpeed, age, selfHurtUntil, Time.unscaledTime - predictedSwingAt < .25f);
            var blend = 1 - Mathf.Exp(-16 * Time.unscaledDeltaTime);
            foreach (var actor in companions.Values)
            {
                MoveBody(actor.Body.transform, Position(actor.Player.x, actor.Player.z), actor.Player.heading, blend);
                PresentHero(actor.Motion, actor.State, actor.Player.speed, age, actor.HurtUntil, false);
            }
            foreach (var actor in enemies.Values)
            {
                var state = actor.State;
                if (state.mode == "dead") continue;
                MoveBody(actor.Body.transform, Position(state.x, state.z), state.heading, blend);
                var clock = state.modeSeconds + Mathf.Clamp(Time.unscaledTime - actor.ReceivedAt, 0, .15f);
                var duration = state.mode == "bite" ? state.attack?.durationSeconds ?? 1.06f : state.mode == "hit" ? .667f : 1.75f;
                actor.Motion.Present(state.mode == "bite" ? "bash" : state.mode == "returning" ? "walk" : state.mode == "dying" || state.mode == "dead" ? "death" : state.mode,
                    clock, state.mode == "idle" || state.mode == "walk" || state.mode == "returning" ? 0 : duration);
                if (actor.Telegraph != null)
                {
                    var winding = state.mode == "bite" && clock < (state.attack?.contactSeconds ?? 0);
                    actor.Telegraph.SetActive(winding);
                    if (winding)
                    {
                        // The authored arena floor is higher than the flat movement
                        // anchor. Project the warning onto the real floor, not inside it.
                        actor.Telegraph.transform.position = GalaQuestGroundSurface.Project(actor.Body.transform.position, .025f);
                        var progress = Mathf.Clamp01(clock / state.attack.contactSeconds);
                        actor.Properties.SetColor("_BaseColor", new Color(1, .48f + .18f * progress, .08f, .22f + .28f * progress));
                        actor.TelegraphRenderer.SetPropertyBlock(actor.Properties);
                    }
                }
                var flash = Time.unscaledTime < actor.FlashUntil;
                actor.Properties.Clear();
                actor.Properties.SetColor("_EmissionColor", flash ? new Color(1.4f, .65f, .1f) : Color.black);
                foreach (var renderer in actor.Renderers) renderer.SetPropertyBlock(actor.Properties);
            }
        }

        private static void MoveBody(Transform body, Vector3 target, float heading, float blend)
        {
            body.position = Vector3.Distance(body.position, target) > 3 ? target : Vector3.Lerp(body.position, target, blend);
            body.rotation = Quaternion.Slerp(body.rotation, GalaQuestServerCoordinates.ToUnityHeading(heading), blend);
        }

        private static void PresentHero(GalaQuestCombatMotion motion, GalaQuestServerHeroCombat state, float speed, float age, float hurtUntil, bool predicted)
        {
            if (motion == null || state == null) return;
            if (state.downSeconds >= 0) motion.Present("death", state.downSeconds + age, 1.75f);
            else if (state.swingSeconds >= 0) motion.Present("slash", state.swingSeconds + age, 1.5f);
            else if (predicted) { /* Preserve immediate prediction until the first authoritative answer. */ }
            else if (Time.unscaledTime < hurtUntil) motion.Present("hit", .5f - (hurtUntil - Time.unscaledTime), 0);
            else motion.Present("idle", 0, 0, speed);
        }

        private void CreateTelegraph(EnemyView actor, GalaQuestServerEnemyAttack attack)
        {
            if (attack == null || attack.reach <= 0 || content.TelegraphMaterial == null) return;
            const int segments = 24;
            var vertices = new Vector3[segments + 2];
            var triangles = new int[segments * 3];
            for (var i = 0; i <= segments; i++)
            {
                var angle = Mathf.Lerp(-attack.halfArcRadians, attack.halfArcRadians, i / (float)segments);
                vertices[i + 1] = new Vector3(Mathf.Sin(angle) * attack.reach, 0, Mathf.Cos(angle) * attack.reach);
                if (i < segments) { triangles[i * 3] = 0; triangles[i * 3 + 1] = i + 1; triangles[i * 3 + 2] = i + 2; }
            }
            actor.Sector = new Mesh { name = "Authoritative attack area", vertices = vertices, triangles = triangles };
            actor.Sector.RecalculateNormals();
            actor.Telegraph = new GameObject("Bash warning");
            actor.Telegraph.transform.SetParent(actor.Body.transform, false);
            actor.Telegraph.transform.localPosition = Vector3.up * .025f;
            actor.Telegraph.AddComponent<MeshFilter>().sharedMesh = actor.Sector;
            actor.TelegraphRenderer = actor.Telegraph.AddComponent<MeshRenderer>();
            actor.TelegraphRenderer.sharedMaterial = content.TelegraphMaterial;
            actor.Telegraph.SetActive(false);
        }

        private void OnGUI()
        {
            if (self == null) return;
            textStyle ??= new GUIStyle(GUI.skin.label) { alignment = TextAnchor.MiddleCenter, fontStyle = FontStyle.Bold };
            textStyle.fontSize = Mathf.Clamp(Mathf.RoundToInt(Screen.height / 35f), 16, 26);
            if (GetComponent<GalaQuestHeroHud>() == null)
                DrawHealth(new Rect(20, 94, 190, 24), self.hp, self.maxHp, new Color(.35f, .86f, .5f));
            if (self.downSeconds >= 0) GUI.Label(new Rect(Screen.width / 2f - 160, Screen.height * .35f, 320, 50), "Back on your feet in a moment", textStyle);
            if (Time.unscaledTime < selfHurtUntil)
            {
                var old = GUI.color;
                GUI.color = new Color(1, .15f, .08f, .2f * Mathf.Clamp01((selfHurtUntil - Time.unscaledTime) * 2));
                GUI.DrawTexture(new Rect(0, 0, Screen.width, 8), Texture2D.whiteTexture);
                GUI.DrawTexture(new Rect(0, Screen.height - 8, Screen.width, 8), Texture2D.whiteTexture);
                GUI.color = old;
            }
            if (view == null) view = Camera.main;
            if (view == null) return;
            foreach (var actor in enemies.Values)
            {
                if (actor.State.hp <= 0 || Vector3.Distance(actor.Body.transform.position, traversal.Hero.position) > 9) continue;
                var point = view.WorldToScreenPoint(actor.Body.transform.position + Vector3.up * 1.35f);
                if (point.z <= 0) continue;
                DrawHealth(new Rect(point.x - 42, Screen.height - point.y, 84, 11), actor.State.hp, actor.State.maxHp, new Color(1, .52f, .2f));
            }
            foreach (var actor in companions.Values)
            {
                if (actor.State == null) continue;
                var point = view.WorldToScreenPoint(actor.Body.transform.position + Vector3.up * 1.8f);
                if (point.z > 0) DrawHealth(new Rect(point.x - 38, Screen.height - point.y, 76, 9), actor.State.hp, actor.State.maxHp, new Color(.3f, .8f, 1));
            }
        }

        private static void DrawHealth(Rect rect, int hp, int maxHp, Color color)
        {
            var old = GUI.color;
            GUI.color = new Color(.07f, .055f, .05f, .9f);
            GUI.DrawTexture(new Rect(rect.x - 2, rect.y - 2, rect.width + 4, rect.height + 4), Texture2D.whiteTexture);
            GUI.color = color;
            rect.width *= maxHp > 0 ? Mathf.Clamp01(hp / (float)maxHp) : 0;
            GUI.DrawTexture(rect, Texture2D.whiteTexture);
            GUI.color = old;
        }

        private void ClearViews()
        {
            foreach (var actor in enemies.Values) { Destroy(actor.Body); Destroy(actor.Sector); }
            foreach (var actor in companions.Values) Destroy(actor.Body);
            enemies.Clear(); companions.Clear();
            self = null; lastTick = -1; selfHurtUntil = 0;
            predictedSwingAt = float.NegativeInfinity;
            if (selfMotion != null) selfMotion.Present("idle", 0, 0);
        }

        private void OnDestroy() => BindSession(null);
    }
}
