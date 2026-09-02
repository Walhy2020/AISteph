using System.Threading;
using System.Windows;

namespace AIStephVoice;

public partial class App : System.Windows.Application
{
    private const string MutexName = "Local\\AIStephVoice.App.v1";
    private const string ActivationEventName = "Local\\AIStephVoice.Activate.v1";
    private Mutex? instanceMutex;
    private bool ownsInstanceMutex;
    private EventWaitHandle? activationEvent;
    private CancellationTokenSource? activationCancellation;

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        var launchInBackground = e.Args.Any(argument =>
            string.Equals(argument, "--background", StringComparison.OrdinalIgnoreCase)
        );
        instanceMutex = new Mutex(true, MutexName, out var createdNew);
        ownsInstanceMutex = createdNew;
        if (!createdNew)
        {
            try
            {
                using var existingEvent = EventWaitHandle.OpenExisting(ActivationEventName);
                existingEvent.Set();
            }
            catch
            {
                // The first instance may still be finishing startup.
            }
            Shutdown();
            return;
        }

        activationEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ActivationEventName);
        activationCancellation = new CancellationTokenSource();

        try
        {
            await ServiceManager.EnsureRunningAsync();
            var window = new MainWindow();
            MainWindow = window;
            window.Show();
            ListenForActivation(window, activationCancellation.Token);
            await window.InitializeAsync();
            if (launchInBackground) window.Hide();
        }
        catch (Exception error)
        {
            System.Windows.MessageBox.Show(
                error.Message,
                "AISteph Voice 启动失败",
                MessageBoxButton.OK,
                MessageBoxImage.Error
            );
            Shutdown();
        }
    }

    private void ListenForActivation(MainWindow window, CancellationToken cancellationToken)
    {
        _ = Task.Run(() =>
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                if (activationEvent?.WaitOne(500) == true)
                {
                    Dispatcher.Invoke(window.ShowAndActivate);
                }
            }
        }, cancellationToken);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        activationCancellation?.Cancel();
        activationEvent?.Dispose();
        if (ownsInstanceMutex) instanceMutex?.ReleaseMutex();
        instanceMutex?.Dispose();
        base.OnExit(e);
    }
}