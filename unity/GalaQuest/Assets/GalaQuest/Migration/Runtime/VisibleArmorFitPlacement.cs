using System;
using UnityEngine;

namespace GalaQuest.Migration
{
    /// <summary>Ports the accepted Three.js root-relative fit through one Unity placement seam.</summary>
    public static class VisibleArmorFitPlacement
    {
        public static Transform Attach(Transform heroRoot, GameObject gearRoot, VisibleArmorFitAuthority authority)
        {
            if (heroRoot == null) throw new ArgumentNullException(nameof(heroRoot));
            if (gearRoot == null) throw new ArgumentNullException(nameof(gearRoot));
            if (authority == null || authority.restRelativeToHeroRoot == null) throw new ArgumentException("Fit authority is required.", nameof(authority));

            var rigRoot = FindRequired(heroRoot, "Armature");
            var bone = FindRequired(heroRoot, authority.boneName);
            heroRoot.gameObject.SendMessage("VisibleArmorPrepareBindPose", SendMessageOptions.DontRequireReceiver);
            heroRoot.gameObject.SetActive(true);
            heroRoot.root.gameObject.SetActive(true);
            heroRoot.localToWorldMatrix.GetColumn(0); // Force no lazy assumptions before matrix reads.
            heroRoot.gameObject.GetComponentsInChildren<SkinnedMeshRenderer>(true);

            // The source fit is relative to the GLTF Armature node. Native FBX import owns the
            // file's axis conversion; this reflection is the only source-transform conversion here.
            var source = authority.restRelativeToHeroRoot;
            var sourceRigScale = ToVector3(authority.sourceRigRootScale);
            var sourceFitPosition = Vector3.Scale(ToVector3(source.position), sourceRigScale);
            var sourceFitRotation = ToQuaternion(source.quaternion);
            var sourceFitScale = Vector3.Scale(ToVector3(source.scale), sourceRigScale);

            var sourceHeadPosition = ToVector3(authority.sourceHeadPosition);
            var sourceRelativePosition = sourceFitPosition - sourceHeadPosition;
            var sourceRelativeRotation = Quaternion.Inverse(ToQuaternion(authority.sourceHeadQuaternion)) * sourceFitRotation;

            // Blender's approved FBX handoff presents this static GLB as S*p=(-x,-z,y) in Unity.
            // The accepted fit is expressed in Three.js space relative to Head. D reflects the
            // source world into Unity, and S-transpose removes the static mesh's imported basis.
            var sourceToUnity = Matrix4x4.Scale(new Vector3(1f, 1f, -1f));
            var importedFbxBasisInverse = Matrix4x4.identity;
            importedFbxBasisInverse.SetColumn(0, new Vector4(-1f, 0f, 0f, 0f));
            importedFbxBasisInverse.SetColumn(1, new Vector4(0f, 0f, -1f, 0f));
            importedFbxBasisInverse.SetColumn(2, new Vector4(0f, 1f, 0f, 0f));
            var sourceRelativeFit = Matrix4x4.TRS(sourceRelativePosition, sourceRelativeRotation, sourceFitScale);
            var desiredLocal = sourceToUnity * sourceRelativeFit * importedFbxBasisInverse;
            var desiredWorld = bone.localToWorldMatrix * desiredLocal;
            var local = bone.worldToLocalMatrix * desiredWorld;

            gearRoot.transform.SetParent(bone, false);
            ApplyMatrix(gearRoot.transform, local);
            gearRoot.name = "Silverguard Helmet (fit-authority)";
            return gearRoot.transform;
        }

        public static Transform FindRequired(Transform root, string name)
        {
            foreach (var transform in root.GetComponentsInChildren<Transform>(true))
                if (transform.name == name) return transform;
            throw new VisibleArmorManifestValidationException($"Visible armor proof requires {name} under {root.name}.");
        }

        public static Vector3 ToVector3(float[] values)
        {
            if (values == null || values.Length != 3) throw new VisibleArmorManifestValidationException("Expected a 3-component vector.");
            return new Vector3(values[0], values[1], values[2]);
        }

        public static Quaternion ToQuaternion(float[] values)
        {
            if (values == null || values.Length != 4) throw new VisibleArmorManifestValidationException("Expected a 4-component quaternion.");
            return new Quaternion(values[0], values[1], values[2], values[3]);
        }

        private static void ApplyMatrix(Transform target, Matrix4x4 matrix)
        {
            target.localPosition = matrix.GetColumn(3);
            target.localRotation = matrix.rotation;
            target.localScale = matrix.lossyScale;
            if (float.IsNaN(target.localScale.x) || float.IsInfinity(target.localScale.x))
                throw new VisibleArmorManifestValidationException("Fit placement produced a non-finite scale.");
        }
    }
}
