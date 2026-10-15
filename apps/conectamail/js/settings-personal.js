(function () {
    var APP_ID = 'conectamail';
    var ENDPOINT = '/apps/conectamail/api/mailbox-password';
    var ERROR_MESSAGES = {
        password_required: function () { return t(APP_ID, 'Enter the password.'); },
        password_too_long: function (maxLength) {
            return t(APP_ID, 'The password must have at most {max} characters.', { max: maxLength });
        },
    };

    function confirmPassword() {
        if (!OC.PasswordConfirmation.requiresPasswordConfirmation()) {
            return Promise.resolve();
        }
        return new Promise(function (resolve, reject) {
            OC.PasswordConfirmation.requirePasswordConfirmation(resolve, {}, reject);
        });
    }

    function confirmRemoval() {
        return new Promise(function (resolve) {
            OC.dialogs.confirmDestructive(
                t(APP_ID, 'Remove the saved mailbox password? Avuz Conecta will try your login password to open your e-mail.'),
                t(APP_ID, 'Remove mailbox password'),
                {
                    type: OC.dialogs.YES_NO_BUTTONS,
                    confirm: t(APP_ID, 'Remove'),
                    cancel: t(APP_ID, 'Cancel'),
                },
                resolve
            );
        });
    }

    async function request(method, body) {
        var response = await fetch(OC.generateUrl(ENDPOINT), {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'requesttoken': OC.requestToken,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        var payload = await response.json().catch(function () { return {}; });
        return { ok: response.ok, payload: payload };
    }

    function formatUpdatedAt(updatedAt) {
        if (!updatedAt) {
            return '';
        }
        var date = new Date(updatedAt * 1000).toLocaleString(document.documentElement.lang || undefined);
        return t(APP_ID, 'Updated on {date}', { date: date });
    }

    function init() {
        var section = document.getElementById('conectamail-mailbox-password');
        if (!section) {
            return;
        }

        var form = document.getElementById('conectamail-password-form');
        var input = document.getElementById('conectamail-password-input');
        var saveButton = document.getElementById('conectamail-password-save');
        var removeButton = document.getElementById('conectamail-password-remove');
        var statusText = document.getElementById('conectamail-password-status-text');
        var updatedAtText = document.getElementById('conectamail-password-updated-at');
        var message = document.getElementById('conectamail-password-message');
        var maxLength = Number(section.dataset.maxLength);

        function renderStatus(status) {
            statusText.textContent = status.saved
                ? t(APP_ID, 'Mailbox password saved')
                : t(APP_ID, 'No password saved');
            updatedAtText.textContent = status.saved ? formatUpdatedAt(status.updated_at) : '';
            removeButton.hidden = !status.saved;
        }

        function showMessage(text, isError) {
            message.textContent = text;
            message.classList.toggle('error', isError);
            input.setAttribute('aria-invalid', isError ? 'true' : 'false');
        }

        function setBusy(isBusy) {
            saveButton.disabled = isBusy;
            removeButton.disabled = isBusy;
        }

        function validationError(password) {
            if (password === '') {
                return ERROR_MESSAGES.password_required(maxLength);
            }
            if (Array.from(password).length > maxLength) {
                return ERROR_MESSAGES.password_too_long(maxLength);
            }
            return null;
        }

        async function save(event) {
            event.preventDefault();
            var password = input.value;
            var error = validationError(password);
            if (error !== null) {
                showMessage(error, true);
                input.focus();
                return;
            }

            setBusy(true);
            try {
                await confirmPassword();
                var result = await request('PUT', { password: password });
                if (!result.ok) {
                    var describeError = ERROR_MESSAGES[result.payload.error];
                    showMessage(describeError ? describeError(maxLength) : t(APP_ID, 'Could not save the password. Try again.'), true);
                    return;
                }
                input.value = '';
                renderStatus(result.payload);
                showMessage(t(APP_ID, 'Password saved.'), false);
            } catch (_error) {
                showMessage(t(APP_ID, 'Could not save the password. Try again.'), true);
            } finally {
                setBusy(false);
            }
        }

        async function remove() {
            var confirmed = await confirmRemoval();
            if (!confirmed) {
                return;
            }

            setBusy(true);
            try {
                await confirmPassword();
                var result = await request('DELETE');
                if (!result.ok) {
                    showMessage(t(APP_ID, 'Could not remove the password. Try again.'), true);
                    return;
                }
                renderStatus(result.payload);
                showMessage(t(APP_ID, 'Password removed.'), false);
                input.focus();
            } catch (_error) {
                showMessage(t(APP_ID, 'Could not remove the password. Try again.'), true);
            } finally {
                setBusy(false);
            }
        }

        renderStatus({
            saved: section.dataset.saved === 'true',
            updated_at: Number(section.dataset.updatedAt) || null,
        });
        form.addEventListener('submit', save);
        removeButton.addEventListener('click', remove);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
