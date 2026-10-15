(function () {
    var APP_ID = 'conectamail';
    var ENDPOINT = '/apps/conectamail/api/mailbox-password';
    var ERROR_MESSAGES = {
        password_required: function () { return t(APP_ID, 'Enter the password.'); },
        password_too_long: function (maxLength) {
            return t(APP_ID, 'The password must have at most {max} characters.', { max: maxLength });
        },
    };

    var CONFIRMATION_MESSAGES = {
        wrong_password: function () { return t(APP_ID, 'Wrong confirmation password. Try again.'); },
        cancelled: function () { return ''; },
    };

    function confirmationFailure(passwordSubmitted) {
        var error = new Error('Password confirmation failed');
        error.confirmation = passwordSubmitted ? 'wrong_password' : 'cancelled';
        return error;
    }

    function failureMessage(error, fallback) {
        var describeFailure = CONFIRMATION_MESSAGES[error.confirmation];
        return describeFailure ? describeFailure() : fallback;
    }

    // The core dialog closes the same way on a wrong password and on cancel,
    // so a non-empty password submitted inside it tells the two apart.
    async function confirmPassword() {
        if (!OC.PasswordConfirmation.requiresPasswordConfirmation()) {
            return;
        }
        var passwordSubmitted = false;
        function trackPasswordSubmit(event) {
            var passwordField = event.target.querySelector('input[type="password"]');
            passwordSubmitted = passwordSubmitted || (passwordField !== null && passwordField.value !== '');
        }
        document.addEventListener('submit', trackPasswordSubmit, true);
        try {
            await new Promise(function (resolve, reject) {
                OC.PasswordConfirmation.requirePasswordConfirmation(resolve, {}, function () {
                    reject(confirmationFailure(passwordSubmitted));
                });
            });
        } finally {
            document.removeEventListener('submit', trackPasswordSubmit, true);
        }
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
        var removalConfirm = document.getElementById('conectamail-password-confirm');
        var confirmRemoveButton = document.getElementById('conectamail-password-confirm-remove');
        var cancelRemoveButton = document.getElementById('conectamail-password-confirm-cancel');
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
            removalConfirm.hidden = true;
        }

        function showMessage(text, isError) {
            message.textContent = text;
            message.classList.toggle('error', isError);
        }

        function markInvalid(isInvalid) {
            if (isInvalid) {
                input.setAttribute('aria-invalid', 'true');
                return;
            }
            input.removeAttribute('aria-invalid');
        }

        function clearInvalidOnceFixed() {
            if (input.getAttribute('aria-invalid') !== 'true' || validationError(input.value) !== null) {
                return;
            }
            markInvalid(false);
        }

        function setBusy(isBusy) {
            saveButton.disabled = isBusy;
            removeButton.disabled = isBusy;
            confirmRemoveButton.disabled = isBusy;
            cancelRemoveButton.disabled = isBusy;
        }

        function openRemovalConfirm() {
            saveButton.hidden = true;
            removeButton.hidden = true;
            removalConfirm.hidden = false;
            showMessage('', false);
            cancelRemoveButton.focus();
        }

        function closeRemovalConfirm(focusTarget) {
            removalConfirm.hidden = true;
            saveButton.hidden = false;
            removeButton.hidden = false;
            focusTarget.focus();
        }

        function cancelRemoval() {
            closeRemovalConfirm(removeButton);
        }

        function cancelRemovalOnEscape(event) {
            if (event.key !== 'Escape' || cancelRemoveButton.disabled) {
                return;
            }
            event.preventDefault();
            cancelRemoval();
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
                markInvalid(true);
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
                    markInvalid(Boolean(describeError));
                    return;
                }
                input.value = '';
                markInvalid(false);
                renderStatus(result.payload);
                showMessage(t(APP_ID, 'Password saved.'), false);
            } catch (error) {
                var saveFailure = failureMessage(error, t(APP_ID, 'Could not save the password. Try again.'));
                showMessage(saveFailure, saveFailure !== '');
            } finally {
                setBusy(false);
            }
        }

        async function remove() {
            setBusy(true);
            try {
                await confirmPassword();
                var result = await request('DELETE');
                if (!result.ok) {
                    showMessage(t(APP_ID, 'Could not remove the password. Try again.'), true);
                    setBusy(false);
                    closeRemovalConfirm(removeButton);
                    return;
                }
                setBusy(false);
                closeRemovalConfirm(input);
                renderStatus(result.payload);
                showMessage(t(APP_ID, 'Password removed.'), false);
            } catch (error) {
                var removeFailure = failureMessage(error, t(APP_ID, 'Could not remove the password. Try again.'));
                showMessage(removeFailure, removeFailure !== '');
                setBusy(false);
                closeRemovalConfirm(removeButton);
            }
        }

        renderStatus({
            saved: section.dataset.saved === 'true',
            updated_at: Number(section.dataset.updatedAt) || null,
        });
        form.addEventListener('submit', save);
        input.addEventListener('input', clearInvalidOnceFixed);
        removeButton.addEventListener('click', openRemovalConfirm);
        confirmRemoveButton.addEventListener('click', remove);
        cancelRemoveButton.addEventListener('click', cancelRemoval);
        removalConfirm.addEventListener('keydown', cancelRemovalOnEscape);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
