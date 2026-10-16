<?php

namespace OCA\Roundcube\Settings;

use OCA\Roundcube\AppInfo\Application;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\Settings\IIconSection;

class PersonalSection implements IIconSection
{
    private const PRIORITY = 30;

    public function __construct(
        private IURLGenerator $urlGenerator,
        private IL10N $l,
    ) {}

    public function getID(): string
    {
        return Application::APP_ID;
    }

    public function getName(): string
    {
        return $this->l->t('ConectaMail');
    }

    public function getPriority(): int
    {
        return self::PRIORITY;
    }

    public function getIcon(): string
    {
        return $this->urlGenerator->imagePath(Application::APP_ID, 'mail.svg');
    }
}
