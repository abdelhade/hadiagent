# Windows Print Agent - Health Endpoint Implementation Guide

## Overview
هذا الدليل يوضح كيفية إضافة `/health` endpoint للـ Windows Print Agent الحالي.

## Security Requirements
- يجب أن يعمل الـ Agent على `127.0.0.1` فقط (localhost)
- لا يجب أن يكون متاحاً من الشبكة الخارجية

## Health Endpoint Specification

### Endpoint: `GET /health`

### Response Format (JSON):
```json
{
  "status": "healthy",
  "uptime_seconds": 3600,
  "uptime_formatted": "1h 0m 0s",
  "printers": [
    {
      "name": "Kitchen Printer 1",
      "status": "ready",
      "is_default": false
    },
    {
      "name": "Bar Printer",
      "status": "ready",
      "is_default": false
    }
  ],
  "recent_requests": [
    {
      "timestamp": "2026-02-25T10:30:00Z",
      "printer": "Kitchen Printer 1",
      "status": "success",
      "duration_ms": 150
    },
    {
      "timestamp": "2026-02-25T10:29:45Z",
      "printer": "Bar Printer",
      "status": "success",
      "duration_ms": 120
    }
  ],
  "stats": {
    "total_requests": 1250,
    "successful_requests": 1245,
    "failed_requests": 5,
    "success_rate": 99.6
  },
  "version": "1.0.0",
  "checked_at": "2026-02-25T10:30:15Z"
}
```

## Implementation Steps

### 1. Add Health Endpoint to Existing C# Agent

في الـ `Program.cs` أو الملف الرئيسي للـ Agent، أضف:

```csharp
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing.Printing;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading;

public class PrintAgentHealth
{
    private static DateTime startTime = DateTime.UtcNow;
    private static List<RequestLog> recentRequests = new List<RequestLog>();
    private static int totalRequests = 0;
    private static int successfulRequests = 0;
    private static int failedRequests = 0;
    private static readonly int maxRecentRequests = 50;
    private static readonly object lockObject = new object();

    public class RequestLog
    {
        public DateTime Timestamp { get; set; }
        public string Printer { get; set; }
        public string Status { get; set; }
        public long DurationMs { get; set; }
    }

    public static void LogRequest(string printer, bool success, long durationMs)
    {
        lock (lockObject)
        {
            totalRequests++;
            if (success)
                successfulRequests++;
            else
                failedRequests++;

            recentRequests.Add(new RequestLog
            {
                Timestamp = DateTime.UtcNow,
                Printer = printer,
                Status = success ? "success" : "failed",
                DurationMs = durationMs
            });

            // Keep only last N requests
            if (recentRequests.Count > maxRecentRequests)
            {
                recentRequests.RemoveAt(0);
            }
        }
    }

    public static string GetHealthJson()
    {
        lock (lockObject)
        {
            var uptime = DateTime.UtcNow - startTime;
            var printers = GetInstalledPrinters();

            var health = new
            {
                status = "healthy",
                uptime_seconds = (int)uptime.TotalSeconds,
                uptime_formatted = FormatUptime(uptime),
                printers = printers,
                recent_requests = recentRequests.TakeLast(10).Select(r => new
                {
                    timestamp = r.Timestamp.ToString("yyyy-MM-ddTHH:mm:ssZ"),
                    printer = r.Printer,
                    status = r.Status,
                    duration_ms = r.DurationMs
                }),
                stats = new
                {
                    total_requests = totalRequests,
                    successful_requests = successfulRequests,
                    failed_requests = failedRequests,
                    success_rate = totalRequests > 0 
                        ? Math.Round((double)successfulRequests / totalRequests * 100, 2) 
                        : 100.0
                },
                version = "1.0.0",
                checked_at = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
            };

            return JsonSerializer.Serialize(health, new JsonSerializerOptions 
            { 
                WriteIndented = true 
            });
        }
    }

    private static List<object> GetInstalledPrinters()
    {
        var printers = new List<object>();
        
        foreach (string printerName in PrinterSettings.InstalledPrinters)
        {
            try
            {
                var ps = new PrinterSettings { PrinterName = printerName };
                printers.Add(new
                {
                    name = printerName,
                    status = ps.IsValid ? "ready" : "error",
                    is_default = ps.IsDefaultPrinter
                });
            }
            catch
            {
                printers.Add(new
                {
                    name = printerName,
                    status = "error",
                    is_default = false
                });
            }
        }

        return printers;
    }

    private static string FormatUptime(TimeSpan uptime)
    {
        if (uptime.TotalDays >= 1)
            return $"{(int)uptime.TotalDays}d {uptime.Hours}h {uptime.Minutes}m";
        if (uptime.TotalHours >= 1)
            return $"{(int)uptime.TotalHours}h {uptime.Minutes}m {uptime.Seconds}s";
        if (uptime.TotalMinutes >= 1)
            return $"{(int)uptime.TotalMinutes}m {uptime.Seconds}s";
        return $"{uptime.Seconds}s";
    }
}
```

### 2. Update HTTP Listener to Handle /health

في الـ HTTP listener الحالي، أضف:

```csharp
public static void HandleRequest(HttpListenerContext context)
{
    var request = context.Request;
    var response = context.Response;

    // Set CORS headers
    response.Headers.Add("Access-Control-Allow-Origin", "*");
    response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.Headers.Add("Access-Control-Allow-Headers", "Content-Type");

    try
    {
        // Handle OPTIONS (preflight)
        if (request.HttpMethod == "OPTIONS")
        {
            response.StatusCode = 200;
            response.Close();
            return;
        }

        // Handle /health endpoint
        if (request.HttpMethod == "GET" && request.Url.AbsolutePath == "/health")
        {
            var healthJson = PrintAgentHealth.GetHealthJson();
            var buffer = Encoding.UTF8.GetBytes(healthJson);
            
            response.ContentType = "application/json";
            response.ContentLength64 = buffer.Length;
            response.StatusCode = 200;
            response.OutputStream.Write(buffer, 0, buffer.Length);
            response.Close();
            return;
        }

        // Handle /print endpoint (existing code)
        if (request.HttpMethod == "POST" && request.Url.AbsolutePath == "/print")
        {
            var stopwatch = Stopwatch.StartNew();
            
            // ... existing print logic ...
            
            stopwatch.Stop();
            PrintAgentHealth.LogRequest(printerName, success, stopwatch.ElapsedMilliseconds);
            
            // ... rest of existing code ...
        }

        // 404 for unknown endpoints
        response.StatusCode = 404;
        response.Close();
    }
    catch (Exception ex)
    {
        response.StatusCode = 500;
        var errorJson = JsonSerializer.Serialize(new { error = ex.Message });
        var buffer = Encoding.UTF8.GetBytes(errorJson);
        response.OutputStream.Write(buffer, 0, buffer.Length);
        response.Close();
    }
}
```

### 3. Ensure Localhost-Only Binding

في الـ `Main` method:

```csharp
static void Main(string[] args)
{
    // IMPORTANT: Bind to 127.0.0.1 only (not 0.0.0.0 or *)
    var listener = new HttpListener();
    listener.Prefixes.Add("http://127.0.0.1:5000/");
    
    Console.WriteLine("Print Agent starting on http://127.0.0.1:5000");
    Console.WriteLine("Health endpoint: http://127.0.0.1:5000/health");
    Console.WriteLine("Print endpoint: http://127.0.0.1:5000/print");
    
    listener.Start();
    
    while (true)
    {
        var context = listener.GetContext();
        ThreadPool.QueueUserWorkItem(_ => HandleRequest(context));
    }
}
```

## Testing

### Test Health Endpoint:
```bash
curl http://127.0.0.1:5000/health
```

### Expected Response:
```json
{
  "status": "healthy",
  "uptime_seconds": 120,
  "uptime_formatted": "2m 0s",
  "printers": [
    {
      "name": "Microsoft Print to PDF",
      "status": "ready",
      "is_default": true
    }
  ],
  "recent_requests": [],
  "stats": {
    "total_requests": 0,
    "successful_requests": 0,
    "failed_requests": 0,
    "success_rate": 100
  },
  "version": "1.0.0",
  "checked_at": "2026-02-25T10:30:15Z"
}
```

## Laravel Integration

في Laravel، استخدم:

```php
$response = Http::timeout(2)->get('http://127.0.0.1:5000/health');

if ($response->successful()) {
    $health = $response->json();
    // Process health data
}
```

## Security Notes

1. ✅ Agent يعمل على `127.0.0.1` فقط
2. ✅ لا يمكن الوصول له من الشبكة الخارجية
3. ✅ لا يحتاج authentication (لأنه localhost only)
4. ⚠️ لا تستخدم `0.0.0.0` أو `*` في الـ binding

## Monitoring Integration

Laravel سيستخدم `/health` endpoint كل دقيقة للتحقق من:
- Agent uptime
- قائمة الطابعات المتاحة
- آخر N طلبات
- معدل النجاح

هذا يساعد في تحقيق هدف "Mean time to detect agent down: < 2 minutes".
