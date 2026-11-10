# PHP receiver for LumoAuth webhooks

A receiver with the standard library only. It has the same behaviour as the TypeScript
function in `SKILL.md`: parse `X-LumoAuth-Signature`, check the timestamp, compute
HMAC-SHA256 over `<t>.<id>.<raw body>`, compare in constant time against every configured
secret, then parse the JSON. The code was run against the test vector in `test-vector.md`
and against a local HTTP request.

`lumoauth_webhook.php`:

```php
<?php

declare(strict_types=1);

final class WebhookVerificationException extends RuntimeException
{
}

/**
 * Verifies the X-LumoAuth-Signature header of one delivery.
 * $rawBody must be the request body exactly as received.
 *
 * @param list<string> $secrets
 * @return array{delivery_id: string, signed_at: int, event: string, tenant: string, data: array<string, mixed>}
 */
function verify_lumoauth_webhook(string $rawBody, ?string $signatureHeader, array $secrets, int $toleranceSeconds = 300, ?int $now = null): array
{
    if ($secrets === []) {
        throw new WebhookVerificationException('no signing secret configured');
    }
    if ($signatureHeader === null || $signatureHeader === '') {
        throw new WebhookVerificationException('missing X-LumoAuth-Signature header');
    }

    // Header format: kid=v1,t=<unix seconds>,id=<delivery id>,v1=<hex HMAC-SHA256>
    $fields = [];
    foreach (explode(',', $signatureHeader) as $part) {
        $pair = explode('=', $part, 2);
        if (count($pair) === 2) {
            $fields[trim($pair[0])] = trim($pair[1]);
        }
    }
    $t = $fields['t'] ?? '';
    $id = $fields['id'] ?? '';
    $v1 = $fields['v1'] ?? '';
    if (preg_match('/^[0-9]{1,12}$/', $t) !== 1 || $id === '' || preg_match('/^[0-9a-f]{64}$/', $v1) !== 1) {
        throw new WebhookVerificationException('malformed X-LumoAuth-Signature header');
    }

    $signedAt = (int) $t;
    if (abs(($now ?? time()) - $signedAt) > $toleranceSeconds) {
        throw new WebhookVerificationException('timestamp outside the tolerance window');
    }

    // Signed payload: "<t>.<id>." followed by the raw body bytes.
    $signedPayload = $t . '.' . $id . '.' . $rawBody;
    $valid = false;
    foreach ($secrets as $secret) {
        if (hash_equals(hash_hmac('sha256', $signedPayload, $secret), $v1)) {
            $valid = true;
        }
    }
    if (!$valid) {
        throw new WebhookVerificationException('signature mismatch');
    }

    try {
        $envelope = json_decode($rawBody, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException $e) {
        throw new WebhookVerificationException('body is not JSON', 0, $e);
    }

    return [
        'delivery_id' => $id,
        'signed_at' => $signedAt,
        'event' => (string) ($envelope['event'] ?? ''),
        'tenant' => (string) ($envelope['tenant'] ?? ''),
        'data' => is_array($envelope['data'] ?? null) ? $envelope['data'] : [],
    ];
}
```

`webhook.php`, the endpoint script. PHP has no worker in the request, so this example
stores each verified delivery in a spool directory and a separate process (a cron job or a
queue worker) reads it. Replace the spool with the application's queue.

```php
<?php

declare(strict_types=1);

require __DIR__ . '/lumoauth_webhook.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    exit;
}

// Current secret first. Keep the previous secret only while a rotation is in progress.
$secrets = array_values(array_filter([
    getenv('LUMOAUTH_WEBHOOK_SECRET') ?: null,
    getenv('LUMOAUTH_WEBHOOK_SECRET_PREVIOUS') ?: null,
]));

$rawBody = file_get_contents('php://input', false, null, 0, 1048576);
if ($rawBody === false) {
    http_response_code(400);
    exit;
}

try {
    $delivery = verify_lumoauth_webhook($rawBody, $_SERVER['HTTP_X_LUMOAUTH_SIGNATURE'] ?? null, $secrets);
} catch (WebhookVerificationException $e) {
    http_response_code(401);
    exit;
}

// Replace this file spool with the application's queue or database in production.
// The delivery ID is the file name, so a repeated delivery is stored once.
$spoolDir = getenv('LUMOAUTH_WEBHOOK_SPOOL_DIR') ?: sys_get_temp_dir() . '/lumoauth-webhooks';
if (!is_dir($spoolDir) && !mkdir($spoolDir, 0700, true) && !is_dir($spoolDir)) {
    http_response_code(500);
    exit;
}
if (preg_match('/^[A-Za-z0-9_-]{1,128}$/', $delivery['delivery_id']) !== 1) {
    http_response_code(400);
    exit;
}
$handle = @fopen($spoolDir . '/' . $delivery['delivery_id'] . '.json', 'x'); // "x" fails when the file exists
if ($handle !== false) {
    fwrite($handle, json_encode($delivery, JSON_THROW_ON_ERROR));
    fclose($handle);
}

http_response_code(200);
header('Content-Type: application/json');
echo '{"received":true}';
```

In Laravel or Symfony, pass `$request->getContent()` and
`$request->headers->get('X-LumoAuth-Signature')` to `verify_lumoauth_webhook()`. In Laravel,
exclude the route from CSRF verification: the request comes from LumoAuth, not from a
browser form.

## Notes

- The secret is used as a UTF-8 string. Do not decode it.
- `v1` is lower-case hexadecimal, 64 characters.
- The comparison loop checks every configured secret and does not stop at the first match.
- Replace the in-memory or file-based deduplication with shared, durable storage before
  production, and keep delivery IDs for at least two days.
- Answer within 5 seconds. Queue the event; process it in a worker.
