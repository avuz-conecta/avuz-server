<?php

return ['routes' => [
    ['name' => 'page#index', 'url' => '/', 'verb' => 'GET'],
    ['name' => 'credential_api#store', 'url' => '/api/credentials', 'verb' => 'POST'],
    ['name' => 'calendar_api#import', 'url' => '/api/calendar/events', 'verb' => 'POST'],
]];
