using System;

namespace GalaQuest
{
    public interface IGalaQuestTransport
    {
        event Action Opened;
        event Action<string> MessageReceived;
        event Action<string> Closed;
        void Connect();
        bool Send(string message);
        void Close();
    }
}
