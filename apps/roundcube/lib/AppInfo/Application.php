<?php

namespace OCA\Roundcube\AppInfo;

use OCA\Roundcube\Listener\UserLoggedInListener;
use OCA\Roundcube\Listener\UserLoggedOutListener;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\User\Events\UserLoggedInEvent;
use OCP\User\Events\UserLoggedOutEvent;

class Application extends App implements IBootstrap
{
    public const APP_ID = 'roundcube';

    public function __construct()
    {
        parent::__construct(self::APP_ID);
    }

    public function register(IRegistrationContext $context): void
    {
        $context->registerEventListener(UserLoggedInEvent::class, UserLoggedInListener::class);
        $context->registerEventListener(UserLoggedOutEvent::class, UserLoggedOutListener::class);
    }

    public function boot(IBootContext $context): void {}
}
