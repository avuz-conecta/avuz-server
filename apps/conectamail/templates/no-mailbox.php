<?php
/** @var array{dashboard_url: string} $_ */
/** @var \OCP\IL10N $l */
print_unescaped($this->inc('part.notice', [
    'heading' => $l->t('You do not have an e-mail inbox yet'),
    'text' => $l->t('Ask your company administrator to create your e-mail.'),
    'action' => [
        'label' => $l->t('Back to dashboard'),
        'url' => $_['dashboard_url'],
    ],
]));
