# Field Guide Health-Check Alerts

Store the incoming webhook as the GitHub repository secret `FIELD_GUIDE_ALERT_WEBHOOK`. Add the optional repository variable `FIELD_GUIDE_ALERT_PROVIDER` as either `discord` or `slack`.

The verification workflow runs `notify_health_check_failure.sh` only when the live health-check job fails. The notifier sends Discord payloads with `content` and Slack payloads with `text`. If the secret is absent, it logs that notifications are not configured and exits successfully. It never changes the Field Guide, Pages configuration, or installer runtime.

For a webhook delivery failure, review the GitHub Actions run and replace the repository secret through GitHub Settings; never commit a webhook URL.
