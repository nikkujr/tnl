# My account

Admins and agents open **My account** from the top-right account menu. Signed-in customers open it from the portal header. All roles use `/account`, with their identity taken from the authenticated session.

The profile editor supports full name and a Philippine mobile number. Admin phone numbers are optional; agent/customer phone numbers are required. Customers can also edit their CRM address, which becomes the starting address for future requests. Existing order and request addresses remain saved as submitted. Profile updates refresh the name/avatar in the current session and preserve assignments, consent, roles, commission terms, and other users' records.

Sign-in email is read-only in this release. Self-service profile updates cannot bypass customer email verification or change the linked CRM identity.

Password changes require the current password, a different new password of at least eight characters within bcrypt's 72-byte limit, and confirmation in the UI. The server increments the account's session version and returns a fresh token for the current browser; older tokens are rejected on all protected endpoints. Customer password changes invalidate outstanding password-reset links. An admin replacing an agent's password also revokes that agent's older sessions. Password inputs clear after success and when the page closes; current-password errors clear the current-password input.

Run the standard database migration before deploying the API. `users.token_version` starts at zero; previously issued staff tokens without a version remain valid until a password change increments it. Customers continue using the existing account token version. No password or profile is changed by migration.

## Admin password resets

On **Agents**, active agents have a dedicated **Reset password** action; Edit handles profile details only. On **Customers**, admins see **Reset password** for active verified portal accounts. Contacts without accounts show **Invite to portal** instead. Inactive accounts are labelled and cannot be reset or re-created through this action. Agents cannot reset customer passwords.

The dialog identifies the recipient, asks for a new password and confirmation, and explains that existing sessions will be signed out. Admins share the replacement credential securely with the account holder, who can then change it in My account. This action sends no email, creates no account, and changes no contact, assignment, consent, or verification details. New passwords must differ from the current password and contain at least eight characters within bcrypt's 72-byte limit.

Resetting locks the target account, changes its password hash, increments its token version, and records an `account.password_reset` domain event with the admin and target, without credentials. Customer resets invalidate all unused recovery links for that account in the same transaction. Unknown targets return 404; inactive agents or customers without active verified accounts return 409. Standard migrations from the My account feature must already be applied.

Verification:

- Disposable MySQL checks cover all three roles, active/verified identities, malformed/forged tokens, restricted fields and ownership, phone normalization, preserved assignments/consent/order addresses, password validation, old-session rejection, new login credentials, concurrent password changes, invalidated reset links, and admin password replacement.
- `frontend/scripts/check-account.cjs` uses fixture APIs to check staff menus, customer navigation, profile saving and name refresh, password confirmation/show/hide/error states, token replacement, cleared password inputs, and 320/390px layouts. It makes no live business writes.
- Admin reset checks cover both target roles, unauthorized callers, invalid/multi-byte passwords, missing/inactive/no-account targets, new credential login, old-session denial, recovery-link invalidation, unchanged contacts, and audit payloads. `frontend/scripts/check-admin-password-reset.cjs` covers both pages, confirmation, errors, password clearing, keyboard dismissal/focus restoration, and desktop/320/390px dialogs using fixture APIs only.

Manual acceptance: sign in as each role, open My account, save a profile change, and reload. For a customer, submit a new request and check that its starting address reflects the change while prior orders retain theirs. Change the password with the current password; verify the current browser remains signed in, an older session is rejected, and the new password works after sign-out. Check invalid/mismatched input, phone width layouts, and read-only sign-in email.
