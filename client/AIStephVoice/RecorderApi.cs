using System.Net.Http;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace AIStephVoice;

internal static class RecorderApi
{
    private static readonly HttpClient Client = new() { Timeout = TimeSpan.FromSeconds(8) };
    private static readonly Regex TokenPattern = new(
        "name=\"aisteph-token\" content=\"([^\"]+)\"",
        RegexOptions.Compiled
    );

    public static async Task<RecorderToggleResult> ToggleAsync()
    {
        using var document = await SendAsync(HttpMethod.Post, "/api/recorder/toggle");
        var root = document.RootElement;
        var action = root.GetProperty("action").GetString() ?? "unknown";
        string? deviceName = null;
        if (root.TryGetProperty("status", out var status)
            && status.TryGetProperty("deviceName", out var device))
        {
            deviceName = device.GetString();
        }
        return new RecorderToggleResult(action, deviceName);
    }

    public static async Task<string> GetStateAsync()
    {
        using var document = await SendAsync(HttpMethod.Get, "/api/recorder/status");
        return document.RootElement.GetProperty("state").GetString() ?? "unknown";
    }

    private static async Task<JsonDocument> SendAsync(HttpMethod method, string path)
    {
        var html = await Client.GetStringAsync(ServiceManager.Origin + "/");
        var tokenMatch = TokenPattern.Match(html);
        if (!tokenMatch.Success)
        {
            throw new InvalidOperationException("无法读取 AISteph Voice 本地服务令牌。");
        }

        using var request = new HttpRequestMessage(method, ServiceManager.Origin + path);
        request.Headers.TryAddWithoutValidation("X-AISteph-Token", tokenMatch.Groups[1].Value);
        request.Headers.TryAddWithoutValidation("Origin", ServiceManager.Origin);
        if (method == HttpMethod.Post) request.Content = new ByteArrayContent([]);

        using var response = await Client.SendAsync(request);
        var body = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode)
        {
            try
            {
                using var errorDocument = JsonDocument.Parse(body);
                if (errorDocument.RootElement.TryGetProperty("error", out var error))
                {
                    throw new InvalidOperationException(error.GetString() ?? "录音请求失败。");
                }
            }
            catch (JsonException)
            {
                // Fall through to the status-code based message.
            }
            throw new InvalidOperationException($"录音请求失败（{(int)response.StatusCode}）。");
        }
        return JsonDocument.Parse(body);
    }
}

internal sealed record RecorderToggleResult(string Action, string? DeviceName);