using System;
using System.Collections.Generic;
using UnityEngine;

namespace GalaQuest.Gear
{
    /// <summary>
    /// The single generic mount path for every rigid gear item.
    ///
    /// There is deliberately no per-item branch here and no per-item MonoBehaviour anywhere. Mounting
    /// resolves the item's socket by id, parents the instance to that socket, and applies the item's
    /// authored socket-local transform. Adding a tenth helmet exercises exactly this code.
    ///
    /// Because the fit is socket-local and the socket is a real child Transform of a bone, the mount
    /// needs no bind-pose inversion, no rig-root matrix and no coordinate conversion. Unity's Transform
    /// hierarchy already is the attachment maths.
    /// </summary>
    public static class GearMounter
    {
        public sealed class MountFailure : Exception
        {
            public MountFailure(string message) : base(message) { }
        }

        /// <summary>Find every socket under a hero instance, keyed by socket id.</summary>
        public static Dictionary<string, GearSocket> CollectSockets(Transform heroRoot)
        {
            if (heroRoot == null) throw new ArgumentNullException(nameof(heroRoot));

            var sockets = new Dictionary<string, GearSocket>(StringComparer.Ordinal);
            foreach (var socket in heroRoot.GetComponentsInChildren<GearSocket>(true))
            {
                if (string.IsNullOrEmpty(socket.SocketId)) continue;
                if (sockets.ContainsKey(socket.SocketId))
                {
                    throw new MountFailure(
                        $"GQ_HERO_V1 has more than one socket with id '{socket.SocketId}'.");
                }
                sockets.Add(socket.SocketId, socket);
            }

            return sockets;
        }

        public static GearSocket ResolveSocket(Transform heroRoot, string socketId)
        {
            if (string.IsNullOrEmpty(socketId))
                throw new MountFailure("Gear item definition has no socketId.");

            var sockets = CollectSockets(heroRoot);
            if (!sockets.TryGetValue(socketId, out var socket))
            {
                throw new MountFailure(
                    $"GQ_HERO_V1 has no socket '{socketId}'. Available: {string.Join(", ", sockets.Keys)}");
            }

            return socket;
        }

        /// <summary>
        /// Apply an item's authored fit to an already-instantiated gear object. Used by both the runtime
        /// mount and the workbench, so what the Owner sees while fitting is what a mount produces.
        /// </summary>
        public static void ApplyFit(Transform gear, GearSocket socket, GearItemDefinition definition)
        {
            if (gear == null) throw new ArgumentNullException(nameof(gear));
            if (socket == null) throw new ArgumentNullException(nameof(socket));
            if (definition == null) throw new ArgumentNullException(nameof(definition));

            gear.SetParent(socket.transform, false);
            gear.localPosition = definition.LocalPosition;
            gear.localRotation = definition.LocalRotation;
            gear.localScale = definition.EffectiveLocalScale;
        }

        /// <summary>
        /// Instantiate and mount an item onto a hero instance. Returns the mounted instance.
        /// </summary>
        public static GameObject Mount(Transform heroRoot, GearItemDefinition definition)
        {
            if (definition == null) throw new ArgumentNullException(nameof(definition));
            if (definition.SourceModel == null)
                throw new MountFailure($"Gear item '{definition.name}' has no source model assigned.");

            var socket = ResolveSocket(heroRoot, definition.SocketId);
            var instance = UnityEngine.Object.Instantiate(definition.SourceModel);
            instance.name = definition.DisplayName;
            ApplyFit(instance.transform, socket, definition);
            return instance;
        }
    }
}
