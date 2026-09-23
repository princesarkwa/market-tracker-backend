const fs = require('fs');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');

let firestore;

function isFirebaseConfigured() {
	return Boolean(
		process.env.FIREBASE_PROJECT_ID &&
		((process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) ||
			process.env.FIREBASE_SERVICE_ACCOUNT_PATH),
	);
}

function getFirebaseCredential() {
	if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
		return cert(
			JSON.parse(
				fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'),
			),
		);
	}

	return cert({
		projectId: process.env.FIREBASE_PROJECT_ID,
		clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
		privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
	});
}

function getFirebaseFirestore() {
	if (!isFirebaseConfigured()) {
		throw new Error(
			'Firebase is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in backend/.env.',
		);
	}

	if (!firestore) {
		const app = getApps().length
			? getApps()[0]
			: initializeApp({
					credential: getFirebaseCredential(),
				});
		firestore = getFirestore(app);
	}

	return firestore;
}

async function savePaystackEvent(event) {
	const db = getFirebaseFirestore();
	const eventId = event.id
		? String(event.id)
		: event.data?.reference
			? `${event.event}-${event.data.reference}`
			: `${event.event}-${Date.now()}`;

	await db.collection('paystack_events').doc(eventId).set(
		{
			event: event.event || 'unknown',
			payload: event,
			receivedAt: FieldValue.serverTimestamp(),
		},
		{ merge: true },
	);

	if (event.event === 'charge.success' && event.data?.reference) {
		const transaction = event.data;
		await db.collection('subscriptions').doc(transaction.reference).set(
			{
				reference: transaction.reference,
				status: transaction.status || 'success',
				amount: transaction.amount,
				currency: transaction.currency,
				paystackChannel: transaction.channel || null,
				fullName: transaction.metadata?.fullName || null,
				phone: transaction.metadata?.phone || null,
				email: transaction.customer?.email || null,
				plan: transaction.metadata?.plan || null,
				paymentMethod: transaction.metadata?.paymentMethod || null,
				paidAt: transaction.paid_at || null,
				updatedAt: FieldValue.serverTimestamp(),
			},
			{ merge: true },
		);
	}
}

async function savePendingSubscription(subscription) {
	const db = getFirebaseFirestore();
	await db.collection('subscriptions').doc(subscription.reference).set(
		{
			...subscription,
			status: 'pending',
			createdAt: FieldValue.serverTimestamp(),
			updatedAt: FieldValue.serverTimestamp(),
		},
		{ merge: true },
	);
}

async function saveVerifiedSubscription(transaction) {

	const db = getFirebaseFirestore();
	await db.collection('subscriptions').doc(transaction.reference).set(
		{
			reference: transaction.reference,
			status: transaction.status || 'success',
			amount: transaction.amount,
			currency: transaction.currency,
			paystackChannel: transaction.channel || null,
			fullName: transaction.metadata?.fullName || null,
			phone: transaction.metadata?.phone || null,
			email: transaction.customer?.email || null,
			plan: transaction.metadata?.plan || null,
			paymentMethod: transaction.metadata?.paymentMethod || null,
			paidAt: transaction.paid_at || null,
			updatedAt: FieldValue.serverTimestamp(),
		},
		{ merge: true },
	);
}

async function getSubscription(reference) {
	const snapshot = await getFirebaseFirestore()
		.collection('subscriptions')
		.doc(reference)
		.get();
	return snapshot.exists ? snapshot.data() : null;
}

module.exports = {
	getSubscription,
	isFirebaseConfigured,
	savePaystackEvent,
	savePendingSubscription,
	saveVerifiedSubscription,
};