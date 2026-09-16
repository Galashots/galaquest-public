using System;
using UnityEngine;

namespace GalaQuest
{
    public sealed class GalaQuestPetCampPresenter : MonoBehaviour
    {
        private GalaQuestConnectionSession session;
        private GalaQuestTraversalController traversal;
        private GalaQuestServerPetState state;
        private GalaQuestPetOffer currentOffer;
        private readonly GameObject[] offerBodies = new GameObject[GalaQuestPetCatalog.Offers.Length];
        private readonly GameObject[] offerMarkers = new GameObject[GalaQuestPetCatalog.Offers.Length];
        private bool stateKnown;
        private bool pendingAction;
        private string pendingFriendshipId;
        private string lastError;
        private bool gestureHeld, gestureCancelled;
        private string pressedPetId, pressedAction;
        private int pressedRevision, releasedFrame = -1;

        public bool IsNear => currentOffer != null && session != null
            && session.DestinationId == GalaQuestPetCatalog.CampDestinationId;
        public bool OwnsContextAction => session != null
            && session.DestinationId == GalaQuestPetCatalog.CampDestinationId
            && !string.IsNullOrEmpty(session.PlayerId) && !session.IsTravelling
            && (IsNear || gestureHeld || releasedFrame == Time.frameCount);
        public string CurrentPetId => currentOffer?.Id;
        public string CurrentAction => !stateKnown || currentOffer == null ? null : ActionFor(state, currentOffer.Id);

        public void BindSession(GalaQuestConnectionSession value)
        {
            if (session != null)
            {
                session.ServerFrameReceived -= ApplyFrame;
                session.PetStateChanged -= ApplyPetState;
                session.Disconnected -= ResetTransient;
                session.TravelStarted -= ResetTransient;
            }
            session = value;
            traversal = GetComponent<GalaQuestTraversalController>();
            state = null;
            stateKnown = false;
            currentOffer = null;
            pendingAction = false;
            pendingFriendshipId = null;
            lastError = null;
            if (session != null)
            {
                session.ServerFrameReceived += ApplyFrame;
                session.PetStateChanged += ApplyPetState;
                session.Disconnected += ResetTransient;
                session.TravelStarted += ResetTransient;
            }
            CancelGesture();
            RefreshOfferVisuals();
        }

        private void ApplyFrame(GalaQuestServerFrame frame)
        {
            if (session == null || frame == null) return;
            if (session.DestinationId != GalaQuestPetCatalog.CampDestinationId)
            {
                stateKnown = false;
                currentOffer = null;
                RefreshOfferVisuals();
                return;
            }
            if (frame.type == "welcome" || frame.type == "snapshot" || frame.type == "state")
            {
                GalaQuestServerRewards reward = null;
                if (frame.encounter?.rewards != null)
                    frame.encounter.rewards.TryGetValue(session.PlayerId, out reward);
                state = reward?.pets ?? EmptyState();
                stateKnown = true;
                lastError = null;
            }
            RefreshOfferVisuals();
        }

        private void ApplyPetState(GalaQuestServerPetState next, string error)
        {
            var celebrate = pendingAction && error == null && pendingFriendshipId != null
                && next?.ownedPetIds != null && Array.IndexOf(next.ownedPetIds, pendingFriendshipId) >= 0
                ? pendingFriendshipId : null;
            pendingFriendshipId = null;
            state = next;
            stateKnown = next != null;
            pendingAction = false;
            lastError = error;
            RefreshOfferVisuals();
            if (celebrate != null)
            {
                if (next.equippedPetId == celebrate) GetComponent<GalaQuestCombatPresentation>()?.CelebrateFriendship(celebrate);
                else for (var i = 0; i < GalaQuestPetCatalog.Offers.Length; i++)
                    if (GalaQuestPetCatalog.Offers[i].Id == celebrate) offerBodies[i]?.GetComponent<GalaQuestWormMotion>()?.Celebrate();
            }
        }

        private void ResetTransient()
        {
            CancelGesture();
            pendingAction = false;
            pendingFriendshipId = null;
            lastError = null;
            stateKnown = false;
            currentOffer = null;
            RefreshOfferVisuals();
        }

        private void Update()
        {
            if (session == null || traversal == null
                || session.DestinationId != GalaQuestPetCatalog.CampDestinationId)
            {
                currentOffer = null;
                RefreshOfferVisuals();
                return;
            }
            currentOffer = FindNearestOffer(traversal.PredictedPosition);
            if (gestureHeld && !PressedTargetStillValid()) gestureCancelled = true;
            RefreshOfferVisuals();
        }

        public bool TryCurrentAction()
        {
            if (!OwnsContextAction || !stateKnown || pendingAction || !session.ControlsReady) return false;
            currentOffer = FindNearestOffer(traversal.PredictedPosition);
            var action = CurrentAction;
            if (currentOffer == null || string.IsNullOrEmpty(action) || state?.equipRev == int.MaxValue) return false;
            var rev = Mathf.Max(0, (state?.equipRev ?? -1) + 1);
            var eventId = Guid.NewGuid().ToString("N");
            if (!session.TrySendPetAction(action, currentOffer.Id, eventId, rev)) return false;
            pendingAction = true;
            pendingFriendshipId = action == "befriend" ? currentOffer.Id : null;
            lastError = null;
            return true;
        }

        public static GalaQuestPetOffer FindNearestOffer(Vector2 position)
        {
            if (float.IsNaN(position.x) || float.IsNaN(position.y)
                || float.IsInfinity(position.x) || float.IsInfinity(position.y)) return null;
            GalaQuestPetOffer best = null;
            var bestDistance = float.PositiveInfinity;
            var radiusSquared = GalaQuestPetCatalog.InteractionRadius * GalaQuestPetCatalog.InteractionRadius;
            foreach (var offer in GalaQuestPetCatalog.Offers)
            {
                var dx = position.x - offer.CampX;
                var dz = position.y - offer.CampZ;
                var distance = dx * dx + dz * dz;
                if (distance > radiusSquared || distance >= bestDistance) continue;
                best = offer;
                bestDistance = distance;
            }
            return best;
        }

        public static string ActionFor(GalaQuestServerPetState current, string petId)
        {
            if (string.IsNullOrEmpty(petId)) return null;
            var owned = current?.ownedPetIds != null && Array.IndexOf(current.ownedPetIds, petId) >= 0;
            if (!owned) return "befriend";
            return current.equippedPetId == petId ? "rest" : "follow";
        }

        private bool PressedTargetStillValid() => currentOffer?.Id == pressedPetId
            && CurrentAction == pressedAction && (state?.equipRev ?? -1) == pressedRevision;

        public bool HandleContextPointer(EventType type, Vector2 point, Vector2 viewport)
        {
            var inside = GalaQuestDestinationPresentation.TravelButtonRect(viewport).Contains(point);
            if (type == EventType.MouseDown && OwnsContextAction && inside)
            {
                gestureHeld = true;
                gestureCancelled = pendingAction || !stateKnown || !session.ControlsReady;
                pressedPetId = currentOffer?.Id; pressedAction = CurrentAction;
                pressedRevision = state?.equipRev ?? -1;
                return true;
            }
            if (!gestureHeld) return false;
            if (type == EventType.MouseDrag || type == EventType.MouseMove)
            { gestureCancelled |= !inside || !PressedTargetStillValid(); return true; }
            if (type != EventType.MouseUp) return false;
            var activate = inside && !gestureCancelled && PressedTargetStillValid();
            gestureHeld = false; releasedFrame = Time.frameCount;
            if (activate) TryCurrentAction();
            return true;
        }

        private void CancelGesture()
        { gestureHeld = false; gestureCancelled = true; releasedFrame = Time.frameCount; }
        private void OnApplicationFocus(bool focused) { if (!focused) CancelGesture(); }
        private void OnDisable() => ResetTransient();

        private void OnGUI()
        {
            if (!OwnsContextAction || GalaQuestRuneForgePresenter.IsInputCaptured) return;
            var layout = new GalaQuestCombatHudLayout(new Vector2(Screen.width, Screen.height));
            var rect = layout.Travel;
            var action = CurrentAction;
            var canAct = !pendingAction && stateKnown && session.ControlsReady && action != null;
            var e = Event.current;
            if (e.button == 0 && HandleContextPointer(e.type, e.mousePosition,
                new Vector2(Screen.width, Screen.height))) e.Use();

            if (Event.current.type != EventType.Repaint) return;
            GalaQuestCombatHudStyle.Panel(rect, lit: canAct);
            var verb = pendingAction ? "ONE MOMENT..." : !stateKnown ? "MEETING..." : action == "befriend"
                ? "BEFRIEND" : action == "follow" ? "FOLLOW" : "LET REST";
            var label = currentOffer == null ? verb : verb + "\n" + currentOffer.DisplayName.ToUpperInvariant();
            GalaQuestCombatHudStyle.Text(GalaQuestCombatHudStyle.Inset(rect, 8 * layout.Scale), label,
                15 * layout.Scale, canAct ? GalaQuestCombatHudStyle.Ink : Color.gray,
                true, TextAnchor.MiddleCenter, true);

            GalaQuestCombatHudStyle.Panel(layout.Objective, paper: true);
            var content = GalaQuestCombatHudStyle.Inset(layout.Objective, 12 * layout.Scale);
            GalaQuestCombatHudStyle.Text(new Rect(content.x, content.y - 4 * layout.Scale,
                    content.width, 18 * layout.Scale),
                "CAMP  /  " + (currentOffer?.DisplayName ?? "WORM FRIEND").ToUpperInvariant(),
                11 * layout.Scale, new Color(.25f, .15f, .06f), true);
            content.y += 14 * layout.Scale;
            content.height -= 10 * layout.Scale;
            var instruction = !string.IsNullOrEmpty(lastError) ? ErrorText(lastError)
                : action == "befriend" ? "Tap BEFRIEND to make a friend"
                : action == "follow" ? "Ask this worm to follow you"
                : action == "rest" ? "Let this worm rest at Camp"
                : "Getting to know this worm...";
            GalaQuestCombatHudStyle.Text(content, instruction, 17 * layout.Scale,
                new Color(.14f, .085f, .025f), true);
        }
        private void EnsureOfferVisuals()
        {
            for (var i = 0; i < GalaQuestPetCatalog.Offers.Length; i++)
            {
                var offer = GalaQuestPetCatalog.Offers[i];
                if (offerMarkers[i] == null)
                    offerMarkers[i] = GalaQuestPetVisuals.CreateMarker(offer,
                        new Vector3(offer.CampX, .015f, offer.CampZ));
                if (offerBodies[i] == null)
                {
                    var position = new Vector3(offer.CampX, .22f, offer.CampZ);
                    offerBodies[i] = GetComponent<GalaQuestPetAppearanceCatalog>()?.Create(
                        "Camp pet " + offer.Id, offer.Id, position, Quaternion.Euler(0, 180, 0))
                        ?? GalaQuestPetVisuals.CreateTemporaryBody("Camp pet " + offer.Id, offer.Id, position);
                    if (offerBodies[i].GetComponent<GalaQuestWormMotion>() != null)
                    {
                        // Native art has a floor pivot. Seat it on the visible pad,
                        // not inside it at the underlying Camp ground height.
                        var pad = offerMarkers[i].GetComponent<Renderer>();
                        var seated = offerBodies[i].transform.position;
                        seated.y = pad.bounds.max.y;
                        offerBodies[i].transform.position = seated;
                    }
                }
            }
        }

        private void RefreshOfferVisuals()
        {
            var home = isActiveAndEnabled && session != null && !string.IsNullOrEmpty(session.PlayerId)
                && !session.IsTravelling && session.DestinationId == GalaQuestPetCatalog.CampDestinationId;
            if (home) EnsureOfferVisuals();
            for (var i = 0; i < GalaQuestPetCatalog.Offers.Length; i++)
            {
                var offer = GalaQuestPetCatalog.Offers[i];
                if (offerMarkers[i] != null) offerMarkers[i].SetActive(home);
                if (offerBodies[i] != null)
                    offerBodies[i].SetActive(home && state?.equippedPetId != offer.Id);
            }
        }

        private static GalaQuestServerPetState EmptyState() => new GalaQuestServerPetState
        {
            ownedPetIds = Array.Empty<string>(), equippedPetId = null, equipRev = -1
        };
        private static string ErrorText(string error)
        {
            if (error == "out-of-range") return "Move a little closer and try again";
            if (error == "stale-revision") return "Your worm changed state — try once more";
            return "That did not work yet — try again";
        }

        private void OnDestroy()
        {
            BindSession(null);
            for (var i = 0; i < offerBodies.Length; i++)
            {
                if (offerBodies[i] != null) Destroy(offerBodies[i]);
                if (offerMarkers[i] != null) Destroy(offerMarkers[i]);
            }
        }
    }

    internal static class GalaQuestPetVisuals
    {
        private static Material greenBody;
        private static Material redBody;
        private static Material greenMarker;
        private static Material redMarker;

        public static GameObject CreateTemporaryBody(string name, string petId, Vector3 position)
        {
            var body = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            body.name = name;
            body.transform.position = position;
            body.transform.localScale = new Vector3(.72f, .32f, 1.05f);
            var collider = body.GetComponent<Collider>();
            if (collider != null) UnityEngine.Object.Destroy(collider);
            var renderer = body.GetComponent<Renderer>();
            if (renderer != null) renderer.sharedMaterial = BodyMaterial(petId);
            return body;
        }

        public static GameObject CreateMarker(GalaQuestPetOffer offer, Vector3 position)
        {
            var marker = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            marker.name = "Worm resting spot " + offer.Id;
            marker.transform.position = position;
            marker.transform.localScale = new Vector3(.85f, .025f, .85f);
            var collider = marker.GetComponent<Collider>();
            if (collider != null) UnityEngine.Object.Destroy(collider);
            var renderer = marker.GetComponent<Renderer>();
            if (renderer != null) renderer.sharedMaterial = MarkerMaterial(offer.Id);
            return marker;
        }

        private static Material BodyMaterial(string petId)
        {
            if (petId == "worm_red")
                return redBody ??= Material("Worm red temp", new Color(.78f, .16f, .12f), .16f);
            return greenBody ??= Material("Worm green temp", new Color(.2f, .7f, .26f), .12f);
        }

        private static Material MarkerMaterial(string petId)
        {
            if (petId == "worm_red")
                return redMarker ??= Material("Worm red marker", new Color(.42f, .12f, .09f), .35f);
            return greenMarker ??= Material("Worm green marker", new Color(.11f, .38f, .16f), .28f);
        }
        private static Material Material(string name, Color color, float smoothness)
        {
            var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            if (shader == null) return null;
            var material = new Material(shader) { name = name, hideFlags = HideFlags.HideAndDontSave };
            material.SetColor("_BaseColor", color);
            material.color = color;
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", smoothness);
            if (material.HasProperty("_Metallic")) material.SetFloat("_Metallic", 0f);
            return material;
        }
    }
}
