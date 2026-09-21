<?php
/**
 * WHMCS provisioning module for the ShivAppHub hosting panel (REST API /api/v1).
 * Server settings in WHMCS: Hostname = panel host, Password = API key (shk_...), "Secure" = on (HTTPS).
 * Product "Package" config option = package name (or id) in the panel.
 */
if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

function shivapphub_MetaData()
{
    return ['DisplayName' => 'ShivAppHub', 'APIVersion' => '1.1', 'RequiresServer' => true];
}

function shivapphub_ConfigOptions()
{
    return ['package' => ['FriendlyName' => 'Package', 'Type' => 'text', 'Size' => '30', 'Description' => 'Panel package name or id']];
}

function shivapphub_call(array $params, string $method, string $path, array $body = [])
{
    $host = $params['serverhostname'] ?: $params['serverip'];
    $url = 'https://' . $host . '/api/v1' . $path;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $params['serverpassword'], 'Content-Type: application/json', 'Accept: application/json'],
    ]);
    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode((object) $body));
    }
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    logModuleCall('shivapphub', $method . ' ' . $path, $method === 'POST' ? array_diff_key($body, ['password' => 1]) : '', $raw, null, [$params['serverpassword']]);
    if ($raw === false) {
        throw new Exception('Connection failed: ' . $err);
    }
    $data = json_decode($raw, true);
    if ($code < 200 || $code >= 300) {
        throw new Exception(is_array($data) && isset($data['error']) ? $data['error'] : 'HTTP ' . $code);
    }
    return is_array($data) ? $data : [];
}

function shivapphub_run(array $params, callable $fn)
{
    try {
        $fn();
        return 'success';
    } catch (Exception $e) {
        return $e->getMessage();
    }
}

function shivapphub_username(array $params)
{
    return $params['username'];
}

function shivapphub_CreateAccount(array $params)
{
    return shivapphub_run($params, function () use ($params) {
        $username = strtolower(preg_replace('/[^a-z0-9]/i', '', $params['username'] ?: 'u' . $params['serviceid']));
        if (!preg_match('/^[a-z]/', $username)) {
            $username = 'u' . $username;
        }
        $username = substr($username, 0, 16);
        shivapphub_call($params, 'POST', '/accounts', [
            'username' => $username,
            'email' => $params['clientsdetails']['email'],
            'password' => $params['password'],
            'package' => $params['configoption1'],
        ]);
        // Remember the username the panel actually got.
        localAPI('UpdateClientProduct', ['serviceid' => $params['serviceid'], 'serviceusername' => $username]);
    });
}

function shivapphub_SuspendAccount(array $params)
{
    return shivapphub_run($params, function () use ($params) {
        shivapphub_call($params, 'POST', '/accounts/' . rawurlencode(shivapphub_username($params)) . '/suspend', ['reason' => (string) ($params['suspendreason'] ?? '')]);
    });
}

function shivapphub_UnsuspendAccount(array $params)
{
    return shivapphub_run($params, function () use ($params) {
        shivapphub_call($params, 'POST', '/accounts/' . rawurlencode(shivapphub_username($params)) . '/unsuspend');
    });
}

function shivapphub_TerminateAccount(array $params)
{
    return shivapphub_run($params, function () use ($params) {
        shivapphub_call($params, 'DELETE', '/accounts/' . rawurlencode(shivapphub_username($params)));
    });
}

function shivapphub_ChangePassword(array $params)
{
    return shivapphub_run($params, function () use ($params) {
        shivapphub_call($params, 'POST', '/accounts/' . rawurlencode(shivapphub_username($params)) . '/password', ['password' => $params['password']]);
    });
}

function shivapphub_ChangePackage(array $params)
{
    return shivapphub_run($params, function () use ($params) {
        shivapphub_call($params, 'POST', '/accounts/' . rawurlencode(shivapphub_username($params)) . '/package', ['package' => $params['configoption1']]);
    });
}

function shivapphub_TestConnection(array $params)
{
    try {
        shivapphub_call($params, 'GET', '/packages');
        return ['success' => true, 'error' => ''];
    } catch (Exception $e) {
        return ['success' => false, 'error' => $e->getMessage()];
    }
}
