<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$builderRoot = dirname(__DIR__, 3) . '/rasika-builder';
$secretPath = $builderRoot . '/hook-secret';
$deployScript = $builderRoot . '/deploy.sh';
$configuredSecret = is_readable($secretPath) ? trim((string) file_get_contents($secretPath)) : '';
$authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
$providedSecret = str_starts_with($authorization, 'Bearer ')
    ? substr($authorization, 7)
    : '';

if ($configuredSecret === '' || !hash_equals($configuredSecret, $providedSecret)) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

if (!is_executable($deployScript)) {
    http_response_code(503);
    echo json_encode(['error' => 'Site builder is unavailable']);
    exit;
}

set_time_limit(180);
$pipes = [];
$process = proc_open(
    ['/bin/bash', $deployScript],
    [
        0 => ['pipe', 'r'],
        1 => ['pipe', 'w'],
        2 => ['pipe', 'w'],
    ],
    $pipes,
    $builderRoot,
);

if (!is_resource($process)) {
    http_response_code(503);
    echo json_encode(['error' => 'Unable to start site builder']);
    exit;
}

fclose($pipes[0]);
$stdout = stream_get_contents($pipes[1]);
$stderr = stream_get_contents($pipes[2]);
fclose($pipes[1]);
fclose($pipes[2]);
$exitCode = proc_close($process);

if ($exitCode !== 0) {
    error_log(sprintf('Rasika site build failed (%d): %s %s', $exitCode, $stdout, $stderr));
    http_response_code($exitCode === 75 ? 409 : 500);
    echo json_encode([
        'error' => $exitCode === 75 ? 'A site build is already running' : 'Site build failed',
    ]);
    exit;
}

echo json_encode([
    'status' => 'published',
    'deployed_at' => gmdate('c'),
]);
