<?php

declare(strict_types=1);

// Restrição de acesso por IP (Administração › Segurança), admin only
return [
	'routes' => [
		['name' => 'ip_access#show', 'url' => '/ip-access', 'verb' => 'GET'],
		['name' => 'ip_access#update', 'url' => '/ip-access', 'verb' => 'PUT'],
		// Logo dos e-mails (Administração › Personalização); show is public for mail clients
		['name' => 'email_logo#show', 'url' => '/email-logo', 'verb' => 'GET'],
		['name' => 'email_logo#upload', 'url' => '/email-logo', 'verb' => 'POST'],
		['name' => 'email_logo#remove', 'url' => '/email-logo', 'verb' => 'DELETE'],
	],
];
