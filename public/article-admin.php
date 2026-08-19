<?php
declare(strict_types=1);

ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");

function respond(int $status, array $payload): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function loadEnvironmentValues(string $path, array $allowedKeys): array
{
    if (!is_readable($path)) {
        return [];
    }

    $values = [];
    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if (!is_array($lines)) {
        return [];
    }

    foreach ($lines as $line) {
        $line = trim((string) $line);
        if ($line === '' || strpos($line, '#') === 0) {
            continue;
        }
        $separator = strpos($line, '=');
        if ($separator === false) {
            continue;
        }
        $key = trim(substr($line, 0, $separator));
        if (!in_array($key, $allowedKeys, true)) {
            continue;
        }
        $value = trim(substr($line, $separator + 1));
        $length = strlen($value);
        if ($length >= 2) {
            $first = $value[0];
            $last = $value[$length - 1];
            if (($first === '"' && $last === '"') || ($first === "'" && $last === "'")) {
                $value = substr($value, 1, -1);
            }
        }
        $values[$key] = $value;
    }
    return $values;
}

function requestJson(string $url, string $method, array $headers, ?array $body = null): array
{
    $request = curl_init($url);
    if ($request === false) {
        return ['status' => 0, 'payload' => null, 'error' => 'Unable to initialize request'];
    }
    $options = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
    ];
    if ($body !== null) {
        $options[CURLOPT_POSTFIELDS] = json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
    curl_setopt_array($request, $options);
    $responseBody = curl_exec($request);
    $status = (int) curl_getinfo($request, CURLINFO_RESPONSE_CODE);
    $error = curl_error($request);
    curl_close($request);
    return [
        'status' => $status,
        'payload' => is_string($responseBody) ? json_decode($responseBody, true) : null,
        'error' => $error,
    ];
}

function authorizeAdminSession(string $sessionToken, string $supabaseUrl, string $anonKey): void
{
    $authorization = requestJson(
        $supabaseUrl . '/functions/v1/marketing-admin?resource=cms_article_authorize',
        'GET',
        [
            'Authorization: Bearer ' . $sessionToken,
            'apikey: ' . $anonKey,
            'Content-Type: application/json',
        ]
    );
    if ($authorization['error'] !== '') {
        error_log('Rasika article authorization failed: ' . $authorization['error']);
        respond(502, ['error' => 'Unable to verify the administrator session']);
    }
    if ($authorization['status'] === 401) {
        respond(401, ['error' => 'Administrator session expired']);
    }
    if ($authorization['status'] === 403) {
        respond(403, ['error' => 'Administrator access required']);
    }
    if ($authorization['status'] === 404 && ($authorization['payload']['error'] ?? '') === 'Unknown resource') {
        return;
    }
    if ($authorization['status'] >= 200 && $authorization['status'] < 300) {
        return;
    }
    respond(502, ['error' => 'Unable to verify article authorization']);
}

function requiredText(array $payload, string $field, int $maxLength): string
{
    $value = trim((string) ($payload[$field] ?? ''));
    if ($value === '' || strlen($value) > $maxLength) {
        respond(400, ['error' => 'Invalid ' . $field]);
    }
    return $value;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, ['error' => 'Method not allowed']);
}
if (!function_exists('curl_init')) {
    respond(503, ['error' => 'Article administration transport is unavailable']);
}

$builderRoot = dirname(__DIR__, 3) . '/rasika-builder';
$environment = loadEnvironmentValues(
    $builderRoot . '/.env.production',
    ['PUBLIC_SUPABASE_URL', 'PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
);
$supabaseUrl = rtrim(trim((string) ($environment['PUBLIC_SUPABASE_URL'] ?? '')), '/');
$anonKey = trim((string) ($environment['PUBLIC_SUPABASE_ANON_KEY'] ?? ''));
$serviceRoleKey = trim((string) ($environment['SUPABASE_SERVICE_ROLE_KEY'] ?? ''));
$supabaseHost = (string) parse_url($supabaseUrl, PHP_URL_HOST);
if (
    $supabaseUrl === '' ||
    $anonKey === '' ||
    $serviceRoleKey === '' ||
    !preg_match('/^[a-z0-9-]+\.supabase\.co$/i', $supabaseHost)
) {
    respond(503, ['error' => 'Article administration is not configured']);
}

$sessionToken = trim((string) ($_SERVER['HTTP_X_ADMIN_SESSION'] ?? ''));
if ($sessionToken === '' || substr_count($sessionToken, '.') !== 2) {
    respond(401, ['error' => 'Administrator session required']);
}
authorizeAdminSession($sessionToken, $supabaseUrl, $anonKey);

$rawBody = file_get_contents('php://input');
if (!is_string($rawBody) || strlen($rawBody) > 150000) {
    respond(413, ['error' => 'Article payload is too large']);
}
$payload = json_decode($rawBody, true);
if (!is_array($payload)) {
    respond(400, ['error' => 'Invalid JSON']);
}

$articleId = requiredText($payload, 'article_id', 36);
if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $articleId)) {
    respond(400, ['error' => 'Invalid article id']);
}
if (($payload['locale'] ?? '') !== 'en') {
    respond(400, ['error' => 'Unsupported locale']);
}

$title = requiredText($payload, 'title', 240);
$slug = requiredText($payload, 'slug', 120);
$excerpt = requiredText($payload, 'excerpt', 500);
$contentHtml = requiredText($payload, 'content_html', 120000);
if (!preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $slug)) {
    respond(400, ['error' => 'Invalid translation slug']);
}

$serviceHeaders = [
    'Authorization: Bearer ' . $serviceRoleKey,
    'apikey: ' . $serviceRoleKey,
    'Content-Type: application/json',
];
$sourceResult = requestJson(
    $supabaseUrl . '/rest/v1/blog_posts?id=eq.' . rawurlencode($articleId) . '&select=id,title,slug,excerpt,content_html,published_at&limit=1',
    'GET',
    $serviceHeaders
);
$source = is_array($sourceResult['payload']) ? ($sourceResult['payload'][0] ?? null) : null;
if ($sourceResult['status'] < 200 || $sourceResult['status'] >= 300 || !is_array($source)) {
    respond(404, ['error' => 'Source article not found']);
}

$translation = [
    'blog_post_id' => $articleId,
    'locale' => 'en',
    'title' => $title,
    'slug' => $slug,
    'excerpt' => $excerpt,
    'content_html' => $contentHtml,
    'status' => 'published',
    'source_title' => (string) $source['title'],
    'source_slug' => (string) $source['slug'],
    'source_excerpt' => (string) $source['excerpt'],
    'source_hash' => hash('sha256', implode("\n\n", [
        (string) $source['title'],
        (string) $source['excerpt'],
        (string) $source['content_html'],
    ])),
    'generated_by' => 'cms-human',
    'translated_at' => gmdate('c'),
    'published_at' => (string) ($source['published_at'] ?? gmdate('c')),
];
$saveResult = requestJson(
    $supabaseUrl . '/rest/v1/blog_post_translations?on_conflict=blog_post_id,locale',
    'POST',
    array_merge($serviceHeaders, ['Prefer: resolution=merge-duplicates,return=representation']),
    $translation
);
if ($saveResult['status'] < 200 || $saveResult['status'] >= 300) {
    error_log('Rasika English article save failed with HTTP ' . $saveResult['status']);
    respond(502, ['error' => 'Unable to save the English edition']);
}

$saved = is_array($saveResult['payload']) ? ($saveResult['payload'][0] ?? $translation) : $translation;
respond(200, ['success' => true, 'article_id' => $articleId, 'translation' => $saved]);
