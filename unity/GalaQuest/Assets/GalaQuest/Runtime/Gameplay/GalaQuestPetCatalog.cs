using System;

namespace GalaQuest
{
    /// <summary>
    /// Static mirror of public/src/progression/pets.js. Camp offers are authored design data, not
    /// server state: the server never sends the catalog, only which ids a profile owns and which
    /// one follows (the nested pets block on the per-profile rewards entry). Keeping it static is
    /// what lets the Camp presenter draw an offer before any pet-state has arrived.
    ///
    /// These literals are duplicated from the JavaScript on purpose and must be changed together.
    /// PetCatalogMirrorsServerConstants pins them so a one-sided edit fails a test.
    /// </summary>
    public static class GalaQuestPetCatalog
    {
        public const string CampDestinationId = "home-hub";
        public const float InteractionRadius = 3f;

        public static readonly GalaQuestPetOffer[] Offers =
        {
            new GalaQuestPetOffer("worm_green", "Green Worm", -3f, 1f),
            new GalaQuestPetOffer("worm_red", "Red Worm", 3f, 1f),
        };

        public static GalaQuestPetOffer Find(string petId)
        {
            foreach (var offer in Offers)
            {
                if (offer.Id == petId) return offer;
            }
            return null;
        }
    }

    [Serializable]
    public sealed class GalaQuestPetOffer
    {
        public GalaQuestPetOffer(string id, string displayName, float campX, float campZ)
        {
            Id = id;
            DisplayName = displayName;
            CampX = campX;
            CampZ = campZ;
        }

        public string Id { get; }
        public string DisplayName { get; }
        public float CampX { get; }
        public float CampZ { get; }
    }
}
