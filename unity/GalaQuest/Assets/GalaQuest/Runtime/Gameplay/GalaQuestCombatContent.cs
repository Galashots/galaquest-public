using System;
using UnityEngine;

namespace GalaQuest
{
    [CreateAssetMenu(menuName = "GalaQuest/Combat content")]
    public sealed class GalaQuestCombatContent : ScriptableObject
    {
        public GameObject HeroPrefab;
        public RuntimeAnimatorController HeroController;
        public GalaQuest.Gear.GearItemDefinition StarterWeapon;
        public GalaQuest.Gear.GearItemDefinition MagmaLordHelmet;
        public EnemyPrefab[] Enemies = Array.Empty<EnemyPrefab>();
        public Material TelegraphMaterial;
        public AudioClip Swing;
        public AudioClip Impact;
        public AudioClip Hurt;
        public AudioClip Victory;
        public AudioClip Windup;

        public GameObject FindEnemy(string kind)
        {
            foreach (var entry in Enemies) if (entry.Kind == kind) return entry.Prefab;
            return null;
        }

        [Serializable]
        public sealed class EnemyPrefab
        {
            public string Kind;
            public GameObject Prefab;
        }
    }
}
