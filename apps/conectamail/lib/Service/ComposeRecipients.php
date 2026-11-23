<?php

declare(strict_types=1);

namespace OCA\Roundcube\Service;

/**
 * Recipients of a new message opened from an e-mail link elsewhere in Avuz Conecta
 * (Contatos, Agenda, perfis). Only real addresses pass: the list ends up in a URL.
 */
final class ComposeRecipients
{
    private const MAX_RECIPIENTS = 20;

    /**
     * @param string $raw comma-separated addresses, as in "mailto:a@x.com,b@y.com"
     * @return string the valid addresses, comma-separated, each once; empty when none is valid
     */
    public static function from(string $raw): string
    {
        $recipients = [];
        foreach (explode(',', $raw) as $candidate) {
            $address = trim($candidate);
            if (filter_var($address, FILTER_VALIDATE_EMAIL) === false) {
                continue;
            }
            $recipients[strtolower($address)] ??= $address;
        }

        return implode(',', array_slice(array_values($recipients), 0, self::MAX_RECIPIENTS));
    }
}
