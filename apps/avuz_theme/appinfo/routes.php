<?php

declare(strict_types=1);

// Restrição de acesso por IP (Administração › Segurança), admin only
return [
	'routes' => [
		['name' => 'ip_access#show', 'url' => '/ip-access', 'verb' => 'GET'],
		['name' => 'ip_access#update', 'url' => '/ip-access', 'verb' => 'PUT'],
	],
];
