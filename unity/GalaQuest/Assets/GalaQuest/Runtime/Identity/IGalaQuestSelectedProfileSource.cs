using System;

namespace GalaQuest
{
    public interface IGalaQuestSelectedProfileSource
    {
        event Action<GalaQuestSelectedProfile> Selected;
        event Action<string> Failed;
        void ReadSelected();
    }
}
