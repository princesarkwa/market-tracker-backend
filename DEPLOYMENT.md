# Payment Deployment Checklist

## Secrets

- Rotate any Paystack key that has been shared or committed.
- Store the replacement key in the hosting provider's secret manager.
- Do not deploy `backend/.env` or the Firebase service-account JSON file.
- Use a server-managed Firebase service account in production.

## Backend environment

```env
PORT=3000
PAYSTACK_SECRET_KEY=sk_live_replace_me
APP_ORIGIN=https://your-app-domain.example
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_SERVICE_ACCOUNT_PATH=
```

## Paystack

Set the webhook URL to:

```text
https://your-api-domain.example/api/paystack/webhook
```

Use test keys and test transactions before switching to live mode.

## Flutter

Build with the deployed API URL:

```powershell
flutter build windows --dart-define=PAYMENT_BACKEND_URL=https://your-api-domain.example/api/payments/initialize
```

Never put `PAYSTACK_SECRET_KEY` in Flutter.

## Firebase

Create Firestore rules that prevent public reads and writes to `subscriptions` and
`paystack_events`. Only the backend service account should write payment records.

The repository includes `firestore.rules` for these payment collections. Deploy it
with the Firebase CLI from the repository root after selecting the correct project.