using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Text.Json;

namespace AIStephVoice;

internal static class UpdateService
{
    private const string LatestReleaseApi = "https://api.github.com/repos/Walhy2020/AISteph/releases/latest";
    private static readonly HttpClient Client = CreateClient();

    public static Version CurrentVersion => Assembly.GetExecutingAssembly().GetName().Version
        ?? new Version(0, 0, 0);

    public static async Task<UpdateCheckResult> CheckAsync()
    {
        using var response = await Client.GetAsync(LatestReleaseApi);
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return new UpdateCheckResult(CurrentVersion, null, null);
        }
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;
        var tag = root.GetProperty("tag_name").GetString()?.Trim().TrimStart('v', 'V');
        var releaseUrl = root.GetProperty("html_url").GetString();
        if (!Version.TryParse(tag, out var latestVersion))
        {
            throw new InvalidOperationException("GitHub Release 的版本号格式无法识别。");
        }
        return new UpdateCheckResult(CurrentVersion, latestVersion, releaseUrl);
    }

    public static void OpenRelease(UpdateCheckResult result)
    {
        if (string.IsNullOrWhiteSpace(result.ReleaseUrl)) return;
        Process.Start(new ProcessStartInfo(result.ReleaseUrl) { UseShellExecute = true });
    }

    private static HttpClient CreateClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd($"AIStephVoice/{CurrentVersion.ToString(3)}");
        client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return client;
    }
}

internal sealed record UpdateCheckResult(Version CurrentVersion, Version? LatestVersion, string? ReleaseUrl)
{
    public bool HasUpdate => LatestVersion is not null && LatestVersion > CurrentVersion;
};