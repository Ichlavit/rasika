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

function authorizeAdminSession(string $sessionToken, string $builderRoot): void
{
    $environment = loadEnvironmentValues(
        $builderRoot . '/.env.production',
        ['PUBLIC_SUPABASE_URL', 'PUBLIC_SUPABASE_ANON_KEY']
    );
    $supabaseUrlFromEnvironment = getenv('PUBLIC_SUPABASE_URL');
    $anonKeyFromEnvironment = getenv('PUBLIC_SUPABASE_ANON_KEY');
    $supabaseUrl = rtrim(trim(is_string($supabaseUrlFromEnvironment)
        ? $supabaseUrlFromEnvironment
        : (string) ($environment['PUBLIC_SUPABASE_URL'] ?? '')), '/');
    $anonKey = trim(is_string($anonKeyFromEnvironment)
        ? $anonKeyFromEnvironment
        : (string) ($environment['PUBLIC_SUPABASE_ANON_KEY'] ?? ''));

    $host = (string) parse_url($supabaseUrl, PHP_URL_HOST);
    if (
        $supabaseUrl === '' ||
        $anonKey === '' ||
        !preg_match('/^[a-z0-9-]+\.supabase\.co$/i', $host)
    ) {
        respond(503, ['error' => 'Upload authorization is not configured']);
    }
    if (!function_exists('curl_init')) {
        respond(503, ['error' => 'Upload authorization transport is unavailable']);
    }

    // marketing-admin verifies both the Supabase session and ai_radar_admins
    // membership before resolving the requested resource.
    $request = curl_init($supabaseUrl . '/functions/v1/marketing-admin?resource=cms_upload_authorize');
    if ($request === false) {
        respond(503, ['error' => 'Unable to initialize upload authorization']);
    }

    curl_setopt_array($request, [
        CURLOPT_HTTPGET => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 12,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $sessionToken,
            'apikey: ' . $anonKey,
            'Content-Type: application/json',
        ],
    ]);
    $responseBody = curl_exec($request);
    $status = (int) curl_getinfo($request, CURLINFO_RESPONSE_CODE);
    $curlError = curl_error($request);
    curl_close($request);

    if ($responseBody === false || $curlError !== '') {
        error_log('Rasika upload authorization request failed: ' . $curlError);
        respond(502, ['error' => 'Unable to verify the administrator session']);
    }

    $payload = json_decode((string) $responseBody, true);
    if ($status === 401) {
        respond(401, ['error' => 'Administrator session expired']);
    }
    if ($status === 403) {
        respond(403, ['error' => 'Administrator access required']);
    }
    if (
        $status === 404 &&
        is_array($payload) &&
        ($payload['error'] ?? '') === 'Unknown resource'
    ) {
        return;
    }
    if ($status < 200 || $status >= 300) {
        error_log('Rasika upload authorization returned HTTP ' . $status);
        respond(502, ['error' => 'Unable to verify upload authorization']);
    }
    respond(502, ['error' => 'Upload authorization returned an unexpected response']);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, ['error' => 'Method not allowed']);
}

$builderRoot = dirname(__DIR__, 3) . '/rasika-builder';
$sessionToken = trim((string) ($_SERVER['HTTP_X_UPLOAD_SESSION'] ?? ''));
if ($sessionToken === '' || substr_count($sessionToken, '.') !== 2) {
    respond(401, ['error' => 'Administrator session required']);
}
authorizeAdminSession($sessionToken, $builderRoot);

$requestedPath = strtolower(trim((string) ($_SERVER['HTTP_X_UPLOAD_PATH'] ?? '')));
$destinations = [
    'blog' => [
        'directory' => __DIR__ . '/images/blog',
        'public_path' => '/images/blog',
    ],
];
if (!array_key_exists($requestedPath, $destinations)) {
    respond(400, ['error' => 'Invalid upload path']);
}

if (!isset($_FILES['file']) || !is_array($_FILES['file'])) {
    respond(400, ['error' => 'No image was provided']);
}

$file = $_FILES['file'];
$uploadError = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
if ($uploadError !== UPLOAD_ERR_OK) {
    $messages = [
        UPLOAD_ERR_INI_SIZE => 'The image exceeds the server upload limit',
        UPLOAD_ERR_FORM_SIZE => 'The image exceeds the form upload limit',
        UPLOAD_ERR_PARTIAL => 'The image upload was incomplete',
        UPLOAD_ERR_NO_FILE => 'No image was provided',
        UPLOAD_ERR_NO_TMP_DIR => 'The upload temporary directory is unavailable',
        UPLOAD_ERR_CANT_WRITE => 'The server could not write the uploaded image',
        UPLOAD_ERR_EXTENSION => 'A server extension stopped the upload',
    ];
    respond(400, ['error' => $messages[$uploadError] ?? 'The image upload failed']);
}

$temporaryPath = (string) ($file['tmp_name'] ?? '');
$fileSize = (int) ($file['size'] ?? 0);
$maxBytes = 8 * 1024 * 1024;
if ($temporaryPath === '' || !is_uploaded_file($temporaryPath)) {
    respond(400, ['error' => 'Invalid uploaded file']);
}
if ($fileSize < 1 || $fileSize > $maxBytes) {
    respond(413, ['error' => 'Images must be between 1 byte and 8 MB']);
}

$finfo = new finfo(FILEINFO_MIME_TYPE);
$mimeType = (string) $finfo->file($temporaryPath);
$allowedMimeTypes = [
    'image/jpeg' => 'jpg',
    'image/png' => 'png',
    'image/webp' => 'webp',
    'image/gif' => 'gif',
    'image/avif' => 'avif',
];
if (!array_key_exists($mimeType, $allowedMimeTypes)) {
    respond(415, ['error' => 'Unsupported image type']);
}

$destination = $destinations[$requestedPath];
$directory = $destination['directory'];
if (!is_dir($directory) && !mkdir($directory, 0755, true) && !is_dir($directory)) {
    respond(500, ['error' => 'Unable to create the image directory']);
}
if (!is_writable($directory)) {
    respond(500, ['error' => 'The image directory is not writable']);
}

try {
    $filename = sprintf(
        '%s-%s.%s',
        gmdate('Ymd-His'),
        bin2hex(random_bytes(10)),
        $allowedMimeTypes[$mimeType],
    );
} catch (Throwable $error) {
    error_log('Rasika upload filename generation failed: ' . $error->getMessage());
    respond(500, ['error' => 'Unable to prepare the image upload']);
}

$destinationPath = $directory . '/' . $filename;
if (!move_uploaded_file($temporaryPath, $destinationPath)) {
    respond(500, ['error' => 'Unable to save the uploaded image']);
}
chmod($destinationPath, 0644);

respond(201, [
    'success' => true,
    'url' => $destination['public_path'] . '/' . $filename,
    'mime_type' => $mimeType,
    'size' => $fileSize,
]);
