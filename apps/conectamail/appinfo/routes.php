<?php

return ['routes' => [
    ['name' => 'page#index', 'url' => '/', 'verb' => 'GET'],
    ['name' => 'credential_api#store', 'url' => '/api/credentials', 'verb' => 'POST'],
    ['name' => 'mailbox_password#status', 'url' => '/api/mailbox-password', 'verb' => 'GET'],
    ['name' => 'mailbox_password#save', 'url' => '/api/mailbox-password', 'verb' => 'PUT'],
    ['name' => 'mailbox_password#remove', 'url' => '/api/mailbox-password', 'verb' => 'DELETE'],
    ['name' => 'calendar_api#import', 'url' => '/api/calendar/events', 'verb' => 'POST'],
    ['name' => 'webmail_page#index', 'url' => '/webmail', 'verb' => 'GET'],
    ['name' => 'sso#webmail', 'url' => '/sso/webmail', 'verb' => 'GET'],
]];
