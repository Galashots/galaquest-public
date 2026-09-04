namespace GalaQuest.Gear
{
    public enum GearFitSeverity
    {
        Warning = 0,
        Rejection = 1,
    }

    /// <summary>One machine finding about a mounted item. Findings REJECT; they never visually accept.</summary>
    public readonly struct GearFitIssue
    {
        public readonly GearFitSeverity Severity;
        public readonly string Code;
        public readonly string Message;

        public GearFitIssue(GearFitSeverity severity, string code, string message)
        {
            Severity = severity;
            Code = code;
            Message = message;
        }

        public override string ToString() => $"[{Severity}] {Code}: {Message}";
    }

    public static class GearFitIssueCodes
    {
        public const string MissingDefinition = "missing-definition";
        public const string MissingModel = "missing-model";
        public const string MissingSocket = "missing-socket";
        public const string InvalidTransform = "invalid-transform";
        public const string AbsurdScale = "absurd-scale";
        public const string MissingProxy = "missing-proxy";
        public const string EyeLineOccluded = "eye-line-occluded";
        public const string FloatsAboveCrown = "floats-above-crown";
        public const string DoesNotRead = "does-not-read";
        public const string UndeclaredCoverage = "undeclared-coverage";
        public const string AnchorDiscontinuity = "anchor-discontinuity";
    }
}
