using System.Runtime.InteropServices;

namespace GalaQuest
{
    internal static class GalaQuestBrowserInterop
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")]
        private static extern void GQ_Profile_ReadSelected(string gameObject, string callback);

        [DllImport("__Internal")]
        private static extern int GQ_WebSocket_Connect(
            string gameObject,
            string openCallback,
            string messageCallback,
            string closeCallback);

        [DllImport("__Internal")]
        private static extern int GQ_WebSocket_Send(int connectionId, string message);

        [DllImport("__Internal")]
        private static extern void GQ_WebSocket_Close(int connectionId);

        [DllImport("__Internal")]
        private static extern void GQ_Diagnostics_RecordMovement(
            float predictedX,
            float predictedZ,
            float authoritativeX,
            float authoritativeZ,
            float drift,
            int snapped);

        [DllImport("__Internal")]
        private static extern void GQ_Touch_ConfigureSurface();
#endif

        public static void ReadSelectedProfile(string gameObject, string callback)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            GQ_Profile_ReadSelected(gameObject, callback);
#endif
        }

        public static int ConnectWebSocket(
            string gameObject,
            string openCallback,
            string messageCallback,
            string closeCallback)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            return GQ_WebSocket_Connect(gameObject, openCallback, messageCallback, closeCallback);
#else
            return 0;
#endif
        }

        public static bool SendWebSocket(int connectionId, string message)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            return GQ_WebSocket_Send(connectionId, message) == 1;
#else
            return false;
#endif
        }

        public static void CloseWebSocket(int connectionId)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            GQ_WebSocket_Close(connectionId);
#endif
        }

        public static void RecordMovement(
            float predictedX,
            float predictedZ,
            float authoritativeX,
            float authoritativeZ,
            float drift,
            bool snapped)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            GQ_Diagnostics_RecordMovement(
                predictedX,
                predictedZ,
                authoritativeX,
                authoritativeZ,
                drift,
                snapped ? 1 : 0);
#endif
        }

        public static void ConfigureTouchSurface()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            GQ_Touch_ConfigureSurface();
#endif
        }
    }
}
