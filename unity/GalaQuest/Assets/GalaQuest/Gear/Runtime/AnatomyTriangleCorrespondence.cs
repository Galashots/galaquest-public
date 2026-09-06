using System;
using System.Collections.Generic;
using System.Globalization;
using UnityEngine;

namespace GalaQuest.Gear
{
    /// <summary>Transfers supervised source faces only through a complete, unique UV correspondence.</summary>
    public static class AnatomyTriangleCorrespondence
    {
        public static bool TryResolve(Vector2[] uv, int[] triangles, string[] sourceKeys,
            int quantization, out int[] sourceToUnity, out string error)
        {
            sourceToUnity = null;
            error = "Anatomy transfer requires a complete, unique UV-triangle correspondence.";
            if (uv == null || triangles == null || sourceKeys == null || sourceKeys.Length == 0 ||
                triangles.Length != sourceKeys.Length * 3 || quantization != 100000) return false;
            var source = new Dictionary<string, int>(StringComparer.Ordinal);
            for (var i = 0; i < sourceKeys.Length; i++)
            {
                if (string.IsNullOrEmpty(sourceKeys[i]) || source.ContainsKey(sourceKeys[i])) return false;
                source.Add(sourceKeys[i], i);
            }
            // Importers may invert V. Accept only one complete solution, never a partial/nearest match.
            var direct = Resolve(uv, triangles, source, quantization, false);
            var flipped = Resolve(uv, triangles, source, quantization, true);
            if ((direct == null) == (flipped == null)) return false;
            sourceToUnity = direct ?? flipped;
            error = null;
            return true;
        }

        private static int[] Resolve(Vector2[] uv, int[] triangles, Dictionary<string, int> source,
            int quantization, bool flipV)
        {
            var result = new int[source.Count];
            var seen = new bool[source.Count];
            var corners = new string[3];
            for (var face = 0; face < source.Count; face++)
            {
                for (var corner = 0; corner < 3; corner++)
                {
                    var index = triangles[face * 3 + corner];
                    if (index < 0 || index >= uv.Length) return null;
                    double u = uv[index].x, v = flipV ? 1.0 - uv[index].y : uv[index].y;
                    if (double.IsNaN(u) || double.IsInfinity(u) || double.IsNaN(v) || double.IsInfinity(v)) return null;
                    // Match JavaScript Math.round, including its negative-half convention.
                    corners[corner] = Math.Floor(u * quantization + 0.5).ToString(CultureInfo.InvariantCulture) + "," +
                                      Math.Floor(v * quantization + 0.5).ToString(CultureInfo.InvariantCulture);
                }
                Array.Sort(corners, StringComparer.Ordinal);
                if (!source.TryGetValue(string.Join(";", corners), out var sourceFace) || seen[sourceFace]) return null;
                seen[sourceFace] = true;
                result[sourceFace] = face;
            }
            return result;
        }
    }
}
