<?php
declare(strict_types=1);

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

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, ['error' => 'Method not allowed']);
}

$builderRoot = dirname(__DIR__, 3) . '/rasika-builder';
$environmentSecret = getenv('RASIKA_UPLOAD_TOKEN');
$secretCandidates = [
    is_string($environmentSecret) ? trim($environmentSecret) : '',
    is_readable($builderRoot . '/upload-secret')
        ? trim((string) file_get_contents($builderRoot . '/upload-secret'))
        : '',
    is_readable($builderRoot . '/hook-secret')
        ? trim((string) file_get_contents($builderRoot . '/hook-secret'))
        : '',
];
$configuredSecret = '';
foreach ($secretCandidates as $candidate) {
    if ($candidate !== '') {
        $configuredSecret = $candidate;
        break;
    }
}

if ($configuredSecret === '') {
    respond(503, ['error' => 'Upload service is not configured']);
}

$providedSecret = trim((string) ($_SERVER['HTTP_X_UPLOAD_TOKEN'] ?? ''));
if ($providedSecret === '' || !hash_equals($configuredSecret, $providedSecret)) {
    respond(401, ['error' => 'Unauthorized']);
}

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
