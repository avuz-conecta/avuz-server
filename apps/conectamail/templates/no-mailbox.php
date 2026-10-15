<?php
/** @var \OCP\IL10N $l */
print_unescaped($this->inc('part.notice', [
    'heading' => $l->t('You do not have an e-mail inbox yet'),
    'text' => $l->t('Ask your company administrator to create your e-mail.'),
]));
