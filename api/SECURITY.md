# Security reporting

Do not publish suspected vulnerabilities, credentials, tokens, or personal data in an issue. Send a private report to the Drezivo organization security contact with the affected component, reproduction steps, impact, and a safe contact method.

The operator API treats all browser input as untrusted. Clerk proves identity; Drezivo authorization decides whether an internal operator may perform a specific action. Operator support-grant, support-activity, and workspace-access routes are retired; no support grant confers operator permission. Secrets belong in the deployment secret store and must never be committed or logged.
